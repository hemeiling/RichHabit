import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rangeScore } from "../src/lib/habits";
import { emptyState } from "../src/lib/types";
import type { AppState, Habit, Priority } from "../src/lib/types";

/**
 * Community has two independent rankings: habits and accomplishments.
 *
 * These tests run the real board code against a fake database. They pin that
 * the habit ranking is exactly what it was, that the accomplishment ranking
 * counts completed priorities in the reader's calendar month, that each board
 * has its own eligibility, and that nothing private or combined leaves the server.
 */

/* ---------------------------- a fake database ----------------------------- */

interface FakeUser { id: string; username: string; created_at: string; disabled_at: string | null; role: string }
const U = (n: string) => `00000000-0000-4000-8000-${n.padStart(12, "0")}`;
const users: FakeUser[] = [
  { id: U("1"), username: "hippo", created_at: "2026-01-01T00:00:00Z", disabled_at: null, role: "member" },
  { id: U("2"), username: "claire", created_at: "2026-01-02T00:00:00Z", disabled_at: null, role: "member" },
  // An admin who builds habits is a member like anyone else.
  { id: U("3"), username: "richhabit02", created_at: "2026-01-03T00:00:00Z", disabled_at: null, role: "admin" },
  { id: U("4"), username: "nohabits", created_at: "2026-01-04T00:00:00Z", disabled_at: null, role: "member" },
  { id: U("5"), username: "hiddenhero", created_at: "2026-01-05T00:00:00Z", disabled_at: null, role: "member" },
  { id: U("6"), username: "gone", created_at: "2026-01-06T00:00:00Z", disabled_at: "2026-09-01T00:00:00Z", role: "member" },
];
const [HIPPO, CLAIRE, ADMIN, NOHABITS, HIDDEN, DISABLED] = users.map((u) => u.id);
const states = new Map<string, AppState>();
const sqlSeen: string[] = [];

vi.mock("@/lib/db/pool", () => ({
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    sqlSeen.push(sql);
    if (sql.includes("community_month_scores")) return [{ n: 1 }];
    let rows = users;
    // Only the real rule filters; if the code ever stopped using it, disabled users would leak in.
    if (sql.includes("u.disabled_at is null")) rows = rows.filter((u) => u.disabled_at === null);
    if (sql.includes("any($1::uuid[])")) rows = rows.filter((u) => (params![0] as string[]).includes(u.id));
    return rows.map(({ id, username, created_at }) => ({ id, username, created_at }));
  }),
}));
vi.mock("@/lib/db/queries", () => ({
  loadState: vi.fn(async (id: string) => structuredClone(states.get(id)!)),
}));

const community = await import("../src/lib/community");
const { communitySnapshot, clearCommunityCache, markMemberStale, viewerToday, rankAccomplishments, rankHabits, monthToDate } = community;

/* ------------------------------- scenario --------------------------------- */

const habit = { id: "h", name: "h", templateKey: null, category: "morning", type: "good",
  frequency: { mode: "daily", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 }, tracking: "boolean",
  startDate: "2026-08-01", status: "active", active: true, weight: 1 } as unknown as Habit;

let p = 0;
const done = (completedOn: string | null, text = "Private words", createdOn = "2026-09-01"): Priority => ({
  id: `prio-${++p}`, text, createdOn, completedOn, category: (["urgent_important", "important_not_urgent",
    "urgent_not_important", "not_important_not_urgent"] as const)[p % 4], plannedOn: "2026-09-20", sortOrder: p,
});
const days = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `2026-09-${String(from + i).padStart(2, "0")}`);

function member(keep: (day: number) => boolean, priorities: Priority[], withHabit = true): AppState {
  const s = emptyState();
  if (withHabit) {
    s.habits = [habit];
    for (let d = 1; d <= 30; d++) if (keep(d)) (s.completions[`2026-09-${String(d).padStart(2, "0")}`] ??= {}).h = { done: true } as never;
  }
  s.priorities = priorities;
  return s;
}

beforeEach(() => {
  clearCommunityCache();
  sqlSeen.length = 0;
  // Habits: hippo keeps a third, claire keeps a fifth, the admin keeps a tenth.
  // Accomplishments: hippo 7 (+1 in October), claire 4, admin 2, nohabits 4.
  states.set(HIPPO, member((d) => d % 3 === 0, [...days(7).map((d) => done(d, `hippo secret ${d}`)), done("2026-10-01", "hippo october")]));
  states.set(CLAIRE, member((d) => d % 5 === 0, days(4, 10).map((d) => done(d, "claire secret"))));
  states.set(ADMIN, member((d) => d % 10 === 0, days(2, 20).map((d) => done(d, "admin secret"))));
  states.set(NOHABITS, member(() => false, days(4, 5).map((d) => done(d, "nohabits secret")), false));
  // Hidden: would top both boards.
  const hidden = member(() => true, days(9).map((d) => done(d, "hidden secret")));
  hidden.prefs.communityVisible = false;
  states.set(HIDDEN, hidden);
  // Disabled: would also top both boards.
  states.set(DISABLED, member(() => true, days(12).map((d) => done(d, "disabled secret"))));
});

const TODAY = "2026-09-30";

/* --------------------------------- tests ---------------------------------- */

describe("the habit ranking is unchanged", () => {
  it("is exactly the old rule: scheduled members, highest percentage, oldest account first", async () => {
    const snap = await communitySnapshot(HIPPO, TODAY);
    const { dates } = monthToDate(TODAY);
    // The previous implementation, restated independently.
    const legacy = users
      .filter((u) => u.disabled_at === null && states.get(u.id)!.prefs.communityVisible !== false)
      .map((u) => {
        const s = states.get(u.id)!;
        return { name: u.username, created: u.created_at, pct: rangeScore({ ...s, prefs: { ...s.prefs, weighted: false } }, dates).pct };
      })
      .filter((e) => e.pct !== null)
      .sort((a, b) => b.pct! - a.pct! || a.created.localeCompare(b.created))
      .map((e, i) => ({ rank: i + 1, name: e.name, pct: e.pct }));
    expect(snap.top.map(({ rank, name, pct }) => ({ rank, name, pct }))).toEqual(legacy);
    expect(snap.top.map((e) => e.name)).toEqual(["hippo", "claire", "richhabit02"]);
    expect(snap.activeUsers).toBe(3);
    expect(snap.me).toMatchObject({ rank: 1, name: "hippo" });
  });

  it("keeps its row shape, with no accomplishment figure mixed in", async () => {
    const snap = await communitySnapshot(HIPPO, TODAY);
    for (const e of snap.top) expect(Object.keys(e).sort()).toEqual(["isMe", "name", "pct", "rank"]);
    expect(Object.keys(snap.me!).sort()).toEqual(["name", "pct", "rank"]);
  });

  it("keeps ties split by account age, as before", () => {
    const m = (id: string, createdAt: string, pct: number) => ({ id, name: id, createdAt, pct, count: 0 });
    expect(rankHabits([m("b", "2026-02-01", 50), m("a", "2026-01-01", 50)]).map((e) => [e.name, e.rank]))
      .toEqual([["a", 1], ["b", 2]]);
  });
});

describe("the accomplishment ranking", () => {
  it("counts completed priorities in the month, every quadrant equal, most first", async () => {
    const acc = (await communitySnapshot(HIPPO, TODAY)).accomplishments;
    expect(acc.top.map((e) => [e.rank, e.name, e.count])).toEqual([
      [1, "hippo", 7], [2, "claire", 4], [2, "nohabits", 4], [4, "richhabit02", 2],
    ]);
    expect(acc.members).toBe(4);
    expect(acc.me).toEqual({ rank: 1, count: 7, name: "hippo" });
    expect(acc.mine).toBe(7);
  });

  it("shares a rank on equal counts and lists the tie in the board's stable order", () => {
    const m = (id: string, createdAt: string, count: number) => ({ id, name: id, createdAt, pct: null, count });
    expect(rankAccomplishments([m("c", "2026-03-01", 2), m("b", "2026-02-01", 5), m("a", "2026-01-01", 5), m("z", "2026-01-01", 0)])
      .map((e) => [e.name, e.rank])).toEqual([["a", 1], ["b", 1], ["c", 3]]);
  });

  it("drops a reopened priority", async () => {
    await communitySnapshot(HIPPO, TODAY);
    states.get(HIPPO)!.priorities[0].completedOn = null;
    markMemberStale(HIPPO);
    const acc = (await communitySnapshot(HIPPO, TODAY)).accomplishments;
    expect(acc.me).toEqual({ rank: 1, count: 6, name: "hippo" });
  });

  it("moves a recompleted priority to its new day, and its new month", async () => {
    await communitySnapshot(CLAIRE, TODAY);
    await communitySnapshot(CLAIRE, "2026-10-01");
    const moved = states.get(CLAIRE)!.priorities[0];
    moved.completedOn = null;
    moved.completedOn = "2026-10-01";
    markMemberStale(CLAIRE);
    const sep = (await communitySnapshot(CLAIRE, TODAY)).accomplishments;
    const oct = (await communitySnapshot(CLAIRE, "2026-10-01")).accomplishments;
    expect(sep.mine).toBe(3);
    expect(sep.top.find((e) => e.name === "claire")).toMatchObject({ count: 3, rank: 3 });
    expect(oct.mine).toBe(1);
    expect(oct.top.map((e) => [e.name, e.count])).toEqual([["hippo", 1], ["claire", 1]]);
  });

  it("uses the reader's calendar month, not the server's", async () => {
    const la = viewerToday("America/Los_Angeles", new Date("2026-10-01T06:30:00Z"));
    const ny = viewerToday("America/New_York", new Date("2026-10-01T04:30:00Z"));
    expect(la).toBe("2026-09-30");
    expect(ny).toBe("2026-10-01");
    const september = await communitySnapshot(HIPPO, la);
    const october = await communitySnapshot(HIPPO, ny);
    expect(september.month).toBe("2026-09");
    expect(september.accomplishments.me?.count).toBe(7);
    expect(october.month).toBe("2026-10");
    expect(october.accomplishments.me).toEqual({ rank: 1, count: 1, name: "hippo" });
  });
});

describe("eligibility is per ranking", () => {
  it("puts a member with accomplishments but no habits on the accomplishment ranking only", async () => {
    const snap = await communitySnapshot(NOHABITS, TODAY);
    expect(snap.top.some((e) => e.name === "nohabits")).toBe(false);
    expect(snap.me).toBeNull();
    expect(snap.accomplishments.me).toEqual({ rank: 2, count: 4, name: "nohabits" });
    expect(snap.accomplishments.mine).toBe(4);
  });

  it("keeps a visible member with nothing completed off the accomplishment ranking but tells them their zero", async () => {
    states.get(ADMIN)!.priorities = [];
    const snap = await communitySnapshot(ADMIN, TODAY);
    expect(snap.me).not.toBeNull();
    expect(snap.accomplishments.me).toBeNull();
    expect(snap.accomplishments.mine).toBe(0);
  });

  it("removes an opted-out member from both rankings", async () => {
    const other = await communitySnapshot(HIPPO, TODAY);
    expect(JSON.stringify(other)).not.toContain("hiddenhero");
    const own = await communitySnapshot(HIDDEN, TODAY);
    expect(own.me).toBeNull();
    expect(own.accomplishments.me).toBeNull();
    expect(own.accomplishments.mine).toBeNull();
  });

  it("removes a member who opts out after the board was built", async () => {
    await communitySnapshot(HIPPO, TODAY);
    states.get(CLAIRE)!.prefs.communityVisible = false;
    markMemberStale(CLAIRE);
    const snap = await communitySnapshot(HIPPO, TODAY);
    expect(snap.top.some((e) => e.name === "claire")).toBe(false);
    expect(snap.accomplishments.top.some((e) => e.name === "claire")).toBe(false);
  });

  it("excludes disabled accounts from both, through the shared rule", async () => {
    const snap = await communitySnapshot(HIPPO, TODAY);
    expect(JSON.stringify(snap)).not.toContain("gone");
    expect(sqlSeen.some((s) => s.includes(community.RANKS_ON_LEADERBOARD))).toBe(true);
  });

  it("keeps admins who take part, because the rule has no role filter", async () => {
    const snap = await communitySnapshot(HIPPO, TODAY);
    expect(community.RANKS_ON_LEADERBOARD).toBe("u.disabled_at is null");
    expect(snap.top.some((e) => e.name === "richhabit02")).toBe(true);
    expect(snap.accomplishments.top.some((e) => e.name === "richhabit02")).toBe(true);
  });
});

describe("what leaves the server", () => {
  it("carries names, ranks and counts only — nothing about any priority", async () => {
    const snap = await communitySnapshot(HIPPO, TODAY);
    // `updatedAt` is the board's own refresh time, not anything about a priority.
    const json = JSON.stringify({ ...snap, updatedAt: "" });
    expect(json).not.toMatch(/secret|october|Private words/);
    expect(json).not.toMatch(/2026-09-0\d|2026-09-1\d|2026-09-20|2026-10-01/);
    expect(json).not.toMatch(/urgent_|important|plannedOn|createdOn|completedOn|createdAt|"id"|prio-|00000000-/);
    for (const e of snap.accomplishments.top) expect(Object.keys(e).sort()).toEqual(["count", "isMe", "name", "rank"]);
    expect(Object.keys(snap.accomplishments.me!).sort()).toEqual(["count", "name", "rank"]);
    expect(Object.keys(snap.accomplishments).sort()).toEqual(["me", "members", "mine", "top"]);
  });

  it("has no combined or overall score anywhere", async () => {
    const snap = await communitySnapshot(HIPPO, TODAY);
    expect(Object.keys(snap).sort()).toEqual(["accomplishments", "activeUsers", "me", "month", "top", "updatedAt"]);
    const src = fs.readFileSync("src/lib/community.ts", "utf8");
    expect(src).not.toMatch(/pct\s*\+\s*[\w.]*count|count\s*\+\s*[\w.]*pct|overall|combined\s*=|totalScore/i);
  });
});
