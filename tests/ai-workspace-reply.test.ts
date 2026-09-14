import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Writing a reply end to end against a real Postgres (PGlite) built from
 * db/schema.sql, with a recording provider in place of Claude: what is sent,
 * what is saved while streaming, and the final state after completion, Stop,
 * failure, Continue and Retry. Also: files reach the provider only when
 * attached, and a stored provider copy is reused.
 */

vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__aiReplyDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__aiReplyDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));

import * as ai from "../src/lib/aiWorkspace/queries";
import { UPLOAD_DISCLOSURE_VERSION } from "../src/lib/aiWorkspace/disclosure";
import type { AiMessage } from "../src/lib/aiWorkspace/types";
import { CONTINUE_INSTRUCTION, type ContextMode } from "../src/lib/aiWorkspaceRuntime/context";
import {
  ProviderAborted, ProviderFailure, type ChatRequest, type ChatResult, type WorkspaceProvider,
} from "../src/lib/aiWorkspaceRuntime/provider";
import { resetReplySlots, reserveReply } from "../src/lib/aiWorkspaceRuntime/limits";
import { runReply, type ReplyEvent } from "../src/lib/aiWorkspaceRuntime/reply";
import { conversationView } from "../src/lib/aiWorkspaceRuntime/view";

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const SETTINGS = { provider: "anthropic", model: "claude-sonnet-5", maxOutputTokens: 8000 };
const PDF = new Uint8Array(Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

let db: PGlite;
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SCHEMA);
  (globalThis as any).__aiReplyDb = db;
});
afterAll(async () => { await db.close(); });
afterEach(() => {
  resetReplySlots();
  vi.restoreAllMocks();
});

async function newAdmin(): Promise<string> {
  const [row] = await sql(`insert into users (email, password_hash, role) values ($1, 'x', 'admin') returning id`,
    [`${randomUUID()}@example.com`]);
  await ai.acceptUploadDisclosure(row.id, UPLOAD_DISCLOSURE_VERSION);
  return row.id;
}

type Script = (request: ChatRequest, onText: (d: string) => void) => Promise<ChatResult>;
const done = (stopReason = "end_turn"): ChatResult =>
  ({ stopReason, inputTokens: 12, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 });

function recorder(script: Script = async (_r, onText) => { onText("Hel"); onText("lo"); return done(); }) {
  const requests: ChatRequest[] = [];
  const uploads: string[] = [];
  const provider: WorkspaceProvider = {
    id: "anthropic",
    async uploadFile({ filename }) { uploads.push(filename); return `file_${uploads.length}`; },
    async deleteFile() {},
    async streamChat(request, onText) {
      requests.push(request);
      return script(request, onText);
    },
  };
  return { provider, requests, uploads };
}

const abortable = (signal: AbortSignal) => new Promise<never>((_, reject) => {
  if (signal.aborted) reject(new ProviderAborted());
  signal.addEventListener("abort", () => reject(new ProviderAborted()), { once: true });
});

async function reply(userId: string, assistant: AiMessage, mode: ContextMode, provider: WorkspaceProvider,
  controller = new AbortController()) {
  const conversation = await ai.getConversation(userId, assistant.conversationId);
  const events: ReplyEvent[] = [];
  const message = await runReply({
    userId, conversation: conversation!, assistant, mode, provider, signal: controller.signal, emit: (e) => events.push(e),
  });
  return { message, events };
}

async function send(userId: string, conversationId: string, content: string, fileIds: string[], provider: WorkspaceProvider) {
  const started = await ai.startReply(userId, { conversationId, clientId: randomUUID(), content, fileIds, ...SETTINGS });
  return reply(userId, started.assistantMessage!, { kind: "reply", userMessageId: started.userMessage.id }, provider);
}

const row = async (id: string) => (await sql(`select * from ai_messages where id = $1`, [id]))[0];

describe("writing a reply", () => {
  it("streams the text as it arrives and saves the finished reply with its usage", async () => {
    const admin = await newAdmin();
    const c = await ai.createConversation(admin);
    const { provider, requests } = recorder();
    const { message, events } = await send(admin, c.id, "Hello there", [], provider);

    expect(events.filter((e) => e.type === "delta").map((e) => (e as any).text)).toEqual(["Hel", "lo"]);
    expect(events[events.length - 1]).toMatchObject({ type: "done", message: { status: "complete", content: "Hello" } });
    const saved = await row(message!.id);
    expect(saved).toMatchObject({ status: "complete", content: "Hello", stop_reason: "end_turn", input_tokens: 12, output_tokens: 5, context_messages: 1 });
    expect(saved.latency_ms).not.toBeNull();
    expect(requests[0].model).toBe("claude-sonnet-5");
    expect(requests[0].maxOutputTokens).toBe(8000);
    expect(requests[0].turns).toEqual([{ role: "user", parts: [{ type: "text", text: "Hello there" }] }]);
  });

  it("saves the text while the reply is still streaming", async () => {
    const admin = await newAdmin();
    const c = await ai.createConversation(admin);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { provider } = recorder(async (_r, onText) => {
      onText("Part one. ");
      await new Promise((r) => setTimeout(r, 1100));
      onText("Part two. ");
      await gate;
      return done();
    });
    const started = await ai.startReply(admin, { conversationId: c.id, clientId: randomUUID(), content: "Go", ...SETTINGS });
    const running = reply(admin, started.assistantMessage!, { kind: "reply", userMessageId: started.userMessage.id }, provider);

    let saved = "";
    for (let i = 0; i < 40 && !saved.includes("Part two"); i++) {
      await new Promise((r) => setTimeout(r, 50));
      saved = (await row(started.assistantMessage!.id)).content;
    }
    expect(saved).toBe("Part one. Part two. ");
    expect((await row(started.assistantMessage!.id)).status).toBe("streaming");
    release();
    expect((await running).message).toMatchObject({ status: "complete" });
  });

  it("saves what was written as stopped when the request is aborted, and offers Continue", async () => {
    const admin = await newAdmin();
    const c = await ai.createConversation(admin);
    const controller = new AbortController();
    const { provider } = recorder(async (request, onText) => {
      onText("Partial answer");
      setTimeout(() => controller.abort(), 10);
      return abortable(request.signal);
    });
    const started = await ai.startReply(admin, { conversationId: c.id, clientId: randomUUID(), content: "Long one", ...SETTINGS });
    const { message } = await reply(admin, started.assistantMessage!, { kind: "reply", userMessageId: started.userMessage.id },
      provider, controller);

    expect(message).toMatchObject({ status: "stopped", content: "Partial answer" });
    const view = await conversationView(admin, c.id);
    expect(view!.exchanges[0]).toMatchObject({ continueTargetId: message!.id, retryTargetId: message!.id });
  });

  it("saves a failure with its code, keeps partial text, and logs no words", async () => {
    const admin = await newAdmin();
    const c = await ai.createConversation(admin);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { provider } = recorder(async (_r, onText) => {
      onText("Half");
      throw new ProviderFailure("overloaded", 529);
    });
    const { message } = await send(admin, c.id, "SECRET-PROMPT-WORDS", [], provider);

    expect(message).toMatchObject({ status: "failed", errorCode: "overloaded", content: "Half" });
    expect(logged).toHaveBeenCalledWith("[ai-workspace] reply failed provider=anthropic capability=text status=5xx code=overloaded");
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(/SECRET-PROMPT-WORDS|Half/);
  });

  it("continues a stopped reply from its text, and retries with lineage", async () => {
    const admin = await newAdmin();
    const c = await ai.createConversation(admin);
    const controller = new AbortController();
    const stopping = recorder(async (request, onText) => {
      onText("Step one");
      setTimeout(() => controller.abort(), 10);
      return abortable(request.signal);
    });
    const started = await ai.startReply(admin, { conversationId: c.id, clientId: randomUUID(), content: "Plan", ...SETTINGS });
    const stopped = (await reply(admin, started.assistantMessage!, { kind: "reply", userMessageId: started.userMessage.id },
      stopping.provider, controller)).message!;

    const cont = recorder(async (_r, onText) => { onText(", step two."); return done(); });
    const continuation = await ai.startContinuation(admin, { messageId: stopped.id, ...SETTINGS });
    const continued = (await reply(admin, continuation, { kind: "continue", targetMessageId: stopped.id }, cont.provider)).message!;
    expect(cont.requests[0].turns).toEqual([
      { role: "user", parts: [{ type: "text", text: "Plan" }] },
      { role: "assistant", parts: [{ type: "text", text: "Step one" }] },
      { role: "user", parts: [{ type: "text", text: CONTINUE_INSTRUCTION }] },
    ]);
    expect(await row(continued.id)).toMatchObject({ reply_kind: "continuation", continuation_of_message_id: stopped.id, status: "complete" });

    const again = recorder(async (_r, onText) => { onText("A new plan."); return done(); });
    const retry = await ai.startRetry(admin, { messageId: stopped.id, ...SETTINGS });
    await reply(admin, retry, { kind: "retry", targetMessageId: stopped.id }, again.provider);
    expect(again.requests[0].turns).toEqual([{ role: "user", parts: [{ type: "text", text: "Plan" }] }]);
    expect(await row(retry.id)).toMatchObject({ reply_kind: "retry", retry_of_message_id: stopped.id, status: "complete" });

    const view = await conversationView(admin, c.id);
    expect(view!.exchanges[0].chain).toEqual([retry.id]);
  });
});

describe("files and context layers", () => {
  it("sends only attached files, uploads each PDF or image once, and reuses the stored copy", async () => {
    const admin = await newAdmin();
    const project = await ai.createProject(admin, { name: "Launch", instructions: "Answer as a CFO." });
    const c = await ai.createConversation(admin, { projectId: project.id });
    await ai.recordUpload(admin, { projectId: project.id, originalFilename: "LIBRARY-ONLY.pdf", kind: "pdf", mimeType: "application/pdf", bytes: PDF });
    const image = (await ai.recordUpload(admin, { conversationId: c.id, originalFilename: "photo.png", kind: "image", mimeType: "image/png", bytes: PNG })).file;
    const notes = (await ai.recordUpload(admin, { conversationId: c.id, originalFilename: "notes.txt", kind: "text", mimeType: "text/plain", bytes: new Uint8Array(Buffer.from("会议纪要：预算")) })).file;

    const { provider, requests, uploads } = recorder();
    await send(admin, c.id, "Look at these", [image.id, notes.id], provider);
    expect(requests[0].system).toContain("<project_instructions>\nAnswer as a CFO.\n</project_instructions>");
    expect(requests[0].turns[0].parts).toEqual([
      { type: "image", source: { kind: "file", providerFileId: "file_1" } },
      { type: "document", title: "notes.txt", source: { kind: "text", text: "会议纪要：预算" } },
      { type: "text", text: "Look at these" },
    ]);
    expect(JSON.stringify(requests)).not.toContain("LIBRARY-ONLY");

    await send(admin, c.id, "And this one again", [image.id], provider);
    expect(uploads).toEqual(["photo.png"]);
    const copies = await sql(`select status, provider_file_id from ai_file_provider_copies where file_id = $1`, [image.id]);
    expect(copies).toEqual([{ status: "uploaded", provider_file_id: "file_1" }]);
    expect(requests[1].turns[requests[1].turns.length - 1].parts[0])
      .toEqual({ type: "image", source: { kind: "file", providerFileId: "file_1" } });
  });

  it("attaches a project library file only when chosen, and says when an attached file was removed", async () => {
    const admin = await newAdmin();
    const project = await ai.createProject(admin, { name: "Board" });
    const c = await ai.createConversation(admin, { projectId: project.id });
    const report = (await ai.recordUpload(admin, { projectId: project.id, originalFilename: "report.pdf", kind: "pdf", mimeType: "application/pdf", bytes: PDF })).file;

    const { provider, requests } = recorder();
    await send(admin, c.id, "Summarise", [report.id], provider);
    expect(requests[0].turns[0].parts[0]).toEqual({ type: "document", title: "report.pdf", source: { kind: "file", providerFileId: "file_1" } });

    await ai.deleteFile(admin, report.id);
    await send(admin, c.id, "Thanks", [], provider);
    expect(requests[1].turns[0].parts[0]).toEqual({ type: "text", text: '[The file "report.pdf" was attached here but has since been removed.]' });
    const view = await conversationView(admin, c.id);
    // Found by content: PGlite's clock can give a message and its reply the same instant.
    const summarise = view!.messages.find((m) => m.role === "user" && m.content === "Summarise");
    expect(summarise!.attachments.map((a) => [a.originalFilename, a.removed])).toEqual([["report.pdf", true]]);
  });

  it("sends the file inline for this request when uploading a copy fails", async () => {
    const admin = await newAdmin();
    const c = await ai.createConversation(admin);
    const pdf = (await ai.recordUpload(admin, { conversationId: c.id, originalFilename: "plan.pdf", kind: "pdf", mimeType: "application/pdf", bytes: PDF })).file;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { provider, requests } = recorder();
    provider.uploadFile = async () => { throw new ProviderFailure("network"); };
    await send(admin, c.id, "Read it", [pdf.id], provider);
    expect(requests[0].turns[0].parts[0]).toEqual({
      type: "document", title: "plan.pdf", source: { kind: "base64", mimeType: "application/pdf", data: Buffer.from(PDF).toString("base64") },
    });
    expect(await sql(`select status, failure_code from ai_file_provider_copies where file_id = $1`, [pdf.id]))
      .toEqual([{ status: "failed", failure_code: "network" }]);
  });
});

describe("a reply left behind by a restart", () => {
  it("is recovered as interrupted when nothing in this process is writing it", async () => {
    const admin = await newAdmin();
    const c = await ai.createConversation(admin);
    const left = await ai.startReply(admin, { conversationId: c.id, clientId: randomUUID(), content: "Hi", ...SETTINGS });
    await sql(`update ai_messages set created_at = now() - interval '1 minute' where id = $1`, [left.assistantMessage!.id]);

    const view = await conversationView(admin, c.id);
    expect(view!.messages.find((m) => m.id === left.assistantMessage!.id)).toMatchObject({ status: "failed", errorCode: "interrupted" });
    expect(view!.exchanges[0].retryTargetId).toBe(left.assistantMessage!.id);
  });

  it("is left alone while a request here is still writing it", async () => {
    const admin = await newAdmin();
    const c = await ai.createConversation(admin);
    const running = await ai.startReply(admin, { conversationId: c.id, clientId: randomUUID(), content: "Hi", ...SETTINGS });
    await sql(`update ai_messages set created_at = now() - interval '1 minute' where id = $1`, [running.assistantMessage!.id]);
    const slot = reserveReply(admin)!;
    slot.messageId = running.assistantMessage!.id;

    const view = await conversationView(admin, c.id);
    expect(view!.messages.find((m) => m.id === running.assistantMessage!.id)!.status).toBe("streaming");
  });
});
