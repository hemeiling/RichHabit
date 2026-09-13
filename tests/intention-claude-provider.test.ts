import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Claude provider, with the SDK replaced by a recorder. No network, and no
 * real credential: the placeholder below is not a key.
 */

const constructed: any[] = [];
const created: any[] = [];
let reply: any = { content: [{ type: "tool_use", input: { suggestions: [{ text: "x" }] } }] };
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
  return { default: Anthropic };
});

const PLACEHOLDER = "placeholder-not-a-key";

describe("the Claude provider", () => {
  beforeEach(() => {
    constructed.length = 0;
    created.length = 0;
    failure = null;
    reply = { content: [{ type: "tool_use", input: { suggestions: [{ text: "x" }] } }] };
  });

  const request = {
    system: "instructions", prompt: "context", toolName: "suggest_habits", toolDescription: "d",
    schema: { type: "object" }, maxTokens: 100, timeoutMs: 1234,
  };

  it("forces one structured tool call and returns its input", async () => {
    const { createClaudeProvider } = await import("../src/lib/ai/claude");
    const out = await createClaudeProvider(PLACEHOLDER, "claude-sonnet-5").generateStructured(request);
    expect(out).toEqual({ suggestions: [{ text: "x" }] });
    expect(created[0].body.tool_choice).toEqual({ type: "tool", name: "suggest_habits" });
    expect(created[0].body.model).toBe("claude-sonnet-5");
    expect(created[0].options).toEqual({ timeout: 1234 });
  });

  it("sends no workspace header: the key is workspace-scoped", async () => {
    const { createClaudeProvider } = await import("../src/lib/ai/claude");
    createClaudeProvider(PLACEHOLDER, "claude-sonnet-5");
    expect(constructed[0]).toEqual({ apiKey: PLACEHOLDER, maxRetries: 1 });
    await createClaudeProvider(PLACEHOLDER, "claude-sonnet-5").generateStructured(request);
    expect(JSON.stringify(created[0].options)).not.toMatch(/workspace/i);
  });

  it("treats a refused key or request as a rejection, and outages as retryable", async () => {
    const { AiFailed } = await import("../src/lib/ai/provider");
    for (const status of [400, 401, 403, 404]) expect(new AiFailed(status).rejected).toBe(true);
    for (const status of [408, 429, 500, 529, null]) expect(new AiFailed(status).rejected).toBe(false);
  });

  it("reduces a provider error to its status code", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default as any;
    failure = new Anthropic.APIError(400);
    const { createClaudeProvider } = await import("../src/lib/ai/claude");
    const { AiFailed } = await import("../src/lib/ai/provider");
    const error: any = await createClaudeProvider(PLACEHOLDER, "m").generateStructured(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiFailed);
    expect(error.status).toBe(400);
    expect(String(error.message)).not.toContain("provider said something");
  });

  it("returns null when the model gives no tool call", async () => {
    reply = { content: [{ type: "text", text: "no tool" }] };
    const { createClaudeProvider } = await import("../src/lib/ai/claude");
    expect(await createClaudeProvider(PLACEHOLDER, "m").generateStructured(request)).toBeNull();
  });
});
