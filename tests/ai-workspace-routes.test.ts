import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The AI Workspace API, route by route, against a real Postgres (PGlite) and a
 * recording provider: admin-only access, streaming, idempotent sends, one reply
 * at a time, limits, Stop/Continue/Retry, uploads, projects, and one admin kept
 * out of another's workspace.
 */

vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__aiRouteDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__aiRouteDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined }),
  headers: () => new Map(),
}));
let caller: { id: string; email: string } | null = null;
vi.mock("@/lib/admin", () => ({ currentAdmin: async () => caller }));

import * as root from "../src/app/api/admin/ai/workspace/route";
import * as projects from "../src/app/api/admin/ai/workspace/projects/route";
import * as project from "../src/app/api/admin/ai/workspace/projects/[id]/route";
import * as conversations from "../src/app/api/admin/ai/workspace/conversations/route";
import * as conversation from "../src/app/api/admin/ai/workspace/conversations/[id]/route";
import * as messages from "../src/app/api/admin/ai/workspace/conversations/[id]/messages/route";
import * as cont from "../src/app/api/admin/ai/workspace/messages/[id]/continue/route";
import * as retry from "../src/app/api/admin/ai/workspace/messages/[id]/retry/route";
import * as stop from "../src/app/api/admin/ai/workspace/messages/[id]/stop/route";
import * as files from "../src/app/api/admin/ai/workspace/files/route";
import * as file from "../src/app/api/admin/ai/workspace/files/[id]/route";
import * as disclosure from "../src/app/api/admin/ai/workspace/disclosure/route";
import { UPLOAD_DISCLOSURE_VERSION } from "../src/lib/aiWorkspace/disclosure";
import { resetReplySlots } from "../src/lib/aiWorkspaceRuntime/limits";
import {
  ProviderAborted, setWorkspaceProviderForTests, type ChatRequest, type ChatResult, type WorkspaceProvider,
} from "../src/lib/aiWorkspaceRuntime/provider";

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 8, 0]);

let db: PGlite;
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;

type Script = (request: ChatRequest, onText: (d: string) => void) => Promise<ChatResult>;
const finished: ChatResult = { stopReason: "end_turn", inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 };
let script: Script;
const requests: ChatRequest[] = [];
const provider: WorkspaceProvider = {
  id: "anthropic",
  async uploadFile() { return `file_${randomUUID()}`; },
  async deleteFile() {},
  async streamChat(request, onText) {
    requests.push(request);
    return script(request, onText);
  },
};

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SCHEMA);
  (globalThis as any).__aiRouteDb = db;
});
afterAll(async () => { await db.close(); });
beforeEach(() => {
  requests.length = 0;
  script = async (_r, onText) => { onText("Hello"); onText(" there"); return finished; };
  setWorkspaceProviderForTests(provider);
});
afterEach(() => {
  caller = null;
  resetReplySlots();
  setWorkspaceProviderForTests(undefined);
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) if (key.startsWith("AI_WORKSPACE_")) delete process.env[key];
});

async function newAdmin(): Promise<string> {
  const [row] = await sql(`insert into users (email, password_hash, role) values ($1, 'x', 'admin') returning id`,
    [`${randomUUID()}@example.com`]);
  return row.id;
}
const as = (id: string) => { caller = { id, email: "admin@example.com" }; };

const URL_BASE = "http://localhost/api/admin/ai/workspace";
const req = (method: string, p: string, body?: unknown) => new Request(`${URL_BASE}${p}`, {
  method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});
const upload = (name: string, bytes: Buffer, where: Record<string, string>) => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type: "application/octet-stream" }));
  for (const [k, v] of Object.entries(where)) form.append(k, v);
  return new Request(`${URL_BASE}/files`, { method: "POST", body: form });
};
const p = (id: string) => ({ params: { id } });
const body = async (res: Response) => res.json();
const lines = async (res: Response) => (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

async function* events(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim()) yield JSON.parse(line);
    }
  }
}

async function setUp() {
  const admin = await newAdmin();
  as(admin);
  await disclosure.POST(req("POST", "/disclosure", { version: UPLOAD_DISCLOSURE_VERSION }));
  const { conversation: c } = await body(await conversations.POST(req("POST", "/conversations", {})));
  return { admin, conversationId: c.id as string };
}

describe("who can reach the workspace", () => {
  it("answers 404 to anyone who is not an admin, on every route, before doing anything", async () => {
    caller = null;
    const id = randomUUID();
    const responses = await Promise.all([
      root.GET(),
      projects.GET(req("GET", "/projects")),
      projects.POST(req("POST", "/projects", { name: "x" })),
      project.GET(req("GET", `/projects/${id}`), p(id)),
      project.PATCH(req("PATCH", `/projects/${id}`, { name: "x" }), p(id)),
      project.DELETE(req("DELETE", `/projects/${id}`, { confirmName: "x" }), p(id)),
      conversations.GET(req("GET", "/conversations")),
      conversations.POST(req("POST", "/conversations", {})),
      conversation.GET(req("GET", `/conversations/${id}`), p(id)),
      conversation.PATCH(req("PATCH", `/conversations/${id}`, { title: "x" }), p(id)),
      conversation.DELETE(req("DELETE", `/conversations/${id}`), p(id)),
      messages.POST(req("POST", `/conversations/${id}/messages`, { clientId: randomUUID(), content: "hi" }), p(id)),
      cont.POST(req("POST", `/messages/${id}/continue`, {}), p(id)),
      retry.POST(req("POST", `/messages/${id}/retry`, {}), p(id)),
      stop.POST(req("POST", `/messages/${id}/stop`, { conversationId: id }), p(id)),
      files.GET(req("GET", `/files?conversationId=${id}`)),
      files.POST(upload("a.txt", Buffer.from("hello"), { conversationId: id })),
      file.GET(req("GET", `/files/${id}`), p(id)),
      file.DELETE(req("DELETE", `/files/${id}`), p(id)),
      disclosure.POST(req("POST", "/disclosure", { version: UPLOAD_DISCLOSURE_VERSION })),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    }
    expect(requests).toHaveLength(0);
    expect((await sql(`select count(*)::int n from ai_conversations`))[0].n).toBe(0);
  });

  it("keeps one admin out of another admin's workspace", async () => {
    const { admin: owner, conversationId } = await setUp();
    const { project: theirs } = await body(await projects.POST(req("POST", "/projects", { name: "Private" })));
    const done = await lines(await messages.POST(req("POST", `/conversations/${conversationId}/messages`,
      { clientId: randomUUID(), content: "Owner's words" }), p(conversationId)));
    const replyId = done[0].assistantMessage.id;
    const { file: stored } = await body(await files.POST(upload("mine.txt", Buffer.from("owner file"), { conversationId })));

    as(await newAdmin());
    const refused = await Promise.all([
      project.GET(req("GET", `/projects/${theirs.id}`), p(theirs.id)),
      project.PATCH(req("PATCH", `/projects/${theirs.id}`, { archived: true }), p(theirs.id)),
      project.DELETE(req("DELETE", `/projects/${theirs.id}`, { confirmName: "Private" }), p(theirs.id)),
      conversation.GET(req("GET", `/conversations/${conversationId}`), p(conversationId)),
      conversation.PATCH(req("PATCH", `/conversations/${conversationId}`, { title: "x" }), p(conversationId)),
      conversation.DELETE(req("DELETE", `/conversations/${conversationId}`), p(conversationId)),
      stop.POST(req("POST", `/messages/${replyId}/stop`, { conversationId }), p(replyId)),
      file.GET(req("GET", `/files/${stored.id}`), p(stored.id)),
      file.DELETE(req("DELETE", `/files/${stored.id}`), p(stored.id)),
    ]);
    // One at a time: these claim the caller's own single reply slot first.
    refused.push(await messages.POST(req("POST", `/conversations/${conversationId}/messages`,
      { clientId: randomUUID(), content: "x" }), p(conversationId)));
    refused.push(await retry.POST(req("POST", `/messages/${replyId}/retry`, {}), p(replyId)));
    for (const res of refused) expect(res.status).toBe(404);
    const [{ n }] = await sql(`select count(*)::int n from ai_messages where user_id = $1`, [owner]);
    expect(n).toBe(2);
  });
});

describe("conversations and replies", () => {
  it("opens with the notice state, lists and limits", async () => {
    as(await newAdmin());
    const boot = await body(await root.GET());
    expect(boot).toMatchObject({
      available: true, projects: [], conversations: [],
      settings: { hasAcceptedCurrentDisclosure: false, currentDisclosureVersion: UPLOAD_DISCLOSURE_VERSION },
      models: [{ id: "claude", label: "Claude Sonnet 5" }], defaultModelId: "claude", imageGeneration: false,
      limits: { maxAttachments: 20, maxPdfBytes: 10 * 1048576, maxImageBytes: 5 * 1048576, maxTextBytes: 2 * 1048576 },
    });
    setWorkspaceProviderForTests(null);
    expect((await body(await root.GET())).available).toBe(false);
  });

  it("streams a reply, and a repeated send writes nothing and does not ask the model again", async () => {
    const { conversationId } = await setUp();
    const clientId = randomUUID();
    const res = await messages.POST(req("POST", `/conversations/${conversationId}/messages`,
      { clientId, content: "Plan my launch" }), p(conversationId));
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const stream = await lines(res);
    expect(stream.map((e) => e.type)).toEqual(["start", "delta", "delta", "done"]);
    expect(stream[0].conversation.title).toBe("Plan my launch");
    expect(stream[3].message).toMatchObject({ status: "complete", content: "Hello there" });

    const repeat = await messages.POST(req("POST", `/conversations/${conversationId}/messages`,
      { clientId, content: "Plan my launch" }), p(conversationId));
    expect(repeat.headers.get("content-type")).toContain("application/json");
    expect(await body(repeat)).toMatchObject({ existing: true, assistantMessage: { status: "complete" } });
    expect(requests).toHaveLength(1);

    const view = await body(await conversation.GET(req("GET", `/conversations/${conversationId}`), p(conversationId)));
    expect(view.messages).toHaveLength(2);
    expect(view.exchanges).toEqual([{
      userMessageId: stream[0].userMessage.id, chain: [stream[0].assistantMessage.id],
      retryTargetId: stream[0].assistantMessage.id, continueTargetId: null,
    }]);
  });

  it("refuses a second reply while one is being written, then enforces the hourly limit", async () => {
    const { conversationId } = await setUp();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    script = async (_r, onText) => { onText("Working"); await gate; return finished; };
    const first = await messages.POST(req("POST", `/conversations/${conversationId}/messages`,
      { clientId: randomUUID(), content: "One" }), p(conversationId));

    const second = await messages.POST(req("POST", `/conversations/${conversationId}/messages`,
      { clientId: randomUUID(), content: "Two" }), p(conversationId));
    expect(second.status).toBe(409);
    expect((await body(second)).error).toMatch(/still being written/);

    release();
    await lines(first);
    process.env.AI_WORKSPACE_HOURLY_LIMIT = "1";
    script = async (_r, onText) => { onText("ok"); return finished; };
    const limited = await messages.POST(req("POST", `/conversations/${conversationId}/messages`,
      { clientId: randomUUID(), content: "Three" }), p(conversationId));
    expect(limited.status).toBe(429);
    expect((await body(limited)).error).toMatch(/this hour's limit/);
    expect(requests).toHaveLength(1);
  });

  it("stops a reply and saves what it had, then continues and retries it", async () => {
    const { conversationId } = await setUp();
    script = async (request, onText) => {
      onText("Partial text");
      return new Promise<ChatResult>((_, reject) => {
        request.signal.addEventListener("abort", () => reject(new ProviderAborted()), { once: true });
      });
    };
    const res = await messages.POST(req("POST", `/conversations/${conversationId}/messages`,
      { clientId: randomUUID(), content: "Write a lot" }), p(conversationId));
    const seen: any[] = [];
    for await (const event of events(res)) {
      seen.push(event);
      if (event.type === "delta") {
        const stopped = await stop.POST(req("POST", `/messages/${event.messageId}/stop`, { conversationId }), p(event.messageId));
        expect(await body(stopped)).toEqual({ stopping: true });
      }
    }
    const last = seen[seen.length - 1];
    expect(last).toMatchObject({ type: "done", message: { status: "stopped", content: "Partial text" } });

    script = async (_r, onText) => { onText(" and the rest."); return finished; };
    const continued = await lines(await cont.POST(req("POST", `/messages/${last.message.id}/continue`, {}), p(last.message.id)));
    expect(continued[continued.length - 1].message).toMatchObject({
      status: "complete", replyKind: "continuation", continuationOfMessageId: last.message.id,
    });

    const retried = await lines(await retry.POST(req("POST", `/messages/${last.message.id}/retry`, {}), p(last.message.id)));
    expect(retried[retried.length - 1].message).toMatchObject({ status: "complete", replyKind: "retry", retryOfMessageId: last.message.id });

    const again = await cont.POST(req("POST", `/messages/${last.message.id}/continue`, {}), p(last.message.id));
    expect(again.status).toBe(409);
  });

  it("renames, archives, restores and deletes a conversation", async () => {
    const { conversationId } = await setUp();
    const renamed = await body(await conversation.PATCH(req("PATCH", `/conversations/${conversationId}`, { title: "季度计划" }), p(conversationId)));
    expect(renamed.conversation).toMatchObject({ title: "季度计划", titleEdited: true });
    const archived = await body(await conversation.PATCH(req("PATCH", `/conversations/${conversationId}`, { archived: true }), p(conversationId)));
    expect(archived.conversation.archivedAt).not.toBeNull();
    const refused = await messages.POST(req("POST", `/conversations/${conversationId}/messages`,
      { clientId: randomUUID(), content: "hi" }), p(conversationId));
    expect(refused.status).toBe(409);
    await conversation.PATCH(req("PATCH", `/conversations/${conversationId}`, { archived: false }), p(conversationId));
    expect((await conversation.DELETE(req("DELETE", `/conversations/${conversationId}`), p(conversationId))).status).toBe(200);
    expect((await conversation.GET(req("GET", `/conversations/${conversationId}`), p(conversationId))).status).toBe(404);
  });

  it("logs nothing anyone wrote when a reply fails unexpectedly", async () => {
    const { conversationId } = await setUp();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    script = async () => { throw new Error("SECRET-DETAIL"); };
    const stream = await lines(await messages.POST(req("POST", `/conversations/${conversationId}/messages`,
      { clientId: randomUUID(), content: "SECRET-PROMPT" }), p(conversationId)));
    expect(stream[stream.length - 1].message).toMatchObject({ status: "failed", errorCode: "provider_error" });
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(/SECRET/);
    expect(logged).toHaveBeenCalledWith("[ai-workspace] reply failed (Error)");
  });
});

describe("projects", () => {
  it("creates, renames, sets instructions, archives, restores and deletes a project with what is in it", async () => {
    as(await newAdmin());
    await disclosure.POST(req("POST", "/disclosure", { version: UPLOAD_DISCLOSURE_VERSION }));
    const { project: created } = await body(await projects.POST(req("POST", "/projects", { name: "Launch", instructions: "" })));
    const updated = await body(await project.PATCH(req("PATCH", `/projects/${created.id}`,
      { name: "Launch plan", instructions: "Answer as a CFO." }), p(created.id)));
    expect(updated.project).toMatchObject({ name: "Launch plan", instructions: "Answer as a CFO." });

    await project.PATCH(req("PATCH", `/projects/${created.id}`, { archived: true }), p(created.id));
    expect((await conversations.POST(req("POST", "/conversations", { projectId: created.id }))).status).toBe(404);
    expect((await files.POST(upload("a.pdf", PDF, { projectId: created.id }))).status).toBe(409);
    await project.PATCH(req("PATCH", `/projects/${created.id}`, { archived: false }), p(created.id));

    const { conversation: inProject } = await body(await conversations.POST(req("POST", "/conversations", { projectId: created.id })));
    expect(inProject.projectId).toBe(created.id);
    await files.POST(upload("brief.pdf", PDF, { projectId: created.id }));
    await lines(await messages.POST(req("POST", `/conversations/${inProject.id}/messages`,
      { clientId: randomUUID(), content: "Go" }), p(inProject.id)));
    expect(requests[0].system).toContain("Answer as a CFO.");

    const view = await body(await project.GET(req("GET", `/projects/${created.id}`), p(created.id)));
    expect(view.summary).toEqual({ name: "Launch plan", conversations: 1, files: 1 });
    expect(view.files.map((f: any) => f.originalFilename)).toEqual(["brief.pdf"]);

    const wrong = await project.DELETE(req("DELETE", `/projects/${created.id}`, { confirmName: "launch plan" }), p(created.id));
    expect(wrong.status).toBe(400);
    expect((await body(wrong)).error).toBe("Type the project's name exactly to delete it.");
    const deleted = await project.DELETE(req("DELETE", `/projects/${created.id}`, { confirmName: "Launch plan" }), p(created.id));
    expect(await body(deleted)).toMatchObject({ deleted: true, conversations: 1, files: 1 });
    expect((await conversation.GET(req("GET", `/conversations/${inProject.id}`), p(inProject.id))).status).toBe(404);
    expect((await sql(`select count(*)::int n from ai_files where project_id = $1`, [created.id]))[0].n).toBe(0);
  });
});

describe("files", () => {
  it("require the current upload notice first", async () => {
    as(await newAdmin());
    const { conversation: c } = await body(await conversations.POST(req("POST", "/conversations", {})));
    const refused = await files.POST(upload("a.txt", Buffer.from("hello"), { conversationId: c.id }));
    expect(refused.status).toBe(409);
    expect((await body(refused)).error).toBe("Review the upload notice before uploading files.");
    expect((await disclosure.POST(req("POST", "/disclosure", { version: 0 }))).status).toBe(409);
    expect((await body(await disclosure.POST(req("POST", "/disclosure", { version: UPLOAD_DISCLOSURE_VERSION })))).settings.hasAcceptedCurrentDisclosure).toBe(true);
    expect((await files.POST(upload("a.txt", Buffer.from("hello"), { conversationId: c.id }))).status).toBe(200);
  });

  it("are typed from their bytes, limited by type and quota, and de-duplicated", async () => {
    const { conversationId } = await setUp();
    const renamed = await body(await files.POST(upload("looks-like.png", Buffer.from("plain words"), { conversationId })));
    expect(renamed.file).toMatchObject({ kind: "text", mimeType: "text/plain", originalFilename: "looks-like.png" });

    const zip = await files.POST(upload("archive.pdf", ZIP, { conversationId }));
    expect(zip.status).toBe(415);
    expect((await body(zip)).error).toMatch(/Only PDF, PNG, JPEG, GIF, WebP and plain text/);

    const image = await body(await files.POST(upload("photo.png", PNG, { conversationId })));
    expect(image.file).toMatchObject({ kind: "image", mimeType: "image/png" });
    const again = await body(await files.POST(upload("photo-copy.png", PNG, { conversationId })));
    expect(again).toMatchObject({ reused: true, file: { id: image.file.id } });

    process.env.AI_WORKSPACE_MAX_TEXT_MB = "0.00001";
    const big = await files.POST(upload("big.txt", Buffer.from("more than ten bytes of text"), { conversationId }));
    expect(big.status).toBe(413);
    expect((await body(big)).error).toMatch(/^That file is larger than the .* limit\.$/);
    delete process.env.AI_WORKSPACE_MAX_TEXT_MB;

    // 41 bytes: the 27 already stored plus a 34-byte PDF do not fit.
    process.env.AI_WORKSPACE_STORAGE_QUOTA_MB = "0.00004";
    const full = await files.POST(upload("pdf.pdf", PDF, { conversationId }));
    expect(full.status).toBe(413);
    expect((await body(full)).error).toMatch(/^Not enough storage: .* left of .*\.$/);
  });

  it("are served safely, attached in order, shown as removed once deleted, and discarded when never sent", async () => {
    const { conversationId } = await setUp();
    const text = (await body(await files.POST(upload("notes.txt", Buffer.from("会议纪要"), { conversationId })))).file;
    const image = (await body(await files.POST(upload("photo.png", PNG, { conversationId })))).file;

    const served = await file.GET(req("GET", `/files/${text.id}`), p(text.id));
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("content-security-policy")).toContain("sandbox");
    expect(served.headers.get("content-disposition")).toMatch(/^attachment; filename\*=UTF-8''notes\.txt$/);
    expect(Buffer.from(await served.arrayBuffer()).toString("utf8")).toBe("会议纪要");
    expect((await file.GET(req("GET", `/files/${image.id}`), p(image.id))).headers.get("content-disposition")).toMatch(/^inline/);

    await lines(await messages.POST(req("POST", `/conversations/${conversationId}/messages`,
      { clientId: randomUUID(), content: "", fileIds: [image.id, text.id] }), p(conversationId)));
    const deleted = await body(await file.DELETE(req("DELETE", `/files/${text.id}`), p(text.id)));
    expect(deleted.deleted).toBe(true);
    const view = await body(await conversation.GET(req("GET", `/conversations/${conversationId}`), p(conversationId)));
    expect(view.messages[0].attachments.map((a: any) => [a.originalFilename, a.position, a.removed]))
      .toEqual([["photo.png", 0, false], ["notes.txt", 1, true]]);
    expect(view.messages[0].conversationId).toBe(conversationId);

    const unsent = (await body(await files.POST(upload("draft.txt", Buffer.from("never sent"), { conversationId })))).file;
    expect(await body(await file.DELETE(req("DELETE", `/files/${unsent.id}?discard=1`), p(unsent.id)))).toEqual({ discarded: true });
    expect(await body(await file.DELETE(req("DELETE", `/files/${image.id}?discard=1`), p(image.id)))).toEqual({ discarded: false });
  });
});
