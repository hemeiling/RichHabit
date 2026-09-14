import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The general-purpose, multi-model workspace end to end through its API routes,
 * against a real Postgres (PGlite) with recording providers: model selection,
 * capability routing, and image generation that produces an actual picture —
 * the behaviour the "hippopotamus" screenshot showed was missing.
 */

vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__aiModelsDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__aiModelsDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined }),
  headers: () => new Map(),
}));
let caller: { id: string; email: string } | null = null;
vi.mock("@/lib/admin", () => ({ currentAdmin: async () => caller }));

import * as root from "../src/app/api/admin/ai/workspace/route";
import * as conversations from "../src/app/api/admin/ai/workspace/conversations/route";
import * as conversation from "../src/app/api/admin/ai/workspace/conversations/[id]/route";
import * as messages from "../src/app/api/admin/ai/workspace/conversations/[id]/messages/route";
import * as cont from "../src/app/api/admin/ai/workspace/messages/[id]/continue/route";
import * as retry from "../src/app/api/admin/ai/workspace/messages/[id]/retry/route";
import * as stop from "../src/app/api/admin/ai/workspace/messages/[id]/stop/route";
import * as file from "../src/app/api/admin/ai/workspace/files/[id]/route";
import * as projects from "../src/app/api/admin/ai/workspace/projects/route";
import * as project from "../src/app/api/admin/ai/workspace/projects/[id]/route";
import * as ai from "../src/lib/aiWorkspace/queries";
import { UPLOAD_DISCLOSURE_VERSION } from "../src/lib/aiWorkspace/disclosure";
import { providerFailure, type ProviderErrorInput } from "../src/lib/aiWorkspaceRuntime/providerErrors";
import { IMAGE_GENERATION_AVAILABLE, IMAGE_GENERATION_UNAVAILABLE } from "../src/lib/aiWorkspaceRuntime/context";
import { resetReplySlots } from "../src/lib/aiWorkspaceRuntime/limits";
import {
  ProviderAborted, chatOption, imageOption, setWorkspaceProvidersForTests,
  type ChatRequest, type ImageRequest, type ImageResult, type WorkspaceProvider,
} from "../src/lib/aiWorkspaceRuntime/provider";
import { scriptedPng } from "../src/lib/aiWorkspaceRuntime/scriptedProvider";

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const HIPPO_EN = "Can you generate a cartoon image of a hippopotamus?";
const HIPPO_ZH = "帮我生成一张可爱的河马卡通图片";
const CANNOT = /cannot|can't|unable|not able|无法|不能/i;

let db: PGlite;
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;

const CLAUDE = chatOption("claude", "anthropic", "claude-sonnet-5");
const GEMINI = chatOption("gemini", "google", "gemini-3.8-flash");
const IMAGE = imageOption("image", "google", "gemini-3.1-flash-image");

const chatCalls: { provider: string; request: ChatRequest }[] = [];
const imageCalls: ImageRequest[] = [];
const recorder = (id: string): WorkspaceProvider => ({
  id,
  async streamChat(request, onText) {
    chatCalls.push({ provider: id, request });
    onText(`Answer from ${request.model}`);
    return { stopReason: "end_turn", inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 };
  },
});
let imageScript: (request: ImageRequest) => Promise<ImageResult>;
const picture = (request: ImageRequest): ImageResult =>
  ({ images: [{ mimeType: "image/png", bytes: scriptedPng(request.prompt) }], text: "", stopReason: "end_turn", inputTokens: 10, outputTokens: 1290 });

function configure(catalogue = [CLAUDE, GEMINI, IMAGE]) {
  setWorkspaceProvidersForTests({
    catalogue,
    chat: { anthropic: recorder("anthropic"), google: recorder("google") },
    image: catalogue.includes(IMAGE) ? { google: { id: "google", generateImage: (r) => { imageCalls.push(r); return imageScript(r); } } } : {},
  });
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SCHEMA);
  (globalThis as any).__aiModelsDb = db;
});
afterAll(async () => { await db.close(); });
beforeEach(() => {
  chatCalls.length = 0;
  imageCalls.length = 0;
  imageScript = async (r) => picture(r);
  configure();
});
afterEach(() => {
  caller = null;
  resetReplySlots();
  setWorkspaceProvidersForTests(undefined);
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) if (key.startsWith("AI_WORKSPACE_")) delete process.env[key];
});

const URL_BASE = "http://localhost/api/admin/ai/workspace";
const req = (method: string, p: string, body?: unknown) => new Request(`${URL_BASE}${p}`, {
  method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});
const p = (id: string) => ({ params: { id } });
const body = async (res: Response) => res.json();

async function newAdmin(): Promise<string> {
  const [row] = await sql(`insert into users (email, password_hash, role) values ($1, 'x', 'admin') returning id`,
    [`${randomUUID()}@example.com`]);
  return row.id;
}
async function setUp() {
  const admin = await newAdmin();
  caller = { id: admin, email: "admin@example.com" };
  const { conversation: c } = await body(await conversations.POST(req("POST", "/conversations", {})));
  return { admin, conversationId: c.id as string };
}
/** Sends a message and reads the whole stream. */
async function send(conversationId: string, content: string, modelId?: string) {
  const res = await messages.POST(req("POST", `/conversations/${conversationId}/messages`, { clientId: randomUUID(), content, modelId }), p(conversationId));
  const text = await res.text();
  const events = res.ok ? text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { res, text, events, done: events.find((e) => e.type === "done")?.message };
}
const view = async (conversationId: string) => body(await conversation.GET(req("GET", `/conversations/${conversationId}`), p(conversationId)));

describe("the workspace's models", () => {
  it("offers only configured conversational models, by name, with no provider detail", async () => {
    caller = { id: await newAdmin(), email: "admin@example.com" };
    const boot = await body(await root.GET());
    expect(boot.models).toEqual([{ id: "claude", label: "Claude Sonnet 5" }, { id: "gemini", label: "Gemini 3.8 Flash" }]);
    expect(boot).toMatchObject({ available: true, defaultModelId: "claude", imageGeneration: true });
    expect(JSON.stringify(boot.models)).not.toMatch(/anthropic|google|claude-sonnet-5|gemini-3/);

    configure([CLAUDE]);
    expect(await body(await root.GET())).toMatchObject({ models: [{ id: "claude" }], imageGeneration: false });
    configure([IMAGE]);
    expect(await body(await root.GET())).toMatchObject({ available: false, models: [], defaultModelId: null });
  });

  it("answers with the selected model, remembers it for the conversation, and labels each reply", async () => {
    const { conversationId } = await setUp();
    const first = await send(conversationId, "Explain CAP theorem briefly", "gemini");
    expect(first.done).toMatchObject({ status: "complete", provider: "google", model: "gemini-3.8-flash" });
    expect(chatCalls.map((c) => c.provider)).toEqual(["google"]);
    expect(chatCalls[0].request.system).toMatch(/^You are a general-purpose AI assistant/);
    expect(chatCalls[0].request.system).toContain(IMAGE_GENERATION_AVAILABLE);
    expect((await view(conversationId)).modelId).toBe("gemini");

    const second = await send(conversationId, "Now in one sentence", "claude");
    expect(second.done).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5" });
    expect(chatCalls[1].provider).toBe("anthropic");
    // The second model sees the first model's answer as history.
    expect(JSON.stringify(chatCalls[1].request.turns)).toContain("Answer from gemini-3.8-flash");
    const v = await view(conversationId);
    expect(v.modelId).toBe("claude");
    expect(v.replyModels[first.done.id]).toEqual({ label: "Gemini 3.8 Flash", image: false });
    expect(v.replyModels[second.done.id]).toEqual({ label: "Claude Sonnet 5", image: false });

    const unknown = await send(conversationId, "Hello", "not-a-model");
    expect(unknown.done).toMatchObject({ provider: "anthropic" });
  });
});

describe("image generation, as the screenshot asked for it", () => {
  for (const prompt of [HIPPO_EN, HIPPO_ZH]) {
    it(`answers ${JSON.stringify(prompt)} with an actual picture that survives a reload`, async () => {
      const { admin, conversationId } = await setUp();
      const sent = await send(conversationId, prompt, "claude");
      expect(sent.res.status).toBe(200);

      // Routed to the image model, not to a conversational model that would say it can't.
      expect(chatCalls).toHaveLength(0);
      expect(imageCalls).toHaveLength(1);
      expect(imageCalls[0]).toMatchObject({ model: "gemini-3.1-flash-image", prompt, references: [], imageSize: "1K" });

      const reply = sent.done;
      expect(reply).toMatchObject({ status: "complete", provider: "google", model: "gemini-3.1-flash-image", errorCode: null });
      expect(reply.content).not.toMatch(CANNOT);
      expect(reply.attachments).toHaveLength(1);
      expect(reply.attachments[0]).toMatchObject({ kind: "image", mimeType: "image/png", removed: false });
      expect(reply.attachments[0].originalFilename).toMatch(/^generated-image-\d{8}-\d{6}\.png$/);

      // The stream carries references, never the picture's bytes.
      const bytes = scriptedPng(prompt);
      expect(sent.text).not.toContain(Buffer.from(bytes).toString("base64").slice(0, 60));

      // A reload shows the same picture, from the database.
      const v = await view(conversationId);
      const saved = v.messages.find((m: any) => m.id === reply.id);
      expect(saved.attachments).toEqual(reply.attachments);
      expect(v.replyModels[reply.id]).toEqual({ label: "Nano Banana 2", image: true });
      expect(v.exchanges[0]).toMatchObject({ chain: [reply.id], retryTargetId: reply.id, continueTargetId: null });

      // It is a real image file, served to its owner only.
      const own = await file.GET(req("GET", `/files/${reply.attachments[0].fileId}`), p(reply.attachments[0].fileId));
      expect(own.status).toBe(200);
      expect(own.headers.get("content-type")).toBe("image/png");
      expect(own.headers.get("content-disposition")).toMatch(/^inline/);
      expect(Buffer.from(await own.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
      caller = { id: await newAdmin(), email: "other@example.com" };
      expect((await file.GET(req("GET", `/files/${reply.attachments[0].fileId}`), p(reply.attachments[0].fileId))).status).toBe(404);

      const [row] = await sql(`select user_id, conversation_id, kind, byte_size, sha256 from ai_files where id = $1`, [reply.attachments[0].fileId]);
      expect(row).toMatchObject({ user_id: admin, conversation_id: conversationId, kind: "image", byte_size: bytes.byteLength });
    });
  }

  it("keeps ordinary questions about pictures with the conversational model", async () => {
    const { conversationId } = await setUp();
    await send(conversationId, "How do image generation models work?", "gemini");
    await send(conversationId, "Write a prompt for an image of a hippo", "gemini");
    expect(imageCalls).toHaveLength(0);
    expect(chatCalls.map((c) => c.provider)).toEqual(["google", "google"]);
  });

  it("without an image model, asks the selected model and tells it honestly that pictures are off", async () => {
    configure([CLAUDE]);
    const { conversationId } = await setUp();
    const sent = await send(conversationId, HIPPO_EN);
    expect(sent.done).toMatchObject({ provider: "anthropic" });
    expect(imageCalls).toHaveLength(0);
    expect(chatCalls[0].request.system).toContain(IMAGE_GENERATION_UNAVAILABLE);
  });

  it("makes a picture again on Retry, never continues one, and names it in later history", async () => {
    const { conversationId } = await setUp();
    const first = (await send(conversationId, HIPPO_EN)).done;

    const continued = await cont.POST(req("POST", `/messages/${first.id}/continue`, {}), p(first.id));
    expect(continued.status).toBe(409);

    const retried = await retry.POST(req("POST", `/messages/${first.id}/retry`, { modelId: "gemini" }), p(first.id));
    const retriedDone = (await retried.text()).trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "done").message;
    expect(imageCalls).toHaveLength(2);
    expect(retriedDone).toMatchObject({ status: "complete", model: "gemini-3.1-flash-image", retryOfMessageId: first.id });
    expect(retriedDone.attachments).toHaveLength(1);

    await send(conversationId, "Describe what you just made", "gemini");
    expect(JSON.stringify(chatCalls[0].request.turns)).toMatch(/\[Generated image: generated-image-[\d-]+\.png\]/);

    // Deleting the picture leaves "removed" in history, like any file.
    await file.DELETE(req("DELETE", `/files/${retriedDone.attachments[0].fileId}`), p(retriedDone.attachments[0].fileId));
    const v = await view(conversationId);
    expect(v.messages.find((m: any) => m.id === retriedDone.id).attachments[0].removed).toBe(true);
  });

  it("stops a picture being made, and saves the reply as stopped with nothing attached", async () => {
    imageScript = (r) => new Promise((_, reject) =>
      r.signal.addEventListener("abort", () => reject(new ProviderAborted()), { once: true }));
    const { conversationId } = await setUp();
    const res = await messages.POST(req("POST", `/conversations/${conversationId}/messages`, { clientId: randomUUID(), content: HIPPO_EN }), p(conversationId));
    const reader = res.body!.getReader();
    const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).split("\n")[0]);
    expect(first.type).toBe("start");
    await vi.waitFor(() => expect(imageCalls).toHaveLength(1));
    const stopped = await body(await stop.POST(req("POST", `/messages/${first.assistantMessage.id}/stop`, { conversationId }), p(first.assistantMessage.id)));
    expect(stopped.stopping).toBe(true);
    while (!(await reader.read()).done) { /* drain */ }
    const saved = (await view(conversationId)).messages.find((m: any) => m.id === first.assistantMessage.id);
    expect(saved).toMatchObject({ status: "stopped", attachments: [] });
  });

  it("refuses a picture before writing anything when storage is nearly full", async () => {
    process.env.AI_WORKSPACE_STORAGE_QUOTA_MB = "1";
    const { admin, conversationId } = await setUp();
    const sent = await send(conversationId, HIPPO_EN);
    expect(sent.res.status).toBe(413);
    expect((await body(new Response(sent.text))).error).toMatch(/^Not enough storage/);
    expect(imageCalls).toHaveLength(0);
    expect(await sql(`select 1 from ai_messages where user_id = $1`, [admin])).toHaveLength(0);
  });

  it("keeps a refusal's words when the image model declines", async () => {
    imageScript = async () => ({ images: [], text: "I can't make that picture.", stopReason: "refusal", inputTokens: 1, outputTokens: 1 });
    const { conversationId } = await setUp();
    const sent = await send(conversationId, HIPPO_EN);
    expect(sent.done).toMatchObject({ status: "complete", stopReason: "refusal", content: "I can't make that picture.", attachments: [] });
  });

  it("never records workspace analytics for a picture", async () => {
    const before = await sql(`select count(*)::int as n from analytics_events`);
    const { conversationId } = await setUp();
    await send(conversationId, HIPPO_EN);
    expect(await sql(`select count(*)::int as n from analytics_events`)).toEqual(before);
  });
});

describe("image provider errors, as the admin reads them", () => {
  it.each<[string, ProviderErrorInput, string, string | null, string]>([
    ["quota or billing", { status: 429, type: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, project 987654 SENTINEL-Q" }, "provider_error", "quota_unavailable", "4xx"],
    ["temporary rate limit", { status: 429, type: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted SENTINEL-R" }, "rate_limited", null, "4xx"],
    ["outage", { status: 503, type: "UNAVAILABLE", message: "SENTINEL-O" }, "overloaded", null, "5xx"],
    ["configuration", { status: 400, type: "INVALID_ARGUMENT", message: "API key not valid SENTINEL-C" }, "provider_error", "provider_config", "4xx"],
    ["generic failure", { status: 400, type: "INVALID_ARGUMENT", message: "SENTINEL-G" }, "provider_error", null, "4xx"],
  ])("saves a %s failure with its normalized code, and logs only safe metadata", async (_label, error, code, detail, status) => {
    imageScript = async () => { throw providerFailure(error); };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { conversationId } = await setUp();
    const sent = await send(conversationId, HIPPO_EN);

    expect(sent.done).toMatchObject({ status: "failed", errorCode: code, stopReason: detail, attachments: [] });
    const saved = (await view(conversationId)).messages.find((m: any) => m.id === sent.done.id);
    expect(saved).toMatchObject({ status: "failed", errorCode: code, stopReason: detail });
    expect(logged.mock.calls.map((c) => c[0])).toContain(
      `[ai-workspace] reply failed provider=google capability=image_generation status=${status} code=${detail ?? code}`);
    const PROVIDER_WORDS = /SENTINEL|limit: 0|free_tier|987654|API key not valid|Resource has been exhausted/;
    // Logs carry neither the provider's words nor the admin's prompt.
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(PROVIDER_WORDS);
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(/hippopotamus/);
    // The admin's own browser gets their message back, but never the provider's words.
    expect(`${sent.text} ${JSON.stringify(saved)}`).not.toMatch(PROVIDER_WORDS);
  });
});

describe("pictures from natural requests, whichever conversational model is selected", () => {
  for (const selected of ["gemini", "claude"] as const) {
    it(`with ${selected} selected, a question goes to ${selected} and a picture request to the image model`, async () => {
      const { conversationId } = await setUp();
      const question = (await send(conversationId, "Explain Kubernetes.", selected)).done;
      expect(question).toMatchObject(selected === "gemini"
        ? { provider: "google", model: "gemini-3.8-flash" }
        : { provider: "anthropic", model: "claude-sonnet-5" });
      const picture = (await send(conversationId, "Create a cartoon hippopotamus.", selected)).done;
      expect(picture).toMatchObject({ status: "complete", model: "gemini-3.1-flash-image" });
      expect(picture.attachments).toHaveLength(1);
      // The picture does not change the conversation's model.
      expect((await view(conversationId)).modelId).toBe(selected);
    });
  }

  it("understands natural phrasing in English and Chinese, and leaves look-alikes with conversation", async () => {
    const { conversationId } = await setUp();
    const pictures = ["hippo picture please", "draw me a hippo", "河马图片", "来一张可爱的河马卡通图", "帮我做一张海报"];
    const conversationOnly = ["describe this image", "what would a cartoon hippo look like?", "create a Mermaid diagram", "给我写一个图片生成提示词", "帮我设计图片的文案"];
    for (const text of pictures) await send(conversationId, text, "claude");
    for (const text of conversationOnly) await send(conversationId, text, "claude");
    expect(imageCalls.map((r) => r.prompt)).toEqual(pictures);
    expect(chatCalls).toHaveLength(conversationOnly.length);
  });

  it("does not read a bare caption with an attached file as a picture request", async () => {
    const { admin, conversationId } = await setUp();
    await ai.acceptUploadDisclosure(admin, UPLOAD_DISCLOSURE_VERSION);
    const { file: note } = await ai.recordUpload(admin, {
      conversationId, originalFilename: "notes.txt", kind: "text", mimeType: "text/plain", bytes: new Uint8Array(Buffer.from("hello")),
    });
    const res = await messages.POST(req("POST", `/conversations/${conversationId}/messages`,
      { clientId: randomUUID(), content: "hippo picture", fileIds: [note.id], modelId: "claude" }), p(conversationId));
    await res.text();
    expect(imageCalls).toHaveLength(0);
    expect(chatCalls).toHaveLength(1);
  });
});

describe("generated pictures in storage", () => {
  it("counts identical pictures once, makes no provider file copies, and exposes no provider reference", async () => {
    imageScript = async () => ({ images: [{ mimeType: "image/png", bytes: scriptedPng("the same picture") }], text: "", stopReason: "end_turn", inputTokens: 1, outputTokens: 1 });
    const { admin, conversationId } = await setUp();
    const first = (await send(conversationId, "Create an image of a hippo")).done;
    const second = (await send(conversationId, "Create an image of a hippo again")).done;
    expect(second.attachments[0].fileId).toBe(first.attachments[0].fileId);

    const rows = await sql(`select id, byte_size from ai_files where user_id = $1`, [admin]);
    expect(rows).toHaveLength(1);
    expect((await ai.storageUsage(admin)).usedBytes).toBe(Number(rows[0].byte_size));
    expect(await sql(`select message_id from ai_message_files where file_id = $1`, [rows[0].id])).toHaveLength(2);

    await send(conversationId, "Describe what you made", "claude");
    expect(await sql(`select 1 from ai_file_provider_copies c join ai_files f on f.id = c.file_id where f.user_id = $1`, [admin])).toHaveLength(0);
    expect(JSON.stringify(await view(conversationId))).not.toMatch(/googleapis|providerFileId|file_id|base64/);
  });

  it("keeps the reply but not the picture when it no longer fits the storage quota", async () => {
    process.env.AI_WORKSPACE_STORAGE_QUOTA_MB = "3";
    const big = new Uint8Array(2_300_000);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    imageScript = async () => ({ images: [{ mimeType: "image/png", bytes: big }], text: "", stopReason: "end_turn", inputTokens: 1, outputTokens: 1 });
    const { admin, conversationId } = await setUp();
    await ai.acceptUploadDisclosure(admin, UPLOAD_DISCLOSURE_VERSION);
    await ai.recordUpload(admin, {
      conversationId, originalFilename: "notes.txt", kind: "text", mimeType: "text/plain", bytes: new Uint8Array(1_000_000).fill(97),
    });
    // 2.05 MB left passes the up-front check; the 2.2 MB picture does not fit.
    const sent = (await send(conversationId, HIPPO_EN)).done;
    expect(sent).toMatchObject({ status: "complete", stopReason: "storage_full", attachments: [] });
    expect((await ai.storageUsage(admin)).usedBytes).toBe(1_000_000);
    expect(await sql(`select 1 from ai_files where user_id = $1 and kind = 'image'`, [admin])).toHaveLength(0);
  });

  it("removes pictures with their conversation, and with a permanently deleted project", async () => {
    const { admin, conversationId } = await setUp();
    const made = (await send(conversationId, HIPPO_EN)).done;
    const fileId = made.attachments[0].fileId;
    expect((await conversation.DELETE(req("DELETE", `/conversations/${conversationId}`), p(conversationId))).status).toBe(200);
    expect(await sql(`select 1 from ai_files where id = $1`, [fileId])).toHaveLength(0);
    expect(await sql(`select 1 from ai_message_files where file_id = $1`, [fileId])).toHaveLength(0);

    const { project: zoo } = await body(await projects.POST(req("POST", "/projects", { name: "Zoo", instructions: "" })));
    const { conversation: inProject } = await body(await conversations.POST(req("POST", "/conversations", { projectId: zoo.id })));
    const inside = (await send(inProject.id, HIPPO_ZH)).done;
    expect(inside.attachments).toHaveLength(1);
    expect((await project.DELETE(req("DELETE", `/projects/${zoo.id}`, { confirmName: "Zoo" }), p(zoo.id))).status).toBe(200);
    expect(await sql(`select 1 from ai_files where id = $1`, [inside.attachments[0].fileId])).toHaveLength(0);
    expect(await sql(`select count(*)::int as n from ai_files where user_id = $1`, [admin])).toEqual([{ n: 0 }]);
  });
});
