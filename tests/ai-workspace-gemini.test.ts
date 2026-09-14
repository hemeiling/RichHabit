import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyGeminiError, createGeminiImageProvider, createGeminiWorkspaceProvider, geminiStopReason, toGeminiContents,
} from "../src/lib/ai/gemini";
import { ProviderAborted, ProviderFailure, type ProviderTurn } from "../src/lib/aiWorkspaceRuntime/provider";

/**
 * The AI Workspace's Gemini adapter, with `fetch` replaced by a recorder. No
 * network and no real credential: the placeholder below is not a key. The
 * response shapes are the ones the Gemini API returned in local probes.
 */

const PLACEHOLDER = "placeholder-not-a-key";
const LEAK = "provider detail that must not leak: quota for project 1234";
const calls: { url: string; init: RequestInit; body: any }[] = [];
let respond: () => Response | Promise<Response>;

const encoder = new TextEncoder();
/** An SSE body, optionally cut into chunks at awkward places. */
const sse = (events: unknown[], chunk = 0) => {
  const text = events.map((e) => (typeof e === "string" ? e : `data: ${JSON.stringify(e)}`)).join("\r\n\r\n") + "\r\n\r\n";
  const pieces = chunk > 0 ? text.match(new RegExp(`[\\s\\S]{1,${chunk}}`, "g")) ?? [] : [text];
  return new Response(new ReadableStream({
    start(controller) {
      for (const p of pieces) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const signal = () => new AbortController().signal;
const TURNS: ProviderTurn[] = [
  { role: "user", parts: [{ type: "text", text: "My name is Mei." }] },
  { role: "assistant", parts: [{ type: "text", text: "Got it." }] },
  { role: "user", parts: [
    { type: "document", title: "Plan \"v2\".pdf", source: { kind: "base64", mimeType: "application/pdf", data: "JVBERi0=" } },
    { type: "document", title: "Notes \"v2\" <draft>.txt", source: { kind: "text", text: "line one" } },
    { type: "image", source: { kind: "base64", mimeType: "image/png", data: "iVBORw0=" } },
    { type: "text", text: "   " },
    { type: "text", text: "What is my name?" },
  ] },
];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    return respond();
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Gemini conversations", () => {
  it("sends the workspace's context as a stateless generateContent stream, with the key only in a header", async () => {
    respond = () => sse([{ candidates: [{ content: { parts: [{ text: "Mei" }] }, finishReason: "STOP" }] }]);
    const provider = createGeminiWorkspaceProvider(PLACEHOLDER);
    expect(provider.id).toBe("google");
    expect(provider.uploadFile).toBeUndefined();
    await provider.streamChat({ model: "gemini-3.8-flash", system: "Be helpful.", turns: TURNS, maxOutputTokens: 8000, signal: signal() }, () => {});

    const [call] = calls;
    expect(call.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
    expect((call.init.headers as Record<string, string>)["x-goog-api-key"]).toBe(PLACEHOLDER);
    expect(call.url).not.toContain(PLACEHOLDER);
    expect(JSON.stringify(call.body)).not.toContain(PLACEHOLDER);
    expect(call.body).toEqual({
      systemInstruction: { parts: [{ text: "Be helpful." }] },
      contents: [
        { role: "user", parts: [{ text: "My name is Mei." }] },
        { role: "model", parts: [{ text: "Got it." }] },
        { role: "user", parts: [
          { inlineData: { mimeType: "application/pdf", data: "JVBERi0=" } },
          { text: "<document title=\"Notes &quot;v2&quot; &lt;draft&gt;.txt\">\nline one\n</document>" },
          { inlineData: { mimeType: "image/png", data: "iVBORw0=" } },
          { text: "What is my name?" },
        ] },
      ],
      generationConfig: { maxOutputTokens: 8000 },
    });
    // No stored-interaction options: nothing is kept at Google between requests.
    expect(call.body).not.toHaveProperty("store");
    expect(call.body).not.toHaveProperty("previous_interaction_id");
  });

  it("merges turns from the same side and drops empty ones", () => {
    expect(toGeminiContents([
      { role: "user", parts: [{ type: "text", text: "a" }] },
      { role: "assistant", parts: [{ type: "text", text: " " }] },
      { role: "user", parts: [{ type: "text", text: "b" }] },
    ])).toEqual([{ role: "user", parts: [{ text: "a" }, { text: "b" }] }]);
  });

  it("streams the reply's words, skipping thoughts and signatures, even when events arrive in pieces", async () => {
    respond = () => sse([
      { candidates: [{ content: { parts: [{ text: "thinking about it", thought: true }] } }] },
      { candidates: [{ content: { role: "model", parts: [{ text: "Your name " }] } }] },
      { candidates: [{ content: { parts: [{ text: "is Mei." }] } }] },
      { candidates: [{ content: { parts: [{ text: "", thoughtSignature: "c2ln" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 33, candidatesTokenCount: 2, thoughtsTokenCount: 82, cachedContentTokenCount: 4 } },
      "data: [DONE]",
    ], 7);
    const deltas: string[] = [];
    const result = await createGeminiWorkspaceProvider(PLACEHOLDER).streamChat(
      { model: "gemini-3.8-flash", system: "s", turns: TURNS, maxOutputTokens: 100, signal: signal() }, (d) => deltas.push(d));
    expect(deltas.join("")).toBe("Your name is Mei.");
    expect(result).toEqual({ stopReason: "end_turn", inputTokens: 33, outputTokens: 84, cacheReadTokens: 4, cacheWriteTokens: null });
  });

  it("reduces finish and block reasons to the ones the workspace acts on", async () => {
    expect(geminiStopReason("STOP")).toBe("end_turn");
    expect(geminiStopReason("MAX_TOKENS")).toBe("max_tokens");
    for (const reason of ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "IMAGE_SAFETY"]) expect(geminiStopReason(reason)).toBe("refusal");
    expect(geminiStopReason(undefined, "SAFETY")).toBe("refusal");

    respond = () => sse([{ promptFeedback: { blockReason: "SAFETY" } }]);
    const result = await createGeminiWorkspaceProvider(PLACEHOLDER).streamChat(
      { model: "m", system: "s", turns: TURNS, maxOutputTokens: 100, signal: signal() }, () => {});
    expect(result.stopReason).toBe("refusal");
  });

  it("turns errors into workspace codes, without Google's words or the key", async () => {
    const QUOTA_ZERO = "You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, project 1234";
    const cases: [number, unknown, string, string | null][] = [
      [429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: LEAK } }, "rate_limited", null],
      [429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: QUOTA_ZERO } }, "provider_error", "quota_unavailable"],
      [503, { error: { code: 503, status: "UNAVAILABLE", message: LEAK } }, "overloaded", null],
      [504, { error: { code: 504, status: "DEADLINE_EXCEEDED", message: LEAK } }, "timeout", null],
      [400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "The input token count exceeds the maximum" } }, "context_too_long", null],
      [400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "Unable to process input image" } }, "unreadable_file", null],
      [400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } }, "provider_error", "provider_config"],
      [403, { error: { code: 403, status: "PERMISSION_DENIED", message: LEAK } }, "provider_error", "provider_config"],
      [404, { error: { code: 404, status: "NOT_FOUND", message: "models/gemini-9 is not found" } }, "provider_error", "provider_config"],
    ];
    for (const [status, body, code, detail] of cases) {
      respond = () => json(status, body);
      const error = await createGeminiWorkspaceProvider(PLACEHOLDER)
        .streamChat({ model: "m", system: "s", turns: TURNS, maxOutputTokens: 100, signal: signal() }, () => {})
        .catch((e) => e);
      expect(error).toBeInstanceOf(ProviderFailure);
      expect(error.code).toBe(code);
      expect(error.detail).toBe(detail);
      expect(`${error.message} ${String(error)}`).not.toMatch(/provider detail|project 1234|limit: 0|placeholder-not-a-key|token count|api key not valid|gemini-9/i);
    }
    expect(classifyGeminiError(0, null).code).toBe("provider_error");
  });

  it("reports a lost connection, a stream that never finished, a mid-stream error and a stored-file reference", async () => {
    const run = () => createGeminiWorkspaceProvider(PLACEHOLDER)
      .streamChat({ model: "m", system: "s", turns: TURNS, maxOutputTokens: 100, signal: signal() }, () => {})
      .catch((e) => e);

    respond = () => { throw new TypeError("fetch failed"); };
    expect((await run()).code).toBe("network");
    respond = () => sse([{ candidates: [{ content: { parts: [{ text: "half" }] } }] }]);
    expect((await run()).code).toBe("malformed_response");
    respond = () => sse([{ error: { code: 503, status: "UNAVAILABLE", message: LEAK } }]);
    expect((await run()).code).toBe("overloaded");

    respond = () => sse([]);
    const withFile = await createGeminiWorkspaceProvider(PLACEHOLDER).streamChat({
      model: "m", system: "s", maxOutputTokens: 100, signal: signal(),
      turns: [{ role: "user", parts: [{ type: "image", source: { kind: "file", providerFileId: "file_1" } }] }],
    }, () => {}).catch((e) => e);
    expect(withFile.code).toBe("unreadable_file");
  });

  it("treats Stop as a stop, not a failure", async () => {
    const controller = new AbortController();
    respond = () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    };
    const error = await createGeminiWorkspaceProvider(PLACEHOLDER)
      .streamChat({ model: "m", system: "s", turns: TURNS, maxOutputTokens: 100, signal: controller.signal }, () => {})
      .catch((e) => e);
    expect(error).toBeInstanceOf(ProviderAborted);
  });
});

describe("Gemini image generation", () => {
  const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64");
  const DRAFT_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]).toString("base64");

  it("asks Nano Banana for text and image, with references before the prompt, and returns only final pictures", async () => {
    respond = () => json(200, {
      candidates: [{
        content: { parts: [
          { inlineData: { mimeType: "image/png", data: DRAFT_B64 }, thought: true },
          { text: "Here is a hippo." },
          { inlineData: { mimeType: "image/png", data: PNG_B64 }, thoughtSignature: "c2ln" },
        ] },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 1290 },
    });
    const provider = createGeminiImageProvider(PLACEHOLDER);
    const result = await provider.generateImage({
      model: "gemini-3.1-flash-image", prompt: "Can you generate a cartoon image of a hippopotamus?",
      references: [{ mimeType: "image/jpeg", data: "/9j/" }], imageSize: "1K", signal: signal(),
    });

    const [call] = calls;
    expect(call.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent");
    expect((call.init.headers as Record<string, string>)["x-goog-api-key"]).toBe(PLACEHOLDER);
    expect(call.body).toEqual({
      contents: [{ role: "user", parts: [
        { inlineData: { mimeType: "image/jpeg", data: "/9j/" } },
        { text: "Can you generate a cartoon image of a hippopotamus?" },
      ] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { imageSize: "1K" } },
    });
    expect(result.images).toHaveLength(1);
    expect(Buffer.from(result.images[0].bytes).toString("base64")).toBe(PNG_B64);
    expect(result).toMatchObject({ text: "Here is a hippo.", stopReason: "end_turn", inputTokens: 12, outputTokens: 1290 });
  });

  it("only sends a known image size", async () => {
    respond = () => json(200, { candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] });
    await createGeminiImageProvider(PLACEHOLDER).generateImage({ model: "m", prompt: "p", references: [], imageSize: "8K", signal: signal() });
    expect(calls[0].body.generationConfig.imageConfig).toEqual({ imageSize: "1K" });
  });

  it("returns a refusal with no picture, and fails on an empty or unreadable answer", async () => {
    respond = () => json(200, { promptFeedback: { blockReason: "PROHIBITED_CONTENT" } });
    const refused = await createGeminiImageProvider(PLACEHOLDER).generateImage({ model: "m", prompt: "p", references: [], imageSize: "1K", signal: signal() });
    expect(refused).toMatchObject({ images: [], stopReason: "refusal" });

    respond = () => json(200, {});
    expect((await createGeminiImageProvider(PLACEHOLDER)
      .generateImage({ model: "m", prompt: "p", references: [], imageSize: "1K", signal: signal() }).catch((e) => e)).code)
      .toBe("malformed_response");

    respond = () => json(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: LEAK } });
    const limited = await createGeminiImageProvider(PLACEHOLDER)
      .generateImage({ model: "m", prompt: "p", references: [], imageSize: "1K", signal: signal() }).catch((e) => e);
    expect(limited.code).toBe("rate_limited");
    expect(String(limited)).not.toMatch(/quota|provider detail/);
  });
});
