import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The AI Workspace's Claude adapter, with the SDK replaced by a recorder. No
 * network and no real credential: the placeholder below is not a key.
 */

const calls = { constructed: [] as any[], stream: [] as any[], upload: [] as any[], deleted: [] as string[] };
let script: { deltas: string[]; final?: any; error?: any } = { deltas: [] };
let deleteError: any = null;

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    constructor(readonly status?: number, readonly error?: any, message = "provider detail that must not leak") {
      super(message);
    }
  }
  class APIConnectionError extends APIError { constructor() { super(undefined, undefined, "connection detail"); } }
  class APIConnectionTimeoutError extends APIConnectionError {}
  class APIUserAbortError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static APIConnectionError = APIConnectionError;
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    static APIUserAbortError = APIUserAbortError;
    messages = {
      stream: (body: any, options: any) => {
        calls.stream.push({ body, options });
        const listeners: ((d: string) => void)[] = [];
        return {
          on(event: string, fn: (d: string) => void) { if (event === "text") listeners.push(fn); return this; },
          async finalMessage() {
            for (const d of script.deltas) listeners.forEach((fn) => fn(d));
            if (script.error) throw script.error;
            return script.final ?? {
              stop_reason: "end_turn",
              usage: { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 },
            };
          },
        };
      },
    };
    files = {
      upload: async (params: any, options: any) => { calls.upload.push({ params, options }); return { id: "file_123" }; },
      delete: async (id: string) => { if (deleteError) throw deleteError; calls.deleted.push(id); },
    };
    constructor(options: any) { calls.constructed.push(options); }
  }
  return {
    default: Anthropic,
    toFile: async (data: any, name: string, options: any) => ({ data, name, type: options?.type }),
  };
});

const PLACEHOLDER = "placeholder-not-a-key";
const signal = () => new AbortController().signal;

describe("the workspace's Claude adapter", () => {
  beforeEach(() => {
    calls.constructed.length = 0;
    calls.stream.length = 0;
    calls.upload.length = 0;
    calls.deleted.length = 0;
    script = { deltas: [] };
    deleteError = null;
  });

  it("turns parts into Claude content blocks, and drops empty text", async () => {
    const { toAnthropicContent } = await import("../src/lib/ai/claude");
    expect(toAnthropicContent([
      { type: "document", title: "a.pdf", source: { kind: "file", providerFileId: "file_1" } },
      { type: "document", title: "b.pdf", source: { kind: "base64", mimeType: "application/pdf", data: "QkFTRTY0" } },
      { type: "document", title: "notes.txt", source: { kind: "text", text: "会议纪要" } },
      { type: "image", source: { kind: "file", providerFileId: "file_2" } },
      { type: "image", source: { kind: "base64", mimeType: "image/webp", data: "V0VCUA==" } },
      { type: "text", text: "   " },
      { type: "text", text: "Compare them" },
    ])).toEqual([
      { type: "document", title: "a.pdf", source: { type: "file", file_id: "file_1" } },
      { type: "document", title: "b.pdf", source: { type: "base64", media_type: "application/pdf", data: "QkFTRTY0" } },
      { type: "document", title: "notes.txt", source: { type: "text", media_type: "text/plain", data: "会议纪要" } },
      { type: "image", source: { type: "file", file_id: "file_2" } },
      { type: "image", source: { type: "base64", media_type: "image/webp", data: "V0VCUA==" } },
      { type: "text", text: "Compare them" },
    ]);
  });

  it("streams text and reports how the reply ended, with no workspace header", async () => {
    const { createClaudeWorkspaceProvider } = await import("../src/lib/ai/claude");
    script = { deltas: ["Hel", "lo"] };
    const provider = createClaudeWorkspaceProvider(PLACEHOLDER);
    const received: string[] = [];
    const s = signal();
    const result = await provider.streamChat({
      model: "claude-sonnet-5", system: "sys", maxOutputTokens: 8000, signal: s,
      turns: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
    }, (d) => received.push(d));

    expect(received).toEqual(["Hel", "lo"]);
    expect(result).toEqual({ stopReason: "end_turn", inputTokens: 11, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 0 });
    expect(calls.constructed[0]).toEqual({ apiKey: PLACEHOLDER, maxRetries: 1 });
    expect(calls.stream[0].body).toEqual({
      model: "claude-sonnet-5", max_tokens: 8000, system: "sys",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });
    expect(calls.stream[0].options.signal).toBe(s);
    expect(JSON.stringify(calls.stream[0])).not.toMatch(/workspace/i);
  });

  it("normalises the stop reason", async () => {
    const { createClaudeWorkspaceProvider } = await import("../src/lib/ai/claude");
    const provider = createClaudeWorkspaceProvider(PLACEHOLDER);
    const request = { model: "m", system: "s", maxOutputTokens: 5, signal: signal(), turns: [] };
    script = { deltas: [], final: { stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 5 } } };
    expect((await provider.streamChat(request, () => {})).stopReason).toBe("max_tokens");
    script = { deltas: [], final: { stop_reason: "model_context_window_exceeded", usage: {} } };
    expect((await provider.streamChat(request, () => {})).stopReason).toBe("context_window");
  });

  it("reduces every failure to a code and a status, without the provider's words", async () => {
    const sdk = (await import("@anthropic-ai/sdk")).default as any;
    const { classifyFailure } = await import("../src/lib/ai/claude");
    const cases: [unknown, string, number | null][] = [
      [new sdk.APIError(429), "rate_limited", 429],
      [new sdk.APIError(529), "overloaded", 529],
      [new sdk.APIError(undefined, { type: "error", error: { type: "overloaded_error" } }), "overloaded", null],
      [new sdk.APIError(400, undefined, "prompt is too long: 250000 tokens > 200000 maximum"), "context_too_long", 400],
      [new sdk.APIError(413), "context_too_long", 413],
      [new sdk.APIError(400, undefined, "Could not process PDF"), "unreadable_file", 400],
      [new sdk.APIConnectionTimeoutError(), "timeout", null],
      [new sdk.APIConnectionError(), "network", null],
      [new sdk.APIError(500), "provider_error", 500],
      [new Error("something else"), "provider_error", null],
    ];
    for (const [error, code, status] of cases) {
      const failure = classifyFailure(error);
      expect(failure.code).toBe(code);
      expect(failure.status).toBe(status);
      expect(failure.message).not.toMatch(/provider detail|PDF|prompt is too long|connection detail/);
    }
  });

  it("reports a stopped request as stopped, not failed", async () => {
    const { createClaudeWorkspaceProvider } = await import("../src/lib/ai/claude");
    const { ProviderAborted } = await import("../src/lib/aiWorkspaceRuntime/provider");
    const controller = new AbortController();
    controller.abort();
    script = { deltas: [], error: new Error("aborted") };
    const provider = createClaudeWorkspaceProvider(PLACEHOLDER);
    await expect(provider.streamChat({ model: "m", system: "s", maxOutputTokens: 5, signal: controller.signal, turns: [] }, () => {}))
      .rejects.toBeInstanceOf(ProviderAborted);
  });

  it("uploads a file through the Files API and deletes copies, treating already-gone as done", async () => {
    const sdk = (await import("@anthropic-ai/sdk")).default as any;
    const { createClaudeWorkspaceProvider } = await import("../src/lib/ai/claude");
    const provider = createClaudeWorkspaceProvider(PLACEHOLDER);
    expect(await provider.uploadFile({ bytes: new Uint8Array([37, 80, 68, 70]), filename: "plan.pdf", mimeType: "application/pdf" }))
      .toBe("file_123");
    expect(calls.upload[0].params.file).toMatchObject({ name: "plan.pdf", type: "application/pdf" });

    await provider.deleteFile("file_123");
    expect(calls.deleted).toEqual(["file_123"]);
    deleteError = new sdk.APIError(404);
    await expect(provider.deleteFile("file_gone")).resolves.toBeUndefined();
    deleteError = new sdk.APIError(500);
    await expect(provider.deleteFile("file_x")).rejects.toMatchObject({ code: "provider_error", status: 500 });
  });
});
