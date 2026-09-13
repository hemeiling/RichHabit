import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState } from "../src/lib/types";
import type { AppState, Habit, Priority } from "../src/lib/types";

/**
 * The Community board's month is the reader's calendar month, and its
 * accomplishment figures are counts only.
 *
 * The server runs in UTC. Before this, a reader in California on the evening of
 * September 30 saw a board already measuring October while their own progress
 * was still on September. These tests pin the reader's date, the window both
 * rankings use, that accomplishments never move the habit rank, and that no
 * priority text leaves.
 */

/* ---------------------------- a fake database ----------------------------- */

const users = [
  { id: "00000000-0000-4000-8000-00000000000a", username: "alice", created_at: "2026-01-01T00:00:00Z" },
  { id: "00000000-0000-4000-8000-00000000000b", username: "bob", created_at: "2026-01-02T00:00:00Z" },
  { id: "00000000-0000-4000-8000-00000000000c", username: "carol", created_at: "2026-01-03T00:00:00Z" },
];
const [ALICE, BOB, CAROL] = users.map((u) => u.id);
const states = new Map<string, AppState>();

vi.mock("@/lib/db/pool", () => ({
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    // The previous month is already closed, so the archive never writes here.
    if (sql.includes("community_month_scores")) return [{ n: 1 }];
    if (sql.includes("any($1::uuid[])")) return users.filter((u) => (params![0] as string[]).includes(u.id));
    return users;
  }),
}));
vi.mock("@/lib/db/queries", () => ({
  loadState: vi.fn(async (id: string) => structuredClone(states.get(id)!)),
}));

const { communitySnapshot, clearCommunityCache, markMemberStale, viewerToday } = await import("../src/lib/community");

/* ------------------------------- scenario --------------------------------- */

const habit = { id: "h", name: "h", templateKey: null, category: "morning", type: "good",
  frequency: { mode: "daily", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 }, tracking: "boolean",
  startDate: "2026-08-01", status: "active", active: true, weight: 1 } as unknown as Habit;

let n = 0;
const done = (completedOn: string, text: string): Priority => ({
  id: `p${++n}`, text, createdOn: completedOn, completedOn,
  category: "urgent_important", plannedOn: null, sortOrder: 0,
});

/** Ticks the one daily habit on every day from `from` to `to` for which `keep` holds. */
function member(from: string, to: string, keep: (day: number) => boolean, priorities: Priority[]): AppState {
  const s = emptyState();
  s.habits = [habit];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    if (keep(d.getUTCDate())) (s.completions[d.toISOString().slice(0, 10)] ??= {}).h = { done: true } as never;
  }
  s.priorities = priorities;
  return s;
}

beforeEach(() => {
  clearCommunityCache();
  // Alice keeps every habit and finishes one thing.
  states.set(ALICE, member("2026-09-01", "2026-10-01", () => true, [done("2026-09-10", "Alice private title")]));
  // Bob keeps half his habits and finishes a great many small things.
  states.set(BOB, member("2026-09-01", "2026-10-01", (d) => d % 2 === 0,
    Array.from({ length: 20 }, (_, i) => done(`2026-09-${String(i + 1).padStart(2, "0")}`, `Bob secret ${i}`))));
  // Carol finished something on October 1 only, and has chosen not to appear.
  states.set(CAROL, member("2026-09-01", "2026-10-01", () => true, [done("2026-10-01", "Carol hidden")]));
  states.get(CAROL)!.prefs.communityVisible = false;
});

/* --------------------------------- tests ---------------------------------- */

describe("viewerToday", () => {
  // 2026-10-01 at these UTC times is still September 30 in each US zone.
  it.each([
    ["America/Los_Angeles", "2026-10-01T06:30:00Z", "2026-09-30"],
    ["America/Denver", "2026-10-01T05:30:00Z", "2026-09-30"],
    ["America/Chicago", "2026-10-01T04:30:00Z", "2026-09-30"],
    ["America/New_York", "2026-10-01T03:30:00Z", "2026-09-30"],
    ["Pacific/Honolulu", "2026-10-01T09:30:00Z", "2026-09-30"],
  ])("%s is still on the old month just before local midnight", (zone, now, expected) => {
    expect(viewerToday(zone, new Date(now))).toBe(expected);
  });

  it("moves to the new month at local midnight, not UTC midnight", () => {
    expect(viewerToday("America/New_York", new Date("2026-10-01T04:00:00Z"))).toBe("2026-10-01");
    expect(viewerToday("America/Los_Angeles", new Date("2026-10-01T07:00:00Z"))).toBe("2026-10-01");
  });

  it("handles a zone ahead of UTC", () => {
    expect(viewerToday("Asia/Shanghai", new Date("2026-09-30T16:30:00Z"))).toBe("2026-10-01");
  });

  it("falls back to the server's date for a missing or unknown zone", async () => {
    const { iso } = await import("../src/lib/dates");
    const now = new Date("2026-10-01T03:30:00Z");
    expect(viewerToday(null, now)).toBe(iso(now));
    expect(viewerToday("", now)).toBe(iso(now));
    expect(viewerToday("Not/AZone", now)).toBe(iso(now));
    expect(viewerToday("x".repeat(200), now)).toBe(iso(now));
  });
});

describe("the board for a reader on September 30", () => {
  it("measures habits and accomplishments over September, not October", async () => {
    const snap = await communitySnapshot(ALICE, "2026-09-30");
    expect(snap.month).toBe("2026-09");
    expect(snap.accomplishments.top.find((e) => e.name === "bob")?.count).toBe(20);
    expect(snap.me).toMatchObject({ name: "alice", pct: 100, rank: 1 });
    expect(snap.accomplishments.mine).toBe(1);
  });

  it("while a reader already on October 1 sees October", async () => {
    const snap = await communitySnapshot(ALICE, "2026-10-01");
    expect(snap.month).toBe("2026-10");
    expect(snap.accomplishments.mine).toBe(0);
    expect(snap.accomplishments.top.find((e) => e.name === "bob")).toBeUndefined();
  });

  it("ranks habits by habits alone, however many accomplishments someone has", async () => {
    const snap = await communitySnapshot(BOB, "2026-09-30");
    expect(snap.top.map((e) => [e.rank, e.name])).toEqual([[1, "alice"], [2, "bob"]]);
    expect(snap.me).toMatchObject({ rank: 2 });
    expect(snap.accomplishments.me).toMatchObject({ rank: 1, count: 20 });
  });

  it("sends no priority text, and keeps a hidden member off the board entirely", async () => {
    const snap = await communitySnapshot(ALICE, "2026-09-30");
    const json = JSON.stringify(snap);
    expect(json).not.toMatch(/private title|secret|hidden|carol/i);
    expect(json).not.toMatch(/2026-09-10|urgent_important|completedOn|text/);
    expect(Object.keys(snap.top[0]).sort()).toEqual(["isMe", "name", "pct", "rank"]);
    expect(Object.keys(snap.accomplishments.top[0]).sort()).toEqual(["count", "isMe", "name", "rank"]);
  });

  it("picks up a newly completed priority on the next read", async () => {
    await communitySnapshot(ALICE, "2026-09-30");
    states.get(ALICE)!.priorities.push(done("2026-09-30", "Another"));
    markMemberStale(ALICE);
    expect((await communitySnapshot(ALICE, "2026-09-30")).accomplishments.mine).toBe(2);
  });

  it("marks every cached reader date stale, so both months stay current", async () => {
    await communitySnapshot(ALICE, "2026-09-30");
    await communitySnapshot(ALICE, "2026-10-01");
    states.get(ALICE)!.priorities.push(done("2026-10-01", "October thing"));
    markMemberStale(ALICE);
    expect((await communitySnapshot(ALICE, "2026-10-01")).accomplishments.mine).toBe(1);
    expect((await communitySnapshot(ALICE, "2026-09-30")).accomplishments.mine).toBe(1);
  });
});
