import { describe, expect, it } from "vitest";
import type { AiAttachment, AiMessage } from "../src/lib/aiWorkspace/types";
import {
  CONTINUE_INSTRUCTION, WORKSPACE_INSTRUCTIONS, assembleContext, estimateTextTokens, systemPrompt, userTurn,
} from "../src/lib/aiWorkspaceRuntime/context";
import { detectFileType } from "../src/lib/aiWorkspaceRuntime/fileType";
import { localiseError } from "../src/lib/aiWorkspaceRuntime/http";
import {
  isReplyRunning, releaseReply, reserveReply, resetReplySlots, stopRunningReply,
} from "../src/lib/aiWorkspaceRuntime/limits";
import { normaliseStopReason, scriptedProviderAllowed } from "../src/lib/aiWorkspaceRuntime/provider";
import { buildExchanges } from "../src/lib/aiWorkspaceRuntime/view";
import { dict } from "../src/lib/i18n";

/**
 * The AI Workspace runtime's pure rules: what a file is, what reaches the
 * model, how refusals read, one reply at a time, and which answer is shown.
 */

let tick = 0;
function msg(p: Partial<AiMessage> & Pick<AiMessage, "id" | "role">): AiMessage {
  tick += 1;
  return {
    conversationId: "c", content: "", status: "complete", errorCode: null, clientId: null,
    replyKind: p.role === "assistant" ? "reply" : null, replyToMessageId: null,
    continuationOfMessageId: null, retryOfMessageId: null, provider: null, model: null, maxOutputTokens: null,
    stopReason: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
    contextMessages: null, latencyMs: null, createdAt: new Date(Date.UTC(2026, 8, 13, 0, 0, tick)).toISOString(),
    completedAt: null, attachments: [], ...p,
  };
}
const att = (p: Partial<AiAttachment>): AiAttachment => ({
  fileId: "f", position: 0, originalFilename: "a.pdf", kind: "pdf", mimeType: "application/pdf",
  byteSize: 1000, removed: false, ...p,
});
const bytes = (...parts: (number | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...Buffer.from(p, "latin1")] : [p])));
const BUDGET = { targetTokens: 150_000 };

describe("what an uploaded file is", () => {
  it("is decided from its bytes", () => {
    expect(detectFileType(bytes("%PDF-1.7\n%âãÏÓ"))).toEqual({ kind: "pdf", mimeType: "application/pdf" });
    expect(detectFileType(bytes(0x89, "PNG\r\n", 0x1a, "\n", 0, 0, 0, 13))).toEqual({ kind: "image", mimeType: "image/png" });
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16))).toEqual({ kind: "image", mimeType: "image/jpeg" });
    expect(detectFileType(bytes("GIF89a", 1, 0, 1, 0))).toEqual({ kind: "image", mimeType: "image/gif" });
    expect(detectFileType(bytes("RIFF", 36, 0, 0, 0, "WEBPVP8 "))).toEqual({ kind: "image", mimeType: "image/webp" });
    expect(detectFileType(new Uint8Array(Buffer.from("会议纪要\nsecond line\tok\r\n", "utf8"))))
      .toEqual({ kind: "text", mimeType: "text/plain" });
  });

  it("refuses anything it cannot vouch for", () => {
    expect(detectFileType(new Uint8Array())).toBeNull();
    expect(detectFileType(bytes("PK", 3, 4, 20, 0, 0, 0))).toBeNull();          // an archive, or a .docx
    expect(detectFileType(bytes("MZ", 0x90, 0, 3, 0))).toBeNull();              // an executable
    expect(detectFileType(bytes(0xc3, 0x28, 0x61))).toBeNull();                 // not UTF-8
    expect(detectFileType(bytes("a", 1, 2, 3, 4, 5, "b"))).toBeNull();          // control characters
  });
});

describe("what the model receives", () => {
  it("starts from the workspace instructions, with project instructions in their own block", () => {
    expect(systemPrompt(null)).toBe(WORKSPACE_INSTRUCTIONS);
    expect(systemPrompt("   ")).toBe(WORKSPACE_INSTRUCTIONS);
    const withProject = systemPrompt("Answer as a CFO.");
    expect(withProject.startsWith(WORKSPACE_INSTRUCTIONS)).toBe(true);
    expect(withProject).toContain("<project_instructions>\nAnswer as a CFO.\n</project_instructions>");
    expect(WORKSPACE_INSTRUCTIONS).toMatch(/cannot see RichHabit's database/);
    expect(WORKSPACE_INSTRUCTIONS).toMatch(/habits, priorities, intentions, journals/);
  });

  it("is built from the conversation, instructions and a budget, and nothing else", () => {
    expect(assembleContext.length).toBe(5);
  });

  it("sends earlier finished exchanges, then the message being answered", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "First question" }),
      msg({ id: "a1", role: "assistant", content: "First answer", replyToMessageId: "u1" }),
      msg({ id: "u2", role: "user", content: "Second question" }),
      msg({ id: "a2", role: "assistant", status: "streaming", replyToMessageId: "u2" }),
    ];
    const ctx = assembleContext(messages, { kind: "reply", userMessageId: "u2" }, null, BUDGET, "a2");
    expect(ctx.turns).toEqual([
      { role: "user", parts: [{ type: "text", text: "First question" }] },
      { role: "assistant", parts: [{ type: "text", text: "First answer" }] },
      { role: "user", parts: [{ type: "text", text: "Second question" }] },
    ]);
    expect(ctx.contextMessages).toBe(3);
    expect(ctx.droppedExchanges).toBe(0);
  });

  it("keeps what the admin wrote, but not answers that failed or were stopped", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "One" }),
      msg({ id: "a1", role: "assistant", status: "failed", errorCode: "overloaded", content: "Par", replyToMessageId: "u1" }),
      msg({ id: "u2", role: "user", content: "Two" }),
      msg({ id: "a2", role: "assistant", status: "stopped", content: "Half an answer", replyToMessageId: "u2" }),
      msg({ id: "u3", role: "user", content: "Three" }),
      msg({ id: "a3", role: "assistant", status: "streaming", replyToMessageId: "u3" }),
    ];
    const ctx = assembleContext(messages, { kind: "reply", userMessageId: "u3" }, null, BUDGET, "a3");
    expect(ctx.turns).toEqual([{
      role: "user",
      parts: [{ type: "text", text: "One" }, { type: "text", text: "Two" }, { type: "text", text: "Three" }],
    }]);
  });

  it("sends a continued answer as one text once it finished", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "Write a story" }),
      msg({ id: "r1", role: "assistant", status: "stopped", content: "Once upon ", replyToMessageId: "u1" }),
      msg({ id: "k1", role: "assistant", replyKind: "continuation", continuationOfMessageId: "r1", content: "a time.", replyToMessageId: "u1" }),
      msg({ id: "u2", role: "user", content: "Shorter" }),
    ];
    const ctx = assembleContext(messages, { kind: "reply", userMessageId: "u2" }, null, BUDGET, "none");
    expect(ctx.turns[1]).toEqual({ role: "assistant", parts: [{ type: "text", text: "Once upon a time." }] });
    expect(ctx.contextMessages).toBe(4);
  });

  it("continues from the saved text, with a fixed instruction", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "Write a long plan" }),
      msg({ id: "r1", role: "assistant", status: "stopped", content: "Step one", replyToMessageId: "u1" }),
      msg({ id: "k1", role: "assistant", status: "streaming", replyKind: "continuation", continuationOfMessageId: "r1", replyToMessageId: "u1" }),
    ];
    const ctx = assembleContext(messages, { kind: "continue", targetMessageId: "r1" }, null, BUDGET, "k1");
    expect(ctx.turns).toEqual([
      { role: "user", parts: [{ type: "text", text: "Write a long plan" }] },
      { role: "assistant", parts: [{ type: "text", text: "Step one" }] },
      { role: "user", parts: [{ type: "text", text: CONTINUE_INSTRUCTION }] },
    ]);
  });

  it("retries by asking the same message again, without anything said after it", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "Q1" }),
      msg({ id: "a1", role: "assistant", content: "A1", replyToMessageId: "u1" }),
      msg({ id: "u2", role: "user", content: "Q2" }),
      msg({ id: "a2", role: "assistant", content: "A2", replyToMessageId: "u2" }),
      msg({ id: "t1", role: "assistant", status: "streaming", replyKind: "retry", retryOfMessageId: "a1", replyToMessageId: "u1" }),
    ];
    const ctx = assembleContext(messages, { kind: "retry", targetMessageId: "a1" }, null, BUDGET, "t1");
    expect(ctx.turns).toEqual([{ role: "user", parts: [{ type: "text", text: "Q1" }] }]);
  });

  it("puts a message's files first, in the order attached, and names a removed one", () => {
    const turn = userTurn(msg({
      id: "u1", role: "user", content: "Compare these",
      attachments: [
        att({ fileId: "b", position: 1, originalFilename: "b.png", kind: "image", mimeType: "image/png" }),
        att({ fileId: "a", position: 0, originalFilename: "a.pdf" }),
        att({ fileId: "c", position: 2, originalFilename: "c.txt", kind: "text", mimeType: "text/plain", removed: true }),
      ],
    }));
    expect(turn.parts.map((p) => (p.type === "file" ? p.attachment.fileId : p.type))).toEqual(["a", "b", "removed-file", "text"]);
    expect(turn.parts[2]).toEqual({ type: "removed-file", filename: "c.txt" });
  });

  it("leaves out the oldest exchanges first to stay in budget, never the message being answered", () => {
    const big = "x".repeat(40_000);
    const messages = [
      msg({ id: "u1", role: "user", content: big }),
      msg({ id: "a1", role: "assistant", content: "ok", replyToMessageId: "u1" }),
      msg({ id: "u2", role: "user", content: big }),
      msg({ id: "a2", role: "assistant", content: "ok", replyToMessageId: "u2" }),
      msg({ id: "u3", role: "user", content: "now" }),
    ];
    const some = assembleContext(messages, { kind: "reply", userMessageId: "u3" }, null, { targetTokens: 15_000 }, "none");
    expect(some.droppedExchanges).toBe(1);
    expect(some.turns).toHaveLength(3);
    expect(some.turns[2]).toEqual({ role: "user", parts: [{ type: "text", text: "now" }] });

    const none = assembleContext(messages, { kind: "reply", userMessageId: "u3" }, null, { targetTokens: 100 }, "none");
    expect(none.droppedExchanges).toBe(2);
    expect(none.turns).toEqual([{ role: "user", parts: [{ type: "text", text: "now" }] }]);
  });

  it("counts ideographs as a token each", () => {
    expect(estimateTextTokens("你好世界")).toBe(4);
    expect(estimateTextTokens("abcdefgh")).toBe(2);
  });
});

describe("how a reply ended", () => {
  it("is reduced to the reasons the workspace acts on", () => {
    expect(normaliseStopReason("max_tokens")).toBe("max_tokens");
    expect(normaliseStopReason("refusal")).toBe("refusal");
    expect(normaliseStopReason("model_context_window_exceeded")).toBe("context_window");
    expect(normaliseStopReason("end_turn")).toBe("end_turn");
    expect(normaliseStopReason("stop_sequence")).toBe("end_turn");
    expect(normaliseStopReason(null)).toBe("end_turn");
  });
});

describe("the scripted provider", () => {
  const env = (over: Record<string, string | undefined>) => ({
    AI_WORKSPACE_FAKE_PROVIDER: "1", RH_TEST_INSTANCE: "true", NODE_ENV: "development",
    DATABASE_URL: "postgres://postgres@127.0.0.1:5434/postgres", ...over,
  }) as unknown as NodeJS.ProcessEnv;

  it("is only ever used by a local test instance that asks for it", () => {
    expect(scriptedProviderAllowed(env({}))).toBe(true);
    expect(scriptedProviderAllowed(env({ AI_WORKSPACE_FAKE_PROVIDER: undefined }))).toBe(false);
    expect(scriptedProviderAllowed(env({ RH_TEST_INSTANCE: undefined }))).toBe(false);
    expect(scriptedProviderAllowed(env({ NODE_ENV: "production" }))).toBe(false);
    expect(scriptedProviderAllowed(env({ DATABASE_URL: "postgresql://u:p@ep-example.neon.tech/neondb" }))).toBe(false);
    expect(scriptedProviderAllowed(env({ DATABASE_URL: "" }))).toBe(false);
  });
});

describe("refusals, in the reader's language", () => {
  const en = dict("en");
  const zh = dict("zh");

  it("translates the data layer's refusals and keeps their numbers", () => {
    expect(localiseError("Not enough storage: 0.4 MB left of 1 MB", en)).toBe("Not enough storage: 0.4 MB left of 1 MB.");
    expect(localiseError("Not enough storage: 0.4 MB left of 1 MB", zh)).toBe("存储空间不足：共 1 MB，剩余 0.4 MB。");
    expect(localiseError("That file is larger than the 10 MB limit", zh)).toBe("文件超过了 10 MB 的上限。");
    expect(localiseError("A reply is still being written. Stop it or wait for it to finish.", zh)).toBe(zh.aiWorkspace.errors.busy);
    expect(localiseError("Conversation not found", zh)).toBe(zh.aiWorkspace.errors.notFound);
    expect(localiseError("Review the upload notice before uploading files", zh)).toBe(zh.aiWorkspace.errors.disclosureRequired);
  });

  it("never passes an unrecognised internal message through", () => {
    expect(localiseError("duplicate key value violates unique constraint", en)).toBe(en.aiWorkspace.errors.generic);
    expect(localiseError("clientId must be a uuid", zh)).toBe(zh.aiWorkspace.errors.generic);
  });
});

describe("one reply at a time", () => {
  it("reserves a slot per admin, synchronously, and stops only the reply it names", () => {
    resetReplySlots();
    const slot = reserveReply("admin-a");
    expect(slot).not.toBeNull();
    expect(reserveReply("admin-a")).toBeNull();
    expect(reserveReply("admin-b")).not.toBeNull();

    slot!.messageId = "m1";
    expect(isReplyRunning("admin-a", "m1")).toBe(true);
    expect(stopRunningReply("admin-a", "m2")).toBe(false);
    expect(stopRunningReply("admin-b", "m1")).toBe(false);
    expect(stopRunningReply("admin-a", "m1")).toBe(true);
    expect(slot!.controller.signal.aborted).toBe(true);

    releaseReply(slot!);
    expect(reserveReply("admin-a")).not.toBeNull();
    resetReplySlots();
  });
});

describe("the answer shown for each message", () => {
  it("offers Continue and Retry exactly where the lifecycle allows", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "1" }),
      msg({ id: "r1", role: "assistant", status: "stopped", content: "x", replyToMessageId: "u1" }),
      msg({ id: "u2", role: "user", content: "2" }),
      msg({ id: "a2", role: "assistant", stopReason: "max_tokens", content: "y", replyToMessageId: "u2" }),
      msg({ id: "u3", role: "user", content: "3" }),
      msg({ id: "a3", role: "assistant", status: "failed", replyToMessageId: "u3" }),
      msg({ id: "t3", role: "assistant", replyKind: "retry", retryOfMessageId: "a3", content: "z", replyToMessageId: "u3" }),
      msg({ id: "u4", role: "user", content: "4" }),
      msg({ id: "a4", role: "assistant", status: "streaming", replyToMessageId: "u4" }),
    ];
    expect(buildExchanges(messages)).toEqual([
      { userMessageId: "u1", chain: ["r1"], retryTargetId: "r1", continueTargetId: "r1" },
      { userMessageId: "u2", chain: ["a2"], retryTargetId: "a2", continueTargetId: "a2" },
      { userMessageId: "u3", chain: ["t3"], retryTargetId: "t3", continueTargetId: null },
      { userMessageId: "u4", chain: ["a4"], retryTargetId: null, continueTargetId: null },
    ]);
  });
});
