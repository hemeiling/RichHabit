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
