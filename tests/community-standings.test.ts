import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `communityStandings` — the read-only accessor Admin → Users uses for Rank and %.
 *
 * The invariant these tests exist to defend: **the admin screen must never make
 * the Community board compute.** Scoring one member costs a full `loadState`
 * (~16 queries), so an admin listing that scored a page of accounts would become
 * the most expensive thing in the app, on a screen nobody expects to be slow.
 *
 * The cache is module-private, and deliberately stays that way — exporting a
 * seam just for a test would let the test pass while the real path rotted. So
 * the board here is populated the way production populates it: by somebody
 * reading their own Community board through `communitySnapshot`. Once it is
 * warm, `loadState` is rearmed to **throw**, so any attempt by the accessor to
 * compute, refresh or repopulate fails loudly instead of quietly costing money.
 */

const state = vi.hoisted(() => ({
  /** Every state load, whoever caused it. */
  loads: 0,
  /** Flipped on once the cache is warm: from here, loading is a bug. */
  forbidLoads: false,
  /** The members `computeAll` will find. */
  members: [] as { id: string; username: string }[],
  /** id → the month-to-date percentage its state should produce. */
  pct: new Map<string, number | null>(),
}));

vi.mock("@/lib/db/pool", () => ({
  query: async (text: string) => {
    // The only query `computeAll` runs: the member list.
    if (/from users u/.test(text)) {
      return state.members.map((m) => ({
        id: m.id, username: m.username, created_at: `2026-08-01T00:00:00Z`,
      }));
    }
    // archiveMonth's count, so closing a previous month is a no-op here.
    if (/community_month_scores/.test(text)) return [{ n: 1 }];
    return [];
  },
  transaction: async () => { throw new Error("not used"); },
}));

/**
 * A state whose month-to-date score is whatever the test asked for. `pct: null`
 * means nothing scheduled — the "none" case — which `rangeScore` produces from a
 * state with no schedules.
 */
vi.mock("@/lib/db/queries", () => ({
  loadState: async (userId: string) => {
    state.loads++;
    if (state.forbidLoads) {
      throw new Error("communityStandings must never load a member's state");
    }
    const pct = state.pct.get(userId) ?? null;
    return {
      habits: [], completions: {}, schedules: {}, priorities: [], goals: [],
      metrics: {}, reviews: [], notes: {}, spending: [], dates: [], intentions: [],
      prefs: { communityVisible: true, weighted: false },
      /* `rangeScore` is stubbed below, so the shape only has to be a valid
         AppState for the call to reach it. */
      __pct: pct,
    };
  },
}));

/** The real scoring rule is tested elsewhere; here it just has to be deterministic. */
vi.mock("@/lib/habits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/habits")>();
  return { ...actual, rangeScore: (s: any) => ({ pct: s.__pct, done: 0, scheduled: 0 }) };
});
vi.mock("@/lib/accomplishments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/accomplishments")>();
  return { ...actual, accomplishedBetween: () => [] };
});

const {
  clearCommunityCache, communitySnapshot, communityStandings,
} = await import("../src/lib/community");

/**
 * Warms the cache for `today` through the real path, then forbids any further
 * state load. Returns the number of loads the warming itself cost, so a test can
 * show that reading the standings adds none.
 */
async function warm(today: string, members: { id: string; pct: number | null }[]) {
  state.forbidLoads = false;
  state.loads = 0;
  state.members = members.map((m, i) => ({ id: m.id, username: `member${i}` }));
  state.pct = new Map(members.map((m) => [m.id, m.pct]));
  await communitySnapshot(members[0].id, today);
  const warming = state.loads;
  state.loads = 0;
  state.forbidLoads = true;
  return warming;
}

beforeEach(() => {
  clearCommunityCache();
  state.loads = 0;
  state.forbidLoads = false;
  state.members = [];
  state.pct = new Map();
});
afterEach(() => {
  clearCommunityCache();
  vi.useRealTimers();
});

describe("a cold or expired cache", () => {
  it("returns null rather than computing anything", () => {
    state.forbidLoads = true;
    expect(communityStandings()).toBeNull();
    expect(communityStandings("2026-09-19")).toBeNull();
    expect(state.loads).toBe(0);
  });

  it("never manufactures a rank", () => {
    state.forbidLoads = true;
    // There is no fabricated fallback: null is the only answer without a board.
    expect(communityStandings("2026-09-19")).toBeNull();
  });

  it("returns null for a date nobody has read, even when another date is warm", async () => {
    await warm("2026-09-19", [{ id: "a", pct: 80 }]);
    expect(communityStandings("2026-09-18")).toBeNull();
    expect(state.loads).toBe(0);
  });
});

describe("with a live board in the cache", () => {
  it("reports a ranked member's rank and percentage, and loads nothing", async () => {
    const warming = await warm("2026-09-19", [{ id: "a", pct: 80 }, { id: "b", pct: 40 }]);
    expect(warming).toBe(2);            // the board cost one load per member…

    const s = communityStandings("2026-09-19");
    expect(s?.byUser.get("a")).toEqual({ state: "ranked", rank: 1, pct: 80 });
    expect(s?.byUser.get("b")).toEqual({ state: "ranked", rank: 2, pct: 40 });
    expect(state.loads).toBe(0);        // …and reading it costs none.
  });

  it("reports a scored member with nothing scheduled as none, not zero", async () => {
    await warm("2026-09-19", [{ id: "a", pct: 60 }, { id: "quiet", pct: null }]);
    const s = communityStandings("2026-09-19")!;
    expect(s.byUser.get("quiet")).toEqual({ state: "none" });
    expect(s.byUser.get("a")).toMatchObject({ state: "ranked" });
    expect(state.loads).toBe(0);
  });

  it("simply omits anyone the board does not know, and never calls them hidden", async () => {
    await warm("2026-09-19", [{ id: "a", pct: 60 }]);
    const s = communityStandings("2026-09-19")!;
    expect(s.byUser.has("stranger")).toBe(false);
    /* The type has no "hidden" state: an opted-out member is dropped inside
       scoreMember before the board exists, so absence cannot be attributed to a
       private preference. */
    expect(JSON.stringify([...s.byUser.values()])).not.toContain("hidden");
  });

  it("carries the month and a timestamp, so the screen can say what it shows", async () => {
    await warm("2026-09-19", [{ id: "a", pct: 60 }]);
    const s = communityStandings("2026-09-19")!;
    expect(s.month).toBe("2026-09");
    expect(Number.isNaN(Date.parse(s.updatedAt))).toBe(false);
  });

  it("expires with the same 60-second window the board uses", async () => {
    await warm("2026-09-19", [{ id: "a", pct: 60 }]);
    expect(communityStandings("2026-09-19")).not.toBeNull();

    // Past the cache window. Reading must go back to null rather than serve a
    // stale board — and must still not recompute to replace it.
    vi.useFakeTimers();
    vi.advanceTimersByTime(61_000);
    expect(communityStandings("2026-09-19")).toBeNull();
    expect(communityStandings()).toBeNull();
    expect(state.loads).toBe(0);
  });

  it("reads the freshest entry when no date is given", async () => {
    /* Readers in different zones keep separate entries, and a page request
       carries no time zone — so with no argument the accessor takes the most
       recently computed board rather than insisting on the server's date.
     *
     * The clock is moved between the two, because "freshest" is only meaningful
     * when the timestamps differ. Two real readers arrive seconds apart; two
     * awaits in a test share a millisecond, and a tie is genuinely undefined —
     * which is a property of the test, not something production should paper
     * over with an invented tie-break. */
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T10:00:00Z"));
    await warm("2026-09-18", [{ id: "old", pct: 10 }]);

    vi.setSystemTime(new Date("2026-09-19T10:00:20Z"));   // 20s later, still live
    await warm("2026-09-19", [{ id: "fresh", pct: 90 }]);

    const s = communityStandings()!;
    expect(s.byUser.has("fresh")).toBe(true);
    expect(s.byUser.has("old")).toBe(false);
    expect(state.loads).toBe(0);
  });

  it("leaves the cache exactly as it found it", async () => {
    await warm("2026-09-19", [{ id: "a", pct: 60 }]);
    const before = JSON.stringify([...communityStandings("2026-09-19")!.byUser]);
    communityStandings("2026-09-19");
    communityStandings();
    communityStandings("2026-09-19");
    expect(JSON.stringify([...communityStandings("2026-09-19")!.byUser])).toBe(before);
    expect(state.loads).toBe(0);
  });

  it("does not refresh a member marked stale by somebody else's write", async () => {
    await warm("2026-09-19", [{ id: "a", pct: 60 }, { id: "b", pct: 20 }]);
    const community = await import("../src/lib/community");
    community.markMemberStale("a");      // as a habit tick would

    // A real reader would rescore "a" here; the admin accessor must not, and
    // must leave the mark in place for whoever reads the board next.
    const s = communityStandings("2026-09-19")!;
    expect(s.byUser.get("a")).toMatchObject({ state: "ranked" });
    expect(state.loads).toBe(0);
  });
});

describe("the source itself forbids computing", () => {
  it("calls no scoring, refreshing or querying function", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "src", "lib", "community.ts"), "utf8");
    const fn = src.slice(src.indexOf("export function communityStandings"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    for (const forbidden of ["computeAll", "refreshStale", "scoreMember", "loadState", "query(", "await"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
    // Synchronous, so it cannot await anything by accident.
    expect(fn.startsWith("export function")).toBe(true);
  });

  it("is read by the admin list and nothing that writes", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "..", "src");
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
      .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]))
      .filter((f) => /\.tsx?$/.test(f));
    const callers = walk(root).filter((f) => /communityStandings/.test(fs.readFileSync(f, "utf8")));
    expect(callers.map((f) => path.relative(root, f)).sort()).toEqual([
      path.join("app", "admin", "users", "page.tsx"),
      path.join("lib", "community.ts"),
    ]);
  });
});
