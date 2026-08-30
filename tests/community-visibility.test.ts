import { describe, expect, it } from "vitest";
import { parsePrefs } from "../src/lib/validate";
import { emptyState } from "../src/lib/types";
import { LOCALES, dict } from "../src/lib/i18n";
import { en, zh } from "../src/lib/i18n";
import fs from "node:fs";

/**
 * §19/§20. Opting out of the Community board.
 *
 * The behaviour that matters is that it is decided on the server: a member who
 * has opted out must be absent from the snapshot the browser receives, not
 * merely hidden by it. That is `scoreMember` returning null, which is checked
 * here by reading the source — the alternative would be a database and eleven
 * accounts to reproduce a one-line rule.
 */
describe("the preference itself", () => {
  const base = { theme: "light", weighted: true, goalWeight: null, locale: "en" };

  it("is on by default, so nobody is hidden by an upgrade", () => {
    expect(emptyState().prefs.communityVisible).toBe(true);
    expect(parsePrefs(base).communityVisible).toBe(true);
  });

  it("is only off when explicitly turned off", () => {
    expect(parsePrefs({ ...base, communityVisible: false }).communityVisible).toBe(false);
    expect(parsePrefs({ ...base, communityVisible: true }).communityVisible).toBe(true);
    // A client that has never heard of the setting must not hide anyone.
    expect(parsePrefs({ ...base, communityVisible: undefined }).communityVisible).toBe(true);
    expect(parsePrefs({ ...base, communityVisible: "no" }).communityVisible).toBe(true);
  });

  it("does not disturb the other preferences", () => {
    const p = parsePrefs({ ...base, weighted: false, locale: "zh", communityVisible: false });
    expect(p).toEqual({ theme: "light", weighted: false, goalWeight: null, locale: "zh", communityVisible: false });
  });
});

describe("where it is enforced", () => {
  const community = fs.readFileSync("src/lib/community.ts", "utf8");

  it("drops an opted-out member inside scoreMember, before a snapshot exists", () => {
    const fn = community.slice(community.indexOf("async function scoreMember"));
    expect(fn).toMatch(/communityVisible === false\)\s*return null/);
  });

  it("goes through the one function both board paths use", () => {
    // computeAll (the whole board) and refreshStale (one member) must both
    // reach the rule, or a stale refresh could put a hidden member back.
    expect(community).toMatch(/scoreMember\(/g);
    expect((community.match(/await scoreMember\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("reads the preference from state rather than a second query", () => {
    // loadState uses `select *`, so an un-migrated database yields visible —
    // the code can ship ahead of its migration without hiding anybody.
    expect(fs.readFileSync("src/lib/db/queries.ts", "utf8"))
      .toMatch(/community_visible !== false/);
  });

  it("invalidates the cached board when the preference changes", () => {
    const route = fs.readFileSync("src/app/api/prefs/route.ts", "utf8");
    expect(route).toMatch(/markMemberStale\(userId\)/);
  });

  it("adds the column additively, defaulting to visible", () => {
    expect(fs.readFileSync("scripts/migrate.mjs", "utf8"))
      .toMatch(/community_visible boolean not null default true/);
    expect(fs.readFileSync("db/schema.sql", "utf8"))
      .toMatch(/community_visible boolean not null default true/);
  });
});

describe("wording", () => {
  it("names both views and the control in every language", () => {
    for (const locale of LOCALES) {
      const t = dict(locale);
      expect(t.progress.mine).toBeTruthy();
      expect(t.progress.community).toBeTruthy();
      expect(t.progress.showMe).toBeTruthy();
      expect(t.progress.hidden).toBeTruthy();
      expect(t.progress.monthToDate).toBeTruthy();
      expect(t.progress.todayIs(63)).toContain("63");
    }
  });

  it("says what the hint promises: nothing of their own changes", () => {
    expect(en.progress.showMeHint).toMatch(/own habits, history and progress are unaffected/i);
    expect(zh.progress.showMeHint).toMatch(/不受影响/);
  });

  /* Three percentages sit within a screen of each other; each must say which
     span it covers, or they read as a contradiction. */
  it("distinguishes today from the month, in both languages", () => {
    expect(en.progress.explain).toMatch(/month/i);
    expect(en.progress.explain).toMatch(/today/i);
    expect(zh.progress.explain).toMatch(/本月/);
    expect(zh.progress.explain).toMatch(/今天|今日/);
  });
});
