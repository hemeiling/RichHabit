import { describe, expect, it } from "vitest";
import {
  RANKS_ON_LEADERBOARD, displayName, monthToDate, previousMonth, wholeMonth,
} from "../src/lib/community";
import { OCCUPIES_A_SLOT } from "../src/lib/db/capacity";

/**
 * The leaderboard's two risks are privacy and drift.
 *
 * Privacy: `profiles` holds real first and last names, and `users` holds
 * emails. Neither may be published to everyone who signs in just because a
 * ranking exists.
 *
 * Drift: the window must reset on the 1st and never silently include days
 * from another month, or the "live monthly" board stops meaning what it says.
 */

describe("what a member is shown as", () => {
  it("shows the username, and only the username", () => {
    expect(displayName({ username: "healthytiger" })).toBe("healthytiger");
    expect(displayName({ username: "richhabituser01" })).toBe("richhabituser01");
  });

  /**
   * The strongest guarantee available is structural: the function takes only
   * a username, so a real name or an email cannot reach the board even if a
   * future caller passes a wider row. This test fails if that shape is ever
   * widened to accept them again.
   */
  it("cannot be handed a name or an address to fall back to", () => {
    const wider = {
      username: null,
      first_name: "Meiling", last_name: "He", email: "meiling.he@example.com",
    } as unknown as { username: string | null };
    const out = displayName(wider);
    expect(out).toBe("Member");
    expect(out).not.toContain("@");
    expect(out).not.toMatch(/meiling/i);
    expect(out).not.toMatch(/he/i);
  });

  it("degrades to a neutral label rather than an empty name", () => {
    expect(displayName({ username: null })).toBe("Member");
    expect(displayName({ username: "   " })).toBe("Member");
  });
});

/**
 * The generated names the migration assigns. They must satisfy the same rule
 * a user typing their own would face, or the account could not later rename
 * itself through the same validator.
 */
describe("generated usernames for grandfathered accounts", () => {
  const USERNAME = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
  const generated = (n: number) => `richhabituser${String(n).padStart(2, "0")}`;

  it("matches the app's own username rule", () => {
    for (const n of [1, 2, 9, 10, 99, 100]) {
      const name = generated(n);
      expect(name).toMatch(USERNAME);
      expect(name.length).toBeGreaterThanOrEqual(3);
      expect(name.length).toBeLessThanOrEqual(30);
    }
  });

  it("is derived from a counter, not from the person", () => {
    expect(generated(1)).toBe("richhabituser01");
    expect(generated(2)).toBe("richhabituser02");
  });
});

describe("the monthly window", () => {
  it("runs from the 1st to today, inclusive", () => {
    const { month, dates } = monthToDate("2026-08-21");
    expect(month).toBe("2026-08");
    expect(dates[0]).toBe("2026-08-01");
    expect(dates.at(-1)).toBe("2026-08-21");
    expect(dates).toHaveLength(21);
  });

  /** On the 1st the board is a fresh, single-day month — not last month's. */
  it("starts over on the first of the month", () => {
    const { month, dates } = monthToDate("2026-09-01");
    expect(month).toBe("2026-09");
    expect(dates).toEqual(["2026-09-01"]);
  });

  it("closes a finished month over all of its days", () => {
    expect(wholeMonth("2026-08").dates).toHaveLength(31);
    expect(wholeMonth("2026-09").dates).toHaveLength(30);
    expect(wholeMonth("2026-02").dates).toHaveLength(28);
    expect(wholeMonth("2028-02").dates).toHaveLength(29);
  });

  it("steps back across a year boundary", () => {
    expect(previousMonth("2026-09")).toBe("2026-08");
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});

/**
 * Two rules that look similar and must not merge.
 *
 * "Does this account use one of the fifty early-access places" and "is this a
 * person building habits" are different questions. An admin is staff, so it
 * answers no to the first — but an admin with habits answers yes to the
 * second, and conflating them turns a permissions role into an exclusion from
 * your own progress.
 */
describe("ranking eligibility is not capacity eligibility", () => {
  it("keeps admins out of the fifty early-access places", () => {
    expect(OCCUPIES_A_SLOT).toMatch(/role\s*<>\s*'admin'/);
  });

  it("does not exclude admins from the leaderboard", () => {
    expect(RANKS_ON_LEADERBOARD).not.toMatch(/admin/);
  });

  it("still excludes accounts that cannot sign in", () => {
    expect(RANKS_ON_LEADERBOARD).toMatch(/disabled_at is null/);
  });
});
