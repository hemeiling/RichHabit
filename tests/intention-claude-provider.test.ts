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

  it("sends a workspace header only when a workspace is configured", async () => {
    const { createClaudeProvider } = await import("../src/lib/ai/claude");
    createClaudeProvider(PLACEHOLDER, "claude-sonnet-5");
    createClaudeProvider(PLACEHOLDER, "claude-sonnet-5", "wrkspc_placeholder");
    expect(constructed[0].defaultHeaders).toBeUndefined();
    expect(constructed[1].defaultHeaders).toEqual({ "anthropic-workspace-id": "wrkspc_placeholder" });
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
