import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The AI Workspace data layer against a real Postgres (PGlite) built from the
 * full db/schema.sql. `@/lib/db/pool` is routed to that database, so these are
 * the exact statements the application will run.
 */

vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__aiDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__aiDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));

import * as ai from "../src/lib/aiWorkspace/queries";
import { UPLOAD_DISCLOSURE_VERSION } from "../src/lib/aiWorkspace/disclosure";

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const MODEL = { provider: "anthropic", model: "claude-sonnet-5", maxOutputTokens: 8000 };
const bytes = (s: string) => new Uint8Array(Buffer.from(s));
const megabytesFor = (n: number) => String((n + 0.5) / 1048576);

let db: PGlite;
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;

async function newAdmin(disclosure = true): Promise<string> {
  const [row] = await sql(`insert into users (email, password_hash, role) values ($1, 'x', 'admin') returning id`,
    [`${randomUUID()}@example.com`]);
  if (disclosure) await ai.acceptUploadDisclosure(row.id, UPLOAD_DISCLOSURE_VERSION);
  return row.id;
}

const upload = (userId: string, where: { projectId?: string; conversationId?: string }, name: string, body: string) =>
  ai.recordUpload(userId, { ...where, originalFilename: name, kind: "text", mimeType: "text/plain", bytes: bytes(body) })
    .then((r) => r.file);

const send = (userId: string, conversationId: string, content: string, fileIds: string[] = [], clientId: string = randomUUID()) =>
  ai.startReply(userId, { conversationId, clientId, content, fileIds, ...MODEL });

async function rejects(promise: Promise<unknown>, status: number, message?: RegExp) {
  let caught: any = null;
  try { await promise; } catch (e) { caught = e; }
  expect(caught, "expected a refusal").not.toBeNull();
  expect(caught.name).toBe("ApiError");
  expect(caught.status).toBe(status);
  if (message) expect(caught.message).toMatch(message);
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SCHEMA);
  (globalThis as any).__aiDb = db;
});

afterAll(async () => { await db.close(); });

afterEach(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith("AI_WORKSPACE_")) delete process.env[key];
});

describe("one admin can never reach another admin's workspace", () => {
  it("covers projects, conversations, messages, files and provider copies", async () => {
    const a = await newAdmin();
    const b = await newAdmin();
    const project = await ai.createProject(a, { name: "RichHabit Product", instructions: "Private instructions" });
    const conversation = await ai.createConversation(a, { projectId: project.id });
    const file = await upload(a, { conversationId: conversation.id }, "brief.txt", "brief");
    const { assistantMessage } = await send(a, conversation.id, "Hello", [file.id]);
    await ai.claimProviderCopy(a, file.id, "anthropic");

    expect(await ai.listProjects(b)).toEqual([]);
    expect(await ai.getProject(b, project.id)).toBeNull();
    expect(await ai.updateProject(b, project.id, { name: "Taken" })).toBeNull();
    expect(await ai.setProjectArchived(b, project.id, true)).toBeNull();
    expect(await ai.projectDeletionSummary(b, project.id)).toBeNull();
    expect(await ai.deleteProjectPermanently(b, project.id, "RichHabit Product")).toBeNull();
    await rejects(ai.createConversation(b, { projectId: project.id }), 404);

    expect(await ai.listConversations(b)).toEqual([]);
    expect(await ai.getConversation(b, conversation.id)).toBeNull();
    expect(await ai.renameConversation(b, conversation.id, "Taken")).toBeNull();
    expect(await ai.setConversationArchived(b, conversation.id, true)).toBeNull();
    expect(await ai.listMessages(b, conversation.id)).toBeNull();
    expect(await ai.deleteConversation(b, conversation.id)).toBeNull();
    await rejects(send(b, conversation.id, "Hi"), 404);
    await rejects(ai.startRetry(b, { messageId: assistantMessage!.id, ...MODEL }), 404);
    await rejects(ai.startContinuation(b, { messageId: assistantMessage!.id, ...MODEL }), 404);
    expect(await ai.saveReplyProgress(b, assistantMessage!.id, "taken")).toBe(false);
    expect(await ai.finishReply(b, assistantMessage!.id, { status: "stopped", content: "taken" })).toBeNull();

    await rejects(upload(b, { conversationId: conversation.id }, "x.txt", "x"), 404);
    expect(await ai.listFiles(b, { conversationId: conversation.id })).toEqual([]);
    expect(await ai.getFileContent(b, file.id)).toBeNull();
    expect(await ai.deleteFile(b, file.id)).toBeNull();
    expect(await ai.discardUnsentUpload(b, file.id)).toBe(false);
    expect(await ai.claimProviderCopy(b, file.id, "anthropic")).toBeNull();
    expect(await ai.markProviderCopyUploaded(b, file.id, "anthropic", "file_x")).toBe(false);
    expect(await ai.markProviderCopyFailed(b, file.id, "anthropic", "upload_failed")).toBe(false);
    expect(await ai.markProviderCopyDeleted(b, file.id, "anthropic")).toBe(false);

    // Everything of a's is still intact.
    expect((await ai.getProject(a, project.id))?.name).toBe("RichHabit Product");
    expect(await ai.listMessages(a, conversation.id)).toHaveLength(2);
    expect((await ai.getFileContent(a, file.id))?.file.originalFilename).toBe("brief.txt");
  });
});

describe("message order", () => {
  it("always reads a message before its reply, even when both have the same timestamp", async () => {
    const a = await newAdmin();
    const conversation = await ai.createConversation(a);
    for (let i = 0; i < 12; i++) {
      const started = await ai.startReply(a, { conversationId: conversation.id, clientId: randomUUID(), content: `m${i}`, ...MODEL });
      await ai.finishReply(a, started.assistantMessage!.id, { status: "complete", content: `r${i}`, stopReason: "end_turn" });
    }
    // Force ties for every pair, as a coarse clock produces them.
    await sql(`update ai_messages m set created_at = u.created_at from ai_messages u
                where m.reply_to_message_id = u.id and m.user_id = $1`, [a]);
    const messages = (await ai.listMessages(a, conversation.id, { limit: 200 }))!;
    expect(messages.map((m) => m.content)).toEqual(Array.from({ length: 12 }, (_, i) => [`m${i}`, `r${i}`]).flat());
  });
});

describe("upload disclosure", () => {
  it("is required, versioned, and only the current version is accepted", async () => {
    const a = await newAdmin(false);
    const conversation = await ai.createConversation(a);
    expect((await ai.getWorkspaceSettings(a)).hasAcceptedCurrentDisclosure).toBe(false);
    await rejects(upload(a, { conversationId: conversation.id }, "a.txt", "a"), 409, /upload notice/);
    await rejects(ai.acceptUploadDisclosure(a, UPLOAD_DISCLOSURE_VERSION - 1), 409);
    await rejects(ai.acceptUploadDisclosure(a, UPLOAD_DISCLOSURE_VERSION + 1), 409);
    await rejects(ai.acceptUploadDisclosure(a, String(UPLOAD_DISCLOSURE_VERSION)), 409);
    const settings = await ai.acceptUploadDisclosure(a, UPLOAD_DISCLOSURE_VERSION);
    expect(settings).toMatchObject({
      uploadDisclosureVersion: UPLOAD_DISCLOSURE_VERSION, currentDisclosureVersion: UPLOAD_DISCLOSURE_VERSION,
      hasAcceptedCurrentDisclosure: true,
    });
    expect(settings.uploadDisclosureAcceptedAt).not.toBeNull();
    await expect(upload(a, { conversationId: conversation.id }, "a.txt", "a")).resolves.toBeTruthy();
  });

  it("asks again when the disclosure version changes", async () => {
    const a = await newAdmin();
    const conversation = await ai.createConversation(a);
    vi.resetModules();
    vi.doMock("../src/lib/aiWorkspace/disclosure", () => ({
      UPLOAD_DISCLOSURE_VERSION: UPLOAD_DISCLOSURE_VERSION + 1,
      isCurrentDisclosure: (version: number | null | undefined) => version === UPLOAD_DISCLOSURE_VERSION + 1,
    }));
    const next = await import("../src/lib/aiWorkspace/queries");
    await rejects(next.recordUpload(a, { conversationId: conversation.id, originalFilename: "b.txt", kind: "text",
      mimeType: "text/plain", bytes: bytes("b") }), 409, /upload notice/);
    await rejects(next.acceptUploadDisclosure(a, UPLOAD_DISCLOSURE_VERSION), 409);
    await next.acceptUploadDisclosure(a, UPLOAD_DISCLOSURE_VERSION + 1);
    await expect(next.recordUpload(a, { conversationId: conversation.id, originalFilename: "b.txt", kind: "text",
      mimeType: "text/plain", bytes: bytes("b") })).resolves.toBeTruthy();
    vi.doUnmock("../src/lib/aiWorkspace/disclosure");
    vi.resetModules();
  });
});

describe("uploads, limits and the storage quota", () => {
  it("enforces per-kind limits, allowed types and a clean filename", async () => {
    const a = await newAdmin();
    const conversation = await ai.createConversation(a);
    process.env.AI_WORKSPACE_MAX_TEXT_MB = megabytesFor(20);
    await rejects(upload(a, { conversationId: conversation.id }, "big.txt", "x".repeat(21)), 413, /limit/);
    await expect(upload(a, { conversationId: conversation.id }, "ok.txt", "x".repeat(20))).resolves.toBeTruthy();
    await rejects(ai.recordUpload(a, { conversationId: conversation.id, originalFilename: "fake.png", kind: "image",
      mimeType: "text/html", bytes: bytes("<script>") }), 400);
    await rejects(ai.recordUpload(a, { conversationId: conversation.id, originalFilename: "x", kind: "exe",
      mimeType: "application/octet-stream", bytes: bytes("MZ") }), 400);
    await rejects(ai.recordUpload(a, { originalFilename: "x.txt", kind: "text", mimeType: "text/plain", bytes: bytes("x") }), 400);
    const named = await upload(a, { conversationId: conversation.id }, "../../etc/pa\u0000ss\nwd.txt", "named");
    expect(named.originalFilename).toBe("....etc/passwd.txt".replace("/", ""));
  });

  it("counts live files per admin, frees space on delete, and serialises concurrent uploads", async () => {
    const a = await newAdmin();
    const project = await ai.createProject(a, { name: "Quota" });
    const conversation = await ai.createConversation(a, { projectId: project.id });
    process.env.AI_WORKSPACE_STORAGE_QUOTA_MB = megabytesFor(30);
    const first = await upload(a, { projectId: project.id }, "one.txt", "x".repeat(20));
    await rejects(upload(a, { conversationId: conversation.id }, "two.txt", "y".repeat(20)), 413, /storage/);
    expect(await ai.storageUsage(a)).toEqual({ usedBytes: 20, quotaBytes: 30 });
    await ai.deleteFile(a, first.id);
    expect((await ai.storageUsage(a)).usedBytes).toBe(0);

    const results = await Promise.allSettled([
      upload(a, { conversationId: conversation.id }, "race-a.txt", "a".repeat(20)),
      upload(a, { conversationId: conversation.id }, "race-b.txt", "b".repeat(20)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await ai.storageUsage(a)).usedBytes).toBe(20);
  });

  it("returns the existing file for the same bytes in the same place, and refuses archived destinations", async () => {
    const a = await newAdmin();
    const project = await ai.createProject(a, { name: "Library" });
    const one = await ai.createConversation(a, { projectId: project.id });
    const two = await ai.createConversation(a, { projectId: project.id });
    const first = await ai.recordUpload(a, { conversationId: one.id, originalFilename: "same.txt", kind: "text", mimeType: "text/plain", bytes: bytes("same") });
    const again = await ai.recordUpload(a, { conversationId: one.id, originalFilename: "renamed.txt", kind: "text", mimeType: "text/plain", bytes: bytes("same") });
    expect(again).toEqual({ file: first.file, reused: true });
    const elsewhere = await ai.recordUpload(a, { conversationId: two.id, originalFilename: "same.txt", kind: "text", mimeType: "text/plain", bytes: bytes("same") });
    expect(elsewhere.reused).toBe(false);
    await ai.setProjectArchived(a, project.id, true);
    await rejects(upload(a, { projectId: project.id }, "late.txt", "late"), 409);
  });
});

describe("messages and attachments", () => {
  it("keeps order and only accepts eligible live files of the same admin", async () => {
    const a = await newAdmin();
    const b = await newAdmin();
    const project = await ai.createProject(a, { name: "Attachments" });
    const conversation = await ai.createConversation(a, { projectId: project.id });
    const standalone = await ai.createConversation(a);
    const other = await ai.createProject(a, { name: "Other project" });
    const fLibrary = await upload(a, { projectId: project.id }, "library.md", "library");
    const fOne = await upload(a, { conversationId: conversation.id }, "one.txt", "one");
    const fTwo = await upload(a, { conversationId: conversation.id }, "two.txt", "two");
    const fStandalone = await upload(a, { conversationId: standalone.id }, "standalone.txt", "standalone");
    const fOtherProject = await upload(a, { projectId: other.id }, "other.md", "other");
    const bConversation = await ai.createConversation(b);
    const fForeign = await upload(b, { conversationId: bConversation.id }, "theirs.txt", "theirs");

    await rejects(send(a, standalone.id, "No library here", [fLibrary.id]), 400, /can't be attached/);
    await rejects(send(a, conversation.id, "Wrong conversation", [fStandalone.id]), 400, /can't be attached/);
    await rejects(send(a, conversation.id, "Wrong project", [fOtherProject.id]), 400, /can't be attached/);
    await rejects(send(a, conversation.id, "Not mine", [fForeign.id]), 404);
    await rejects(send(a, conversation.id, "Twice", [fOne.id, fOne.id]), 400, /twice/);
    await rejects(send(a, conversation.id, "Too many", Array.from({ length: 21 }, () => randomUUID())), 400, /up to 20/);
    await rejects(send(a, conversation.id, "   "), 400);

    const started = await send(a, conversation.id, "Compare these", [fLibrary.id, fTwo.id, fOne.id]);
    expect(started.created).toBe(true);
    expect(started.userMessage.attachments.map((f) => [f.position, f.originalFilename]))
      .toEqual([[0, "library.md"], [1, "two.txt"], [2, "one.txt"]]);
    expect(started.assistantMessage).toMatchObject({ status: "streaming", replyKind: "reply", replyToMessageId: started.userMessage.id });
    const listed = await ai.listMessages(a, conversation.id);
    expect(listed!.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(listed![0].attachments.map((f) => f.originalFilename)).toEqual(["library.md", "two.txt", "one.txt"]);
    expect((await ai.getConversation(a, conversation.id))?.title).toBe("Compare these");

    await ai.finishReply(a, started.assistantMessage!.id, { status: "complete", content: "Done", stopReason: "end_turn" });
    await ai.deleteFile(a, fOne.id);
    await rejects(send(a, conversation.id, "Removed file", [fOne.id]), 409, /removed/);
    const history = await ai.listMessages(a, conversation.id);
    expect(history![0].attachments.map((f) => [f.originalFilename, f.removed]))
      .toEqual([["library.md", false], ["two.txt", false], ["one.txt", true]]);
    expect((await sql(`select count(*)::int as n from ai_message_files where message_id = $1`, [started.userMessage.id]))[0].n).toBe(3);

    const unsent = await upload(a, { conversationId: conversation.id }, "unsent.txt", "unsent");
    expect(await ai.discardUnsentUpload(a, fTwo.id)).toBe(false);
    expect(await ai.discardUnsentUpload(a, fLibrary.id)).toBe(false);
    expect(await ai.discardUnsentUpload(a, unsent.id)).toBe(true);
  });

  it("makes a repeated send idempotent and allows one reply at a time", async () => {
    const a = await newAdmin();
    const conversation = await ai.createConversation(a);
    const clientId = randomUUID();
    const first = await send(a, conversation.id, "Once", [], clientId);
    const repeat = await send(a, conversation.id, "Once", [], clientId.toUpperCase());
    expect(repeat.created).toBe(false);
    expect(repeat.userMessage.id).toBe(first.userMessage.id);
    expect(repeat.assistantMessage?.id).toBe(first.assistantMessage?.id);
    expect(await ai.listMessages(a, conversation.id)).toHaveLength(2);

    await rejects(send(a, conversation.id, "While streaming"), 409, /still being written/);
    expect(await ai.saveReplyProgress(a, first.assistantMessage!.id, "Partial")).toBe(true);
    const finished = await ai.finishReply(a, first.assistantMessage!.id, {
      status: "complete", content: "Partial and done", stopReason: "end_turn",
      inputTokens: 1200, outputTokens: 300, cacheReadTokens: 900, cacheWriteTokens: 0, contextMessages: 1, latencyMs: 2100,
    });
    expect(finished).toMatchObject({ status: "complete", content: "Partial and done", inputTokens: 1200, outputTokens: 300,
      cacheReadTokens: 900, contextMessages: 1, latencyMs: 2100 });
    expect(await ai.finishReply(a, first.assistantMessage!.id, { status: "failed", content: "", errorCode: "network" })).toBeNull();
    expect(await ai.saveReplyProgress(a, first.assistantMessage!.id, "Too late")).toBe(false);
    await expect(send(a, conversation.id, "Next")).resolves.toMatchObject({ created: true });
  });
});

describe("reply lineage", () => {
  const lineage = async (id: string) => (await sql(
    `select reply_kind, reply_to_message_id, continuation_of_message_id, retry_of_message_id from ai_messages where id = $1`, [id]))[0];

  it("continues a stopped reply once, and continues the continuation", async () => {
    const a = await newAdmin();
    const conversation = await ai.createConversation(a);
    const { userMessage, assistantMessage } = await send(a, conversation.id, "Write a long answer");
    await ai.finishReply(a, assistantMessage!.id, { status: "stopped", content: "Part one" });

    await rejects(ai.startContinuation(a, { messageId: userMessage.id, ...MODEL }), 404);
    const k1 = await ai.startContinuation(a, { messageId: assistantMessage!.id, ...MODEL });
    expect(await lineage(k1.id)).toEqual({ reply_kind: "continuation", reply_to_message_id: userMessage.id,
      continuation_of_message_id: assistantMessage!.id, retry_of_message_id: null });
    await ai.finishReply(a, k1.id, { status: "stopped", content: " part two" });
    await rejects(ai.startContinuation(a, { messageId: assistantMessage!.id, ...MODEL }), 409);
    const k2 = await ai.startContinuation(a, { messageId: k1.id, ...MODEL });
    expect((await lineage(k2.id)).continuation_of_message_id).toBe(k1.id);
  });

  it("continues only a stopped or length-limited reply", async () => {
    const a = await newAdmin();
    const conversation = await ai.createConversation(a);
    const done = await send(a, conversation.id, "Short");
    await ai.finishReply(a, done.assistantMessage!.id, { status: "complete", content: "Done", stopReason: "end_turn" });
    await rejects(ai.startContinuation(a, { messageId: done.assistantMessage!.id, ...MODEL }), 409);
    const failed = await send(a, conversation.id, "Fails");
    await ai.finishReply(a, failed.assistantMessage!.id, { status: "failed", content: "", errorCode: "overloaded" });
    await rejects(ai.startContinuation(a, { messageId: failed.assistantMessage!.id, ...MODEL }), 409);
    const long = await send(a, conversation.id, "Very long");
    await ai.finishReply(a, long.assistantMessage!.id, { status: "complete", content: "Cut", stopReason: "max_tokens" });
    await expect(ai.startContinuation(a, { messageId: long.assistantMessage!.id, ...MODEL })).resolves.toMatchObject({ replyKind: "continuation" });
  });

  it("retries the visible answer once, never a continuation, and never while streaming", async () => {
    const a = await newAdmin();
    const conversation = await ai.createConversation(a);
    const { userMessage, assistantMessage } = await send(a, conversation.id, "Try this");
    await rejects(ai.startRetry(a, { messageId: assistantMessage!.id, ...MODEL }), 409, /still being written/);
    await ai.finishReply(a, assistantMessage!.id, { status: "stopped", content: "Half" });
    const k = await ai.startContinuation(a, { messageId: assistantMessage!.id, ...MODEL });
    await ai.finishReply(a, k.id, { status: "failed", content: "", errorCode: "timeout" });
    await rejects(ai.startRetry(a, { messageId: k.id, ...MODEL }), 409);

    const t1 = await ai.startRetry(a, { messageId: assistantMessage!.id, ...MODEL });
    expect(await lineage(t1.id)).toEqual({ reply_kind: "retry", reply_to_message_id: userMessage.id,
      continuation_of_message_id: null, retry_of_message_id: assistantMessage!.id });
    await ai.finishReply(a, t1.id, { status: "complete", content: "Better", stopReason: "end_turn" });
    await rejects(ai.startRetry(a, { messageId: assistantMessage!.id, ...MODEL }), 409);
    const t2 = await ai.startRetry(a, { messageId: t1.id, ...MODEL });
    expect((await lineage(t2.id)).retry_of_message_id).toBe(t1.id);
  });
});

describe("recovery and durable limits", () => {
  it("marks replies left streaming as interrupted, and leaves recent ones alone", async () => {
    const a = await newAdmin();
    const conversation = await ai.createConversation(a);
    const old = await send(a, conversation.id, "Before a restart");
    await sql(`update ai_messages set created_at = created_at - interval '20 minutes' where id = any($1::uuid[])`,
      [[old.userMessage.id, old.assistantMessage!.id]]);
    const other = await ai.createConversation(a);
    const fresh = await send(a, other.id, "Just now");
    const messages = await ai.listMessages(a, conversation.id);
    expect(messages!.find((m) => m.id === old.assistantMessage!.id)).toMatchObject({ status: "failed", errorCode: "interrupted" });
    expect((await ai.listMessages(a, other.id))!.find((m) => m.id === fresh.assistantMessage!.id)?.status).toBe("streaming");
    expect(fresh.assistantMessage?.status).toBe("streaming");
  });

  it("counts replies from the database, so a restart does not reset limits", async () => {
    const a = await newAdmin();
    const conversation = await ai.createConversation(a);
    const since = new Date(Date.now() - 60_000);
    for (const text of ["One", "Two"]) {
      const { assistantMessage } = await send(a, conversation.id, text);
      await ai.finishReply(a, assistantMessage!.id, { status: "complete", content: "ok", stopReason: "end_turn" });
    }
    expect(await ai.countRepliesSince(a, since)).toBe(2);
    vi.resetModules();
    const reloaded = await import("../src/lib/aiWorkspace/queries");
    expect(await reloaded.countRepliesSince(a, since)).toBe(2);
  });
});

describe("archive and permanent deletion", () => {
  it("archives reversibly, and deletes a project only with its exact name", async () => {
    const a = await newAdmin();
    const b = await newAdmin();
    const project = await ai.createProject(a, { name: "Business Ideas" });
    const conversation = await ai.createConversation(a, { projectId: project.id });
    const standalone = await ai.createConversation(a);
    const library = await upload(a, { projectId: project.id }, "plan.md", "plan");
    const local = await upload(a, { conversationId: conversation.id }, "local.txt", "local");
    const { assistantMessage } = await send(a, conversation.id, "Use both", [library.id, local.id]);
    await ai.finishReply(a, assistantMessage!.id, { status: "complete", content: "ok", stopReason: "end_turn" });
    await ai.claimProviderCopy(a, library.id, "anthropic");
    await ai.markProviderCopyUploaded(a, library.id, "anthropic", "file_placeholder_library");
    const bProject = await ai.createProject(b, { name: "Business Ideas" });

    expect((await ai.setProjectArchived(a, project.id, true))?.archivedAt).not.toBeNull();
    expect(await ai.listProjects(a)).toHaveLength(0);
    expect(await ai.listProjects(a, { archived: true })).toHaveLength(1);
    expect((await ai.setProjectArchived(a, project.id, false))?.archivedAt).toBeNull();

    expect(await ai.projectDeletionSummary(a, project.id)).toEqual({ name: "Business Ideas", conversations: 1, files: 2 });
    await rejects(ai.deleteProjectPermanently(a, project.id, "business ideas"), 400);
    const deleted = await ai.deleteProjectPermanently(a, project.id, "Business Ideas");
    expect(deleted).toMatchObject({ conversations: 1, files: 2 });
    expect(deleted!.providerCopies.map((c) => [c.fileId, c.providerFileId])).toEqual([[library.id, "file_placeholder_library"]]);

    const left = (await sql(`select
        (select count(*) from ai_projects where id = $1)::int as projects,
        (select count(*) from ai_conversations where id = $2)::int as conversations,
        (select count(*) from ai_messages where conversation_id = $2)::int as messages,
        (select count(*) from ai_files where id = any($3::uuid[]))::int as files,
        (select count(*) from ai_message_files where file_id = any($3::uuid[]))::int as attachments,
        (select count(*) from ai_file_provider_copies where file_id = any($3::uuid[]))::int as copies`,
      [project.id, conversation.id, [library.id, local.id]]))[0];
    expect(left).toEqual({ projects: 0, conversations: 0, messages: 0, files: 0, attachments: 0, copies: 0 });
    expect(await ai.getConversation(a, standalone.id)).not.toBeNull();
    expect(await ai.getProject(b, bProject.id)).not.toBeNull();
  });

  it("deletes a conversation with its own files and keeps the project's library", async () => {
    const a = await newAdmin();
    const project = await ai.createProject(a, { name: "Keep library" });
    const conversation = await ai.createConversation(a, { projectId: project.id });
    const library = await upload(a, { projectId: project.id }, "keep.md", "keep");
    const local = await upload(a, { conversationId: conversation.id }, "go.txt", "go");
    const { assistantMessage } = await send(a, conversation.id, "Both", [library.id, local.id]);
    await ai.finishReply(a, assistantMessage!.id, { status: "stopped", content: "" });
    expect(await ai.deleteConversation(a, conversation.id)).toEqual({ providerCopies: [] });
    expect(await ai.getFileContent(a, library.id)).not.toBeNull();
    expect((await sql(`select count(*)::int as n from ai_files where id = $1`, [local.id]))[0].n).toBe(0);
  });
});

describe("provider copies", () => {
  it("claims once, records the uploaded id, and keeps copies of deleted files deletable", async () => {
    const a = await newAdmin();
    const conversation = await ai.createConversation(a);
    const file = await upload(a, { conversationId: conversation.id }, "copy.txt", "copy");
    const claimed = await ai.claimProviderCopy(a, file.id, "anthropic");
    expect(claimed).toMatchObject({ fileId: file.id, provider: "anthropic", status: "pending", providerFileId: null });
    expect(await ai.claimProviderCopy(a, file.id, "anthropic")).toMatchObject({ status: "pending" });
    await rejects(ai.markProviderCopyUploaded(a, file.id, "anthropic", ""), 400);
    expect(await ai.markProviderCopyUploaded(a, file.id, "anthropic", "file_placeholder")).toBe(true);
    expect(await ai.claimProviderCopy(a, file.id, "anthropic")).toMatchObject({ status: "uploaded", providerFileId: "file_placeholder" });
    await rejects(ai.claimProviderCopy(a, file.id, "Not A Provider"), 400);

    const removed = await ai.deleteFile(a, file.id);
    expect(removed!.providerCopies.map((c) => c.providerFileId)).toEqual(["file_placeholder"]);
    expect(await ai.claimProviderCopy(a, file.id, "anthropic")).toBeNull();
    expect(await ai.markProviderCopyDeleted(a, file.id, "anthropic")).toBe(true);
    expect((await sql(`select status from ai_file_provider_copies where file_id = $1`, [file.id]))[0].status).toBe("deleted");
  });
});
