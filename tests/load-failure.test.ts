import { describe, expect, it, vi, beforeEach } from "vitest";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";
import { both } from "../src/lib/i18n/both";

/**
 * A failed load must never look like an empty account.
 *
 * This is a regression test for a real outage: a schema migration had not been
 * applied, every `loadState()` threw, and the interface rendered 0/0 habits,
 * "Nothing scheduled" and "0 · Active users" — a confident, plausible, entirely
 * wrong picture of a healthy account with 17 habits. Nobody could tell from the
 * screen that anything was wrong.
 *
 * The rule that came out of it: absence of data and inability to read data are
 * different states and must never render the same.
 */

describe("the leaderboard does not swallow failures", () => {
  beforeEach(() => vi.resetModules());

  /*
   * The specific line that caused the outage was `catch { continue; }` around
   * the per-member state load. With every member failing it produced an empty
   * board rather than an error, so this asserts the failure propagates.
   */
  it("propagates a read failure instead of reporting zero members", async () => {
    vi.doMock("../src/lib/db/pool", () => ({
      query: vi.fn(async () => ([
        { id: "u1", username: "hippo", created_at: "2026-08-01" },
        { id: "u2", username: "someone", created_at: "2026-08-02" },
      ])),
    }));
    vi.doMock("../src/lib/db/queries", () => ({
      loadState: vi.fn(async () => { throw new Error('relation "priorities" does not exist'); }),
    }));

    const { communitySnapshot, clearCommunityCache } = await import("../src/lib/community");
    clearCommunityCache();

    await expect(communitySnapshot("u1")).rejects.toThrow(/priorities/);
  });

  it("still builds a board when members simply have nothing scheduled", async () => {
    vi.doMock("../src/lib/db/pool", () => ({
      query: vi.fn(async () => ([{ id: "u1", username: "hippo", created_at: "2026-08-01" }])),
    }));
    // Loads fine, just has no habits — an empty account, not a broken one.
    vi.doMock("../src/lib/db/queries", () => ({
      loadState: vi.fn(async () => {
        const { emptyState } = await import("../src/lib/types");
        return emptyState();
      }),
    }));

    const { communitySnapshot, clearCommunityCache } = await import("../src/lib/community");
    clearCommunityCache();

    const snap = await communitySnapshot("u1");
    expect(snap.activeUsers).toBe(0);
    expect(snap.me).toBe(null);
  });
});

describe("what the interface says when it cannot read the account", () => {
  it("never calls it empty, and says the data is safe", () => {
    for (const d of [en, zh]) {
      expect(d.errors.loadFailedTitle.length).toBeGreaterThan(0);
      expect(d.errors.loadFailedBody.length).toBeGreaterThan(0);
      expect(d.errors.loadFailedRetry.length).toBeGreaterThan(0);
    }
    // The reassurance is the point: the reader's first fear is lost data.
    expect(en.errors.loadFailedBody).toMatch(/safe/i);
    expect(zh.errors.loadFailedBody).toContain("都还在");
    // And it must not imply the account has no habits.
    expect(en.errors.loadFailedTitle).not.toMatch(/no habits|empty|nothing/i);
  });

  it("says it in both languages at once for bilingual readers", () => {
    expect(both.errors.loadFailedTitle).toMatch(/couldn't load/i);
    expect(both.errors.loadFailedTitle).toContain("无法加载");
  });
});
