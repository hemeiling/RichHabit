import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Priority details through the real routes against real Postgres (PGlite):
 * notes and links save one field at a time and only for their owner; the
 * links API stores nothing but http(s); attachments are sniffed from their
 * bytes, capped per file and per priority, and answer only to their owner —
 * anyone else's id simply does not exist, uploads, downloads and deletions
 * alike. Nothing here can mint a public URL: the download is a session-
 * checked API response with `nosniff`.
 */

let db: PGlite;
const open: PGlite[] = [];
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__pdDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__pdDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));
let signedIn: string | null = null;
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => (signedIn ? { id: signedIn, email: "x" } : null) }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }), headers: () => new Map() }));
vi.mock("@/lib/analytics/track", () => ({ trackEvent: async () => {} }));

const priorities = await import("../src/app/api/priorities/route");
const attachments = await import("../src/app/api/priorities/attachments/route");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;
const as = (id: string | null) => { signedIn = id; };
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) });
const req = (body?: unknown, method = "PATCH") =>
  new Request("http://x/api/priorities", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3, 4]);
const uploadReq = (priorityId: string, bytes: Uint8Array, name: string, type = "application/octet-stream") => {
  const form = new FormData();
  form.set("priorityId", priorityId);
  form.set("file", new File([bytes as BlobPart], name, { type }));
  return new Request("http://x/api/priorities/attachments", { method: "POST", body: form });
};
const get = (q: string) => new Request(`http://x/api/priorities/attachments?${q}`, { method: "GET" });
const del = (id: string) => new Request(`http://x/api/priorities/attachments?id=${id}`, { method: "DELETE" });

let ada = "", bea = "", mine = "", hers = "";
beforeEach(async () => {
  db = await PGlite.create();
  open.push(db);
  await db.exec(SCHEMA);
  (globalThis as any).__pdDb = db;
  await db.exec(`insert into users (email, username, password_hash) values ('a@x.com','ada','x'), ('b@x.com','bea','x');`);
  [ada, bea] = (await sql("select id from users order by email")).map((r) => r.id);
  for (const [user, body] of [[ada, "Mine"], [bea, "Hers"]] as const) {
    await sql(`insert into priorities (user_id, body, created_on, category)
      values ($1, $2, current_date, 'urgent_important')`, [user, body]);
  }
  mine = (await sql("select id from priorities where body = 'Mine'"))[0].id;
  hers = (await sql("select id from priorities where body = 'Hers'"))[0].id;
  signedIn = ada;
});
afterAll(async () => { for (const d of open) await d.close(); });

describe("notes and links", () => {
  it("saves notes for the owner and answers a stranger as not found", async () => {
    expect((await priorities.PATCH(req({ id: mine, description: "call before 9" }))).status).toBe(200);
    expect((await sql("select description from priorities where id = $1", [mine]))[0].description).toBe("call before 9");
    as(bea);
    expect((await priorities.PATCH(req({ id: mine, description: "graffiti" }))).status).toBe(404);
    expect((await sql("select description from priorities where id = $1", [mine]))[0].description).toBe("call before 9");
  });

  it("stores only http(s) links, at most ten, and the whole list at once", async () => {
    const links = [{ url: "https://example.com/doc", label: "The doc" }, { url: "http://example.org", label: "" }];
    expect((await priorities.PATCH(req({ id: mine, links }))).status).toBe(200);
    expect((await sql("select links from priorities where id = $1", [mine]))[0].links).toEqual(links);

    for (const bad of [
      [{ url: "javascript:alert(1)", label: "x" }],
      [{ url: "data:text/html;base64,xx", label: "x" }],
      [{ url: "not a url", label: "" }],
      Array.from({ length: 11 }, (_, i) => ({ url: `https://x/${i}`, label: "" })),
    ]) {
      expect((await priorities.PATCH(req({ id: mine, links: bad }))).status, JSON.stringify(bad[0])).toBe(400);
    }
    // The good list is still standing.
    expect((await sql("select links from priorities where id = $1", [mine]))[0].links).toEqual(links);
    // Clearing is an ordinary write of the empty list.
    expect((await priorities.PATCH(req({ id: mine, links: [] }))).status).toBe(200);
  });
});

describe("attachments", () => {
  it("accepts a file by its bytes, serves it to its owner only, and deletes it", async () => {
    const up = await json(await attachments.POST(uploadReq(mine, PNG, "renamed.txt", "text/plain")));
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    // The browser's claims did not count: the bytes say PNG.
    expect(up.body.attachment.mimeType).toBe("image/png");
    expect(up.body.attachment.byteSize).toBe(PNG.byteLength);
    const id = up.body.attachment.id;

    const down = await attachments.GET(get(`id=${id}`));
    expect(down.status).toBe(200);
    expect(down.headers.get("content-type")).toBe("image/png");
    expect(down.headers.get("x-content-type-options")).toBe("nosniff");
    expect(down.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await down.arrayBuffer())).toEqual(PNG);

    const list = await json(await attachments.GET(get(`priorityId=${mine}`)));
    expect(list.body.attachments.map((a: any) => a.id)).toEqual([id]);

    as(bea);
    expect((await attachments.GET(get(`id=${id}`))).status).toBe(404);
    expect((await attachments.DELETE(del(id))).status).toBe(404);
    expect((await json(await attachments.GET(get(`priorityId=${mine}`)))).body.attachments).toEqual([]);
    as(null);
    expect((await attachments.GET(get(`id=${id}`))).status).toBe(401);

    as(ada);
    expect((await attachments.DELETE(del(id))).status).toBe(200);
    expect((await attachments.GET(get(`id=${id}`))).status).toBe(404);
  });

  it("refuses what it cannot vouch for: unknown bytes, empty files, other people's priorities", async () => {
    expect((await attachments.POST(uploadReq(mine, EXE, "setup.png", "image/png"))).status).toBe(415);
    expect((await attachments.POST(uploadReq(mine, new Uint8Array(0), "empty.txt"))).status).toBe(400);
    expect((await attachments.POST(uploadReq(hers, PNG, "pic.png"))).status).toBe(404);
    expect(await sql("select count(*)::int n from priority_attachments")).toEqual([{ n: 0 }]);
  });

  it("holds the per-priority cap", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await attachments.POST(uploadReq(mine, PNG, `p${i}.png`))).status).toBe(200);
    }
    const sixth = await json(await attachments.POST(uploadReq(mine, PNG, "p5.png")));
    expect(sixth.status).toBe(409);
    expect(await sql("select count(*)::int n from priority_attachments where priority_id = $1", [mine]))
      .toEqual([{ n: 5 }]);
  });

  it("plain text downloads as a file rather than rendering", async () => {
    const up = await json(await attachments.POST(uploadReq(mine, new TextEncoder().encode("hello notes"), "notes.txt")));
    expect(up.body.attachment.kind).toBe("text");
    const down = await attachments.GET(get(`id=${up.body.attachment.id}`));
    expect(down.headers.get("content-disposition")).toContain("attachment");
  });
});
