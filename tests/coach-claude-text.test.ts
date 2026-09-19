import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `generateText`, the coach's capability on the Claude provider, with the SDK
 * replaced by a recorder. No network, and no real credential: the placeholder
 * below is not a key.
 */

const constructed: any[] = [];
const created: any[] = [];
let reply: any = { content: [{ type: "text", text: "Evenings are at 41%." }] };
let failure: any = null;

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error { constructor(readonly status: number) { super("provider said something"); } }
  class Anthropic {
    static APIError = APIError;
    messages = {
      create: async (body: any, options: any) => {
        created.push({ body, options });
        if (failure) throw failure;
        return reply;
      },
    };
    constructor(options: any) { constructed.push(options); }
  }
  return { default: Anthropic, toFile: async () => ({}) };
});

const PLACEHOLDER = "placeholder-not-a-key";
const request = { system: "instructions", prompt: "their data and question", maxTokens: 1200, timeoutMs: 60000 };

describe("the Claude provider's text capability", () => {
  beforeEach(() => {
    constructed.length = 0;
    created.length = 0;
    failure = null;
    reply = { content: [{ type: "text", text: "Evenings are at 41%." }] };
  });

  it("asks for prose with no tool and no schema, and returns the text", async () => {
    const { createClaudeProvider } = await import("../src/lib/ai/claude");
    const out = await createClaudeProvider(PLACEHOLDER, "claude-sonnet-5").generateText(request);
    expect(out).toBe("Evenings are at 41%.");
    // A forced tool call would invite the model to describe an answer instead
    // of giving one, so the coach sends neither tool nor schema.
    expect(created[0].body.tools).toBeUndefined();
    expect(created[0].body.tool_choice).toBeUndefined();
    expect(created[0].body.model).toBe("claude-sonnet-5");
    expect(created[0].body.system).toBe("instructions");
    expect(created[0].body.max_tokens).toBe(1200);
    expect(created[0].body.messages).toEqual([{ role: "user", content: "their data and question" }]);
    expect(created[0].options).toEqual({ timeout: 60000 });
  });

  it("joins several text blocks, and ignores anything that is not text", async () => {
    reply = {
      content: [
        { type: "thinking", thinking: "internal" },
        { type: "text", text: "First part." },
        { type: "text", text: "Second part." },
      ],
    };
    const { createClaudeProvider } = await import("../src/lib/ai/claude");
    const out = await createClaudeProvider(PLACEHOLDER, "m").generateText(request);
    expect(out).toBe("First part.\nSecond part.");
    expect(out).not.toContain("internal");
  });

  it("returns an empty string when the model returned no text", async () => {
    reply = { content: [{ type: "tool_use", input: {} }] };
    const { createClaudeProvider } = await import("../src/lib/ai/claude");
    expect(await createClaudeProvider(PLACEHOLDER, "m").generateText(request)).toBe("");
  });

  it("reduces a provider error to its status code, keeping the provider's words out", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default as any;
    failure = new Anthropic.APIError(429);
    const { createClaudeProvider } = await import("../src/lib/ai/claude");
    const { AiFailed } = await import("../src/lib/ai/provider");
    const error: any = await createClaudeProvider(PLACEHOLDER, "m").generateText(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiFailed);
    expect(error.status).toBe(429);
    expect(String(error.message)).not.toContain("provider said something");
    // A rate limit is worth retrying; a refused key is not.
    expect(error.rejected).toBe(false);
  });

  it("sends no workspace header: the key is workspace-scoped", async () => {
    const { createClaudeProvider } = await import("../src/lib/ai/claude");
    await createClaudeProvider(PLACEHOLDER, "m").generateText(request);
    expect(constructed[0]).toEqual({ apiKey: PLACEHOLDER, maxRetries: 1 });
    expect(JSON.stringify(created[0])).not.toMatch(/workspace/i);
  });
});
