import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Project Progress & Contributions through the real routes and data layer,
 * against Postgres (PGlite) with the real schema — the harness of
 * together-work.test.ts. Tasks are written directly so their dates can lie
 * years back, exactly as a long-running space's would.
 *
 * What must hold: members only, and anyone else is answered exactly as a space
 * that does not exist; nothing crosses from one space to another, not even a
 * group or a member named in a filter; History counts in full, deleted tasks
 * nowhere, reopened ones as open; a task with no estimate counts as 1 point
 * while its stored value stays empty; the workbook is a real five-sheet .xlsx
 * whose filtered numbers are the dashboard's, with formula-like text kept as
 * text; and analytics carry counts, never words.
 */

let db: PGlite;
const open: PGlite[] = [];
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__tgDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__tgDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));
let signedIn: string | null = null;
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => (signedIn ? { id: signedIn, email: "x" } : null) }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }), headers: () => new Map() }));
const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
vi.mock("@/lib/analytics/track", () => ({ trackEvent: async (e: any) => { tracked.push(e); } }));

const progress = await import("../src/app/api/together/boards/[id]/progress/route");
const exporter = await import("../src/app/api/together/boards/[id]/progress/export/route");
const history = await import("../src/app/api/together/boards/[id]/tasks/history/route");
const work = await import("../src/app/api/together/boards/[id]/work/route");
const tasksRoute = await import("../src/app/api/together/boards/[id]/tasks/route");
const { safeName } = await import("../src/lib/together/progressWorkbook");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
afterAll(async () => { for (const d of open) await d.close(); });
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;
const allow = (...ids: string[]) => { process.env.TOGETHER_PREVIEW_USER_IDS = ids.join(","); };
async function account(name: string) {
  const [u] = await sql(`insert into users (email, username, password_hash) values ($1, $2, 'x') returning id`,
    [`${name.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`, `${name.toLowerCase()}${randomUUID().slice(0, 4)}`]);
  await sql(`insert into profiles (id, first_name) values ($1, $2)`, [u.id, name]);
  return u.id as string;
}
async function space(owner: string, members: string[], name: string) {
  const [b] = await sql(`insert into together_boards (name, created_by) values ($1, $2) returning id`, [name, owner]);
  await sql(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'owner', $2)`, [b.id, owner]);
  for (const m of members) await sql(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'member', $3)`, [b.id, m, owner]);
  return b.id as string;
}
const group = async (board: string, name: string) =>
  (await sql(`insert into together_groups (board_id, name) values ($1, $2) returning id`, [board, name]))[0].id as string;
interface TaskSeed { title: string; stage: string; created?: string; moved?: string; group?: string | null; effort?: number | null;
  due?: string | null; assignees?: string[]; deleted?: boolean }
async function seed(board: string, by: string, t: TaskSeed) {
  const [row] = await sql(
    `insert into together_tasks (board_id, title, stage, created_at, moved_at, group_id, effort, due_on, created_by, updated_by, deleted_at)
     values ($1, $2, $3, coalesce($4::timestamptz, now()), coalesce($5::timestamptz, now()), $6, $7, $8, $9, $9,
             case when $10 then now() end) returning id`,
    [board, t.title, t.stage, t.created ?? null, t.moved ?? null, t.group ?? null, t.effort ?? null, t.due ?? null, by, t.deleted ?? false]);
  for (const a of t.assignees ?? []) await sql(`insert into together_task_assignees (task_id, board_id, user_id) values ($1, $2, $3)`, [row.id, board, a]);
  return row.id as string;
}

const as = (id: string | null) => { signedIn = id; };
const P = (id: string) => ({ params: { id } });
const get = (url: string) => new Request(`http://x/api${url}`, { method: "GET" });
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) });
const read = async (who: string, board: string, qs = "") => { as(who); return json(await progress.GET(get(`?tz=UTC${qs}`), P(board))); };
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** The workbook's parts, by name — a plain central-directory walk (the writer's own tests check every byte). */
function parts(buf: Buffer): Map<string, string> {
  const end = buf.length - 22;
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const local = buf.readUInt32LE(p + 42);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.set(name, inflateRawSync(buf.subarray(start, start + buf.readUInt32LE(p + 20))).toString("utf8"));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#13;/g, "\r").replace(/&amp;/g, "&");
/** A sheet's rows as text and numbers (dates as serials), by row number. */
function rowsOf(sheet: string): Map<number, (string | number)[]> {
  const rows = new Map<number, (string | number)[]>();
  for (const [, r, body] of sheet.matchAll(/<row r="(\d+)">(.*?)<\/row>/gs)) {
    const cells: (string | number)[] = [];
    for (const [, ref, attrs, inner] of body.matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(.*?)<\/c>/gs)) {
      const col = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const t = /<t[^>]*>(.*?)<\/t>/s.exec(inner);
      cells[col] = attrs.includes('t="inlineStr"') ? unescape(t?.[1] ?? "") : Number(/<v>(.*?)<\/v>/.exec(inner)?.[1]);
    }
    rows.set(Number(r), cells);
  }
  return rows;
}
async function download(who: string, board: string, qs: string) {
  as(who);
  const res = await exporter.GET(get(`?tz=UTC${qs}`), P(board));
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
}

let owner: string, ann: string, bo: string, stranger: string;
let A: string, B: string, design: string, build: string, secret: string;
const ids: Record<string, string> = {};

beforeEach(async () => {
  db = await PGlite.create();
  open.push(db);
  await db.exec(SCHEMA);
  (globalThis as any).__tgDb = db;
  tracked.length = 0;
  signedIn = null;
  owner = await account("Hippo"); ann = await account("Ann"); bo = await account("Bo"); stranger = await account("Stranger");
  allow(owner, ann, bo, stranger);
  A = await space(owner, [ann, bo], "头带生意 Headband");
  B = await space(stranger, [], "Elsewhere");
  design = await group(A, "Design"); build = await group(A, "Build"); secret = await group(B, "Secret");
  // A project two and a half years long. History is Done for more than a day.
  ids.a = await seed(A, owner, { title: "设计稿 · 第二版", stage: "done", created: "2024-03-01T10:00Z", moved: "2024-03-10T10:00Z", group: design, effort: 3, assignees: [ann, bo] });
  ids.b = await seed(A, owner, { title: "=HYPERLINK(\"http://evil.example\",\"click\")", stage: "done", created: "2025-05-20T10:00Z", moved: "2025-06-05T10:00Z", group: build, assignees: [ann] });
  ids.c = await seed(A, owner, { title: "Ship the samples", stage: "done", created: "2026-10-01T10:00Z", group: design, effort: 2, assignees: [bo] });   // finished just now: still on the Board
  ids.d = await seed(A, owner, { title: "Order fabric", stage: "todo", created: "2026-09-01T10:00Z", group: design, effort: 5, due: day(1), assignees: [ann] });
  ids.e = await seed(A, owner, { title: "Call the printer", stage: "doing", created: "2026-08-15T10:00Z", due: day(-1) });
  ids.f = await seed(A, owner, { title: "Pop-up shop?", stage: "backlog", created: "2025-01-10T10:00Z", group: build, effort: 8 });
  ids.g = await seed(A, owner, { title: "Deleted work", stage: "done", created: "2025-02-01T10:00Z", moved: "2025-02-02T10:00Z", group: design, effort: 5, assignees: [ann], deleted: true });
  ids.h = await seed(A, owner, { title: "Reopened logo", stage: "todo", created: "2024-04-01T10:00Z", moved: "2026-10-10T10:00Z" });   // was Done once; reopened
  await seed(B, stranger, { title: "Their secret plan", stage: "done", created: "2025-01-01T10:00Z", moved: "2025-01-02T10:00Z", group: secret, effort: 8, assignees: [stranger] });
});

describe("who may read a space's progress", () => {
  it("answers a non-member — and a garbage id — exactly as a space that does not exist, on every Progress route", async () => {
    const missing = randomUUID();
    for (const [name, call] of [
      ["progress", (b: string) => progress.GET(get("?tz=UTC"), P(b))],
      ["export", (b: string) => exporter.GET(get("?tz=UTC&scope=all"), P(b))],
      ["history", (b: string) => history.GET(get("?q=x"), P(b))],
    ] as const) {
      as(stranger);
      const theirs = await json(await call(A));
      const nowhere = await json(await call(missing));
      const garbage = await json(await call("not-a-uuid"));
      expect(theirs.status, name).toBe(404);
      expect(theirs, name).toEqual(nowhere);
      expect(garbage, name).toEqual(nowhere);
    }
    expect(tracked).toEqual([]);   // a refused read or export records nothing
    as(null);
    expect((await progress.GET(get(""), P(A))).status).toBe(401);
    expect((await exporter.GET(get(""), P(A))).status).toBe(401);
  });
});

describe("the dashboard", () => {
  it("is All Time by default: History counts, the Backlog stands apart, deleted work nowhere, a reopened task as open", async () => {
    const { status, body } = await read(ann, A);
    expect(status).toBe(200);
    expect(body.filters).toMatchObject({ period: { kind: "all", from: null, to: null }, group: "all", member: "all" });
    const t = body.report.totals;
    expect(t.committed).toEqual({ tasks: 6, points: 3 + 1 + 2 + 5 + 1 + 1 });   // a b c d e h; b, e and h default to 1
    expect(t.completed).toEqual({ tasks: 3, points: 6 });                       // a and b in History, c on the Board
    expect(t.rate).toBe(0.5);
    expect(t.defaulted).toBe(3);
    expect(t.backlog).toEqual({ tasks: 1, points: 8 });
    expect(body.report.now).toMatchObject({ todo: { tasks: 2 }, doing: { tasks: 1 }, waiting: { tasks: 0 }, dueSoon: 1, overdue: 1 });
    expect(body.report.firstDay).toBe("2024-03-01");
    expect(body.report.trend.granularity).toBe("month");
    expect(body.report.trend.buckets.at(-1)).toMatchObject({ cumTasks: 3, cumPoints: 6 });
    // The stored estimates are untouched: "no estimate" stays empty in the database.
    expect((await sql(`select effort from together_tasks where id = $1`, [ids.b]))[0].effort).toBeNull();
    expect(body.spaceTasks).toBe(7);           // a–f and h: the deleted one is not counted
    expect(body.timeZone).toBe("UTC");
    // Numbers and names only: no task's words leave through the dashboard.
    expect(JSON.stringify(body)).not.toMatch(/设计稿|HYPERLINK|Order fabric|secret/i);
  });

  it("credits every assignee in full, marks shared work, and never adds people up into the totals", async () => {
    const { body } = await read(owner, A);
    const row = (id: string | null) => body.report.contributions.find((r: any) => r.memberId === id);
    // In the space's own member order (who joined first), then the unassigned row — never by output.
    expect(body.report.contributions.map((r: any) => r.memberId)).toEqual([...body.members.map((m: any) => m.id), null]);
    expect(row(ann)).toMatchObject({ assigned: { tasks: 3, points: 9 }, completed: { tasks: 2, points: 4 }, shared: 1, sharedCompleted: 1 });
    expect(row(bo)).toMatchObject({ assigned: { tasks: 2, points: 5 }, completed: { tasks: 2, points: 5 }, shared: 1 });
    expect(row(owner)).toMatchObject({ assigned: { tasks: 0 }, rate: null });
    expect(row(null)).toMatchObject({ assigned: { tasks: 2, points: 2 }, completed: { tasks: 0 } });
    const summed = body.report.contributions.reduce((n: number, r: any) => n + r.completed.points, 0);
    expect(summed).toBeGreaterThan(body.report.totals.completed.points);   // a shared task in two rows, once in the total
  });

  it("filters by group — Ungrouped included — by member and by period, together", async () => {
    const design1 = (await read(ann, A, `&group=${design}`)).body;
    expect(design1.report.totals.committed).toEqual({ tasks: 3, points: 10 });
    expect(design1.report.totals.completed.tasks).toBe(2);
    const none = (await read(ann, A, "&group=none")).body;
    expect(none.report.totals.committed).toEqual({ tasks: 2, points: 2 });
    const annDesign2025 = (await read(ann, A, `&group=${design}&member=${ann}&period=custom&from=2024-01-01&to=2024-12-31`)).body;
    expect(annDesign2025.filters.period).toEqual({ kind: "custom", from: "2024-01-01", to: "2024-12-31" });
    expect(annDesign2025.report.totals).toMatchObject({ committed: { tasks: 1, points: 3 }, completed: { tasks: 1, points: 3 } });
    // 2025: b finished in June, h (created 2024, reopened later) was still open at the year's end; a was already done.
    const y2025 = (await read(ann, A, "&period=custom&from=2025-01-01&to=2025-12-31")).body;
    expect(y2025.report.totals).toMatchObject({ committed: { tasks: 2 }, completed: { tasks: 1, points: 1 }, backlog: { tasks: 1 } });
    const unassigned = (await read(ann, A, "&member=none")).body;
    expect(unassigned.report.contributions).toEqual([expect.objectContaining({ memberId: null })]);
  });

  it("drops a filter naming a group or member it does not have — another space's included — and says so", async () => {
    const theirGroup = (await read(ann, A, `&group=${secret}`)).body;
    expect(theirGroup.dropped).toEqual({ group: true, member: false });
    expect(theirGroup.filters.group).toBe("all");
    expect(theirGroup.report.totals.committed.tasks).toBe(6);
    const theirMember = (await read(ann, A, `&member=${stranger}`)).body;
    expect(theirMember.dropped).toEqual({ group: false, member: true });
    // A deleted group: its tasks become ungrouped, and a filter still naming it widens.
    await sql(`delete from together_groups where id = $1`, [build]);
    const after = (await read(ann, A, `&group=${build}`)).body;
    expect(after.dropped.group).toBe(true);
    expect((await read(ann, A, "&group=none")).body.report.totals.committed.tasks).toBe(3);
    expect(after.groups.map((g: any) => g.name)).toEqual(["Design"]);
  });

  it("reads a time zone by its own name, whatever its capitalisation — and an unknown one as UTC", async () => {
    as(ann);
    expect((await json(await progress.GET(get("?tz=america/chicago"), P(A)))).body.timeZone).toBe("America/Chicago");
    expect((await json(await progress.GET(get("?tz=Not/AZone"), P(A)))).body.timeZone).toBe("UTC");
    // Filters that select nothing still answer with zeros — the space itself has work.
    const nothing = (await read(ann, A, "&period=custom&from=2020-01-01&to=2020-12-31")).body;
    expect(nothing.report.totals.committed.tasks).toBe(0);
    expect(nothing.spaceTasks).toBe(7);
    expect(nothing.report.now.todo.tasks).toBe(2);   // right now ignores the period
  });

  it("refuses a custom range that is not two real dates", async () => {
    const r = await read(ann, A, "&period=custom&from=2025-02-30&to=2025-03-01");
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/start date and an end date/);
  });

  it("is counted once when opened — the period's kind, never a word — and not on every filter change", async () => {
    await read(ann, A, "&first=1&period=year");
    await read(ann, A, "&group=none");
    expect(tracked).toEqual([expect.objectContaining({ event: "together_progress_viewed", properties: { period: "year", filtered: false } })]);
  });
});

describe("adding work while filtered to a group", () => {
  it("creates the task in that group, so it stays in view — and only in one of this space's groups", async () => {
    as(ann);
    const add = (body: unknown) => tasksRoute.POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body),
      headers: { "content-type": "application/json" } }), P(A)).then(json);
    const inDesign = await add({ title: "Order zips", stage: "backlog", groupId: design });
    expect(inDesign.status).toBe(200);
    expect(inDesign.body.task).toMatchObject({ title: "Order zips", stage: "backlog", groupId: design });
    expect((await add({ title: "No group", stage: "todo" })).body.task.groupId).toBeNull();
    const foreign = await add({ title: "Sneaky", groupId: secret });
    expect(foreign.status).toBe(409);
    expect(foreign.body.error).toBe("That group no longer exists.");
    expect((await add({ title: "Garbage", groupId: "design" })).status).toBe(409);
    expect((await sql(`select count(*)::int n from together_tasks where title in ('Sneaky', 'Garbage')`))[0].n).toBe(0);
  });
});

describe("History, filtered", () => {
  it("pages one group's, or the ungrouped, with what the whole filter holds by month in the reader's zone", async () => {
    // Finished at 03:00 UTC on Feb 1 — still January in Chicago.
    await seed(A, owner, { title: "Late-night invoice", stage: "done", created: "2026-01-20T10:00Z", moved: "2026-02-01T03:00Z", group: design });
    as(ann);
    const utc = (await json(await history.GET(get(`?group=${design}&tz=UTC`), P(A)))).body;
    expect(utc.tasks.map((t: any) => t.title)).toEqual(["Late-night invoice", "设计稿 · 第二版"]);
    expect(utc).toMatchObject({ total: 2, points: 1 + 3, months: [{ month: "2026-02", tasks: 1, points: 1 }, { month: "2024-03", tasks: 1, points: 3 }] });
    const chicago = (await json(await history.GET(get(`?group=${design}&tz=America/Chicago`), P(A)))).body;
    expect(chicago.months[0]).toEqual({ month: "2026-01", tasks: 1, points: 1 });
    const none = (await json(await history.GET(get("?group=none&tz=UTC"), P(A)))).body;
    expect(none.tasks).toEqual([]);
    expect(none.total).toBe(0);
  });

  it("searches titles as typed — Chinese, case, and characters LIKE would treat as wildcards", async () => {
    as(ann);
    const zh = (await json(await history.GET(get(`?q=${encodeURIComponent("设计")}&tz=UTC`), P(A)))).body;
    expect(zh.tasks.map((t: any) => t.id)).toEqual([ids.a]);
    const upper = (await json(await history.GET(get("?q=hyperLINK&tz=UTC"), P(A)))).body;
    expect(upper.tasks.map((t: any) => t.id)).toEqual([ids.b]);
    const wild = (await json(await history.GET(get(`?q=${encodeURIComponent("%")}&tz=UTC`), P(A)))).body;
    expect(wild.tasks).toEqual([]);
  });

  it("widens a group that is not this space's — deleted, or another space's — and says so", async () => {
    as(ann);
    const foreign = (await json(await history.GET(get(`?group=${secret}&tz=UTC`), P(A)))).body;
    expect(foreign).toMatchObject({ dropped: true, total: 2 });
    expect(foreign.tasks.map((t: any) => t.title)).not.toContain("Their secret plan");
    await sql(`delete from together_groups where id = $1`, [design]);
    const gone = (await json(await history.GET(get(`?group=${design}&tz=UTC`), P(A)))).body;
    expect(gone).toMatchObject({ dropped: true, total: 2 });
    const fine = (await json(await history.GET(get(`?group=${build}&tz=UTC`), P(A)))).body;
    expect(fine.dropped).toBeUndefined();
    expect(fine.total).toBe(1);
  });

  it("is summed per group on the space's own read, so a collapsed History can still say what it holds", async () => {
    as(ann);
    const w = (await json(await work.GET(get(""), P(A)))).body;
    expect(w.history).toMatchObject({ total: 2, points: 4 });
    const byGroup = Object.fromEntries(w.history.groups.map((g: any) => [g.groupId ?? "none", [g.tasks, g.points]]));
    expect(byGroup).toEqual({ [design]: [1, 3], [build]: [1, 1] });
  });
});

describe("the Excel export", () => {
  it("is a real .xlsx with five bilingual sheets, named for the space, never cached", async () => {
    const { res, buf } = await download(ann, A, "&scope=all");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const disposition = res.headers.get("content-disposition")!;
    expect(disposition).toMatch(/^attachment; filename="together-progress-\d{4}-\d{2}-\d{2}\.xlsx"; filename\*=UTF-8''/);
    expect(decodeURIComponent(disposition.split("''")[1])).toMatch(/^头带生意 Headband - Progress - \d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(buf.subarray(0, 4).toString("hex")).toBe("504b0304");
    const p = parts(buf);
    const names = [...p.get("xl/workbook.xml")!.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(["Project Summary · 项目概览", "Group Summary · 分组汇总", "Member Contributions · 成员贡献",
      "Monthly Trends · 月度趋势", "Task Details · 任务明细"]);
    for (const [name, xml] of p) expect(xml, name).not.toMatch(/<f[ >]/);
  });

  it("lists every live task — History included, deleted excluded — with defaulted points marked and formula-like titles kept as text", async () => {
    const p = parts((await download(ann, A, "&scope=all")).buf);
    const tasks = rowsOf(p.get("xl/worksheets/sheet5.xml")!);
    expect(tasks.get(1)!.slice(0, 3)).toEqual(["Task / 任务", "Type / 类型", "Group / 分组"]);
    const titles = [...tasks.values()].slice(1).map((r) => r[0]);
    expect(titles.sort()).toEqual(["=HYPERLINK(\"http://evil.example\",\"click\")", "Call the printer", "Order fabric", "Pop-up shop?",
      "Reopened logo", "Ship the samples", "设计稿 · 第二版"].sort());
    const byTitle = new Map([...tasks.values()].slice(1).map((r) => [r[0], r]));
    // Columns: task, type, group, status, history status, in this period, assignees, shared, points, defaulted, created, completed, due.
    const shared = byTitle.get("设计稿 · 第二版")!;
    expect(shared.slice(1, 6)).toEqual(["Task", "Design", "Done", "In History", "Completed"]);
    expect(String(shared[6]).split("; ").sort()).toEqual(["Ann", "Bo"]);
    expect(shared.slice(7, 12)).toEqual(["Yes", 3, "No", 45352, 45361]);   // real dates: 2024-03-01 and 2024-03-10
    expect(shared[12]).toBeUndefined();                                   // no due date: an empty cell, not a made-up one
    expect(byTitle.get("=HYPERLINK(\"http://evil.example\",\"click\")")!.slice(8, 10)).toEqual([1, "Yes"]);
    expect(byTitle.get("Pop-up shop?")!.slice(3, 6)).toEqual(["Backlog", "In the Backlog", "Backlog (not committed)"]);
    expect(byTitle.get("Ship the samples")![4]).toBe("On the Board");
    // The formula-like title is an inline string whose style keeps it text even after an edit.
    const sheet = p.get("xl/worksheets/sheet5.xml")!;
    const cell = /<c r="A\d+" t="inlineStr" s="(\d+)"><is><t>=HYPERLINK/.exec(sheet);
    expect(cell).not.toBeNull();
    const xfs = [...p.get("xl/styles.xml")!.matchAll(/<xf [^>]*?(?:\/>|>.*?<\/xf>)/gs)].map((m) => m[0]).slice(1);   // skip cellStyleXfs
    expect(xfs[Number(cell![1])]).toMatch(/quotePrefix="1"/);
  });

  it("matches the dashboard for the same filters, and Entire project ignores them", async () => {
    const qs = `&group=${design}&member=${ann}`;
    const dash = (await read(ann, A, qs)).body.report.totals;
    const summary = rowsOf(parts((await download(ann, A, `${qs}&scope=view`)).buf).get("xl/worksheets/sheet1.xml")!);
    const value = (label: RegExp) => [...summary.values()].find((r) => typeof r[0] === "string" && label.test(r[0] as string))?.[1];
    expect(value(/^Committed tasks \(/)).toBe(dash.committed.tasks);
    expect(value(/^Completed tasks /)).toBe(dash.completed.tasks);
    expect(value(/^Committed story points/)).toBe(dash.committed.points);
    expect(value(/^Completed story points/)).toBe(dash.completed.points);
    expect(value(/^Group filter/)).toBe("Design");
    expect(value(/^Member filter/)).toBe("Ann");
    expect(value(/^Scope/)).toBe("Current filtered view");
    const view = rowsOf(parts((await download(ann, A, `${qs}&scope=view`)).buf).get("xl/worksheets/sheet5.xml")!);
    expect([...view.values()].slice(1).map((r) => r[0]).sort()).toEqual(["Order fabric", "设计稿 · 第二版"]);
    const whole = rowsOf(parts((await download(ann, A, `${qs}&scope=all`)).buf).get("xl/worksheets/sheet1.xml")!);
    expect([...whole.values()].find((r) => r[0] === "Scope / 导出范围")?.[1]).toBe("Entire project");
    expect([...whole.values()].find((r) => typeof r[0] === "string" && /^Committed tasks \(/.test(r[0] as string))?.[1]).toBe(6);
  });

  it("sums groups to the total, keeps members' overlapping rows apart, and trends every month with running totals", async () => {
    const p = parts((await download(owner, A, "&scope=all")).buf);
    const groups = [...rowsOf(p.get("xl/worksheets/sheet2.xml")!).values()].slice(1);
    expect(groups.map((r) => r[0])).toEqual(["Build", "Design", "Ungrouped", "Total"]);
    expect(groups.map((r) => r[1])).toEqual([1, 3, 2, 6]);
    const members = [...rowsOf(p.get("xl/worksheets/sheet3.xml")!).values()];
    expect(members[0][0]).toMatch(/must not be added together/);
    const annRows = members.filter((r) => r[0] === "Ann");
    expect(annRows.map((r) => r[1])).toEqual(["All groups", "Build", "Design"]);
    expect(annRows[0].slice(2, 4)).toEqual([3, 2]);
    const months = [...rowsOf(p.get("xl/worksheets/sheet4.xml")!).values()].slice(1);
    expect(months[0][0]).toBe("2024-03");
    expect(months.at(-1)!.slice(3, 5)).toEqual([3, 6]);
    expect(months.length).toBeGreaterThanOrEqual(31);
  });

  it("names the file from any space name — an emoji at the cut included — and never fails on it", async () => {
    const name = `${"x".repeat(59)}🎉 party`;   // the 60th character is the emoji: cut whole, never in half
    expect(safeName(name)).toBe(`${"x".repeat(59)}🎉`);
    expect(safeName("a/b:c*?\"<>|\u0001 \uD83D")).toBe("abc");   // refused characters and a lone surrogate go
    expect(safeName("   ")).toBe("Together");
    await sql(`update together_boards set name = $2 where id = $1`, [A, name]);
    const { res } = await download(ann, A, "&scope=all");
    expect(res.status).toBe(200);
    expect(decodeURIComponent(res.headers.get("content-disposition")!.split("''")[1])).toMatch(/^x{59}🎉 - Progress - /);
  });

  it("is audited with its scope and a count — never a title, a name or a filter's value", async () => {
    await download(ann, A, `&scope=view&group=${design}`);
    const e = tracked.find((x) => x.event === "together_progress_exported")!;
    expect(e.properties).toEqual({ scope: "view", tasks: 3 });
  });
});
