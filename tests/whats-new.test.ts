import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RELEASES, inAudience, isReleaseId, newestShown, releaseById, unreadReleases, unreadSince,
  visibleReleases, type Release,
} from "../src/lib/releases";
import { isGrandfatheredPro, type Actor } from "../src/lib/entitlements";
import { FEATURES, FEATURE_OF_EVENT } from "../src/lib/analytics/config";
import { LOCALES, dict } from "../src/lib/i18n";
import { emptyState } from "../src/lib/types";

/**
 * What's New — the registry, the audiences and "unread", all pure.
 *
 * The rules that matter most: a Free account is never sent the Grandfathered Pro
 * announcement; an admin sees everything, marked; a release older than the
 * account is history, not news; and a future release becomes unread for
 * everyone eligible without anybody's row being touched.
 */

const actor = (over: Partial<Actor> = {}): Actor =>
  ({ userId: "u", plan: "free", source: null, isAdmin: false, ...over });
const FREE = actor();
const GRANDFATHERED = actor({ plan: "pro", source: "grandfathered" });
const PURCHASED = actor({ plan: "pro", source: "purchased" });
/* getActor resolves an expired grant to plan "free" but keeps its source. */
const EXPIRED = actor({ plan: "free", source: "grandfathered" });
const ADMIN = actor({ isAdmin: true });
const ids = (a: Actor) => visibleReleases(a).map((r) => r.id);

describe("the release registry", () => {
  it("has unique, stable, kebab-case ids", () => {
    const all = RELEASES.map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("is newest first, with strictly decreasing publication times", () => {
    for (let i = 1; i < RELEASES.length; i++) {
      expect(Date.parse(RELEASES[i - 1].publishedAt), RELEASES[i].id)
        .toBeGreaterThan(Date.parse(RELEASES[i].publishedAt));
    }
    for (const r of RELEASES) expect(Number.isNaN(Date.parse(r.publishedAt)), r.id).toBe(false);
  });

  it("has wording for every release in both languages, and a call to action exactly where there is a link", () => {
    for (const r of RELEASES as readonly Release[]) {
      for (const locale of ["en", "zh"] as const) {
        const copy = dict(locale).whatsNew.releases[r.id] as { title: string; body: string; cta?: string };
        expect(copy?.title, `${locale}/${r.id}`).toBeTruthy();
        expect(copy?.body, `${locale}/${r.id}`).toBeTruthy();
        expect(Boolean(copy.cta), `${locale}/${r.id} cta`).toBe(Boolean(r.href));
      }
    }
  });

  it("links only to screens that exist", () => {
    for (const r of RELEASES as readonly Release[]) {
      if (!r.href) continue;
      const route = r.href.split("#")[0].replace(/^\//, "");
      expect(fs.existsSync(path.resolve(__dirname, "..", "src", "app", "(app)", route, "page.tsx")), r.href).toBe(true);
    }
  });

  it("points the calendar's link at the Important Dates heading that exists today", () => {
    const life = releaseById("life-calendar")!;
    expect(life.href).toBe("/priorities#important-dates-title");
    const component = fs.readFileSync(path.resolve(__dirname, "..", "src", "components", "ImportantDates.tsx"), "utf8");
    expect(component).toContain('id="important-dates-title"');
  });

  it("knows its own ids and nothing else", () => {
    expect(isReleaseId("life-calendar")).toBe(true);
    for (const v of ["", "life_calendar", "LIFE-CALENDAR", 4, null, "__proto__"]) expect(isReleaseId(v)).toBe(false);
  });

  it("names no model, provider or version in what people read", () => {
    for (const locale of ["en", "zh"] as const) {
      const text = JSON.stringify(dict(locale).whatsNew.releases);
      expect(text).not.toMatch(/claude|anthropic|openai|gpt|gemini|sonnet|opus|model|v\d/i);
    }
  });
});

describe("audiences", () => {
  it("defines Grandfathered Pro once, in the entitlement module", () => {
    expect(isGrandfatheredPro(GRANDFATHERED)).toBe(true);
    for (const a of [FREE, PURCHASED, EXPIRED, ADMIN]) expect(isGrandfatheredPro(a)).toBe(false);
    expect(inAudience("grandfatheredPro", GRANDFATHERED)).toBe(true);
    expect(inAudience("grandfatheredPro", FREE)).toBe(false);
  });

  it("never sends the Pro announcement to a Free, purchased-Pro or expired account", () => {
    for (const a of [FREE, PURCHASED, EXPIRED]) {
      expect(ids(a)).not.toContain("richhabit-pro");
      expect(ids(a)).toEqual(["life-calendar", "ai-refresh"]);
    }
  });

  it("sends it to Grandfathered Pro, as their own", () => {
    expect(visibleReleases(GRANDFATHERED)).toEqual([
      { id: "life-calendar", preview: false },
      { id: "richhabit-pro", preview: false },
      { id: "ai-refresh", preview: false },
    ]);
  });

  it("shows an admin every release, marking the ones outside their own audience", () => {
    expect(visibleReleases(ADMIN)).toEqual([
      { id: "life-calendar", preview: false },
      { id: "richhabit-pro", preview: true },
      { id: "ai-refresh", preview: false },
    ]);
  });

  it("names the audience on an admin's preview, in every language", () => {
    for (const locale of LOCALES) {
      expect(dict(locale).whatsNew.shownTo.grandfatheredPro).toBeTruthy();
    }
    expect(dict("en").whatsNew.shownTo.grandfatheredPro).toBe("Shown to Grandfathered Pro members");
  });
});

describe("unread", () => {
  const visible = visibleReleases(GRANDFATHERED);
  const EARLY = "2026-08-01T00:00:00Z";

  it("is everything published after an existing account joined, until it opens the panel", () => {
    expect(unreadReleases(visible, null, EARLY)).toEqual(["life-calendar", "richhabit-pro", "ai-refresh"]);
  });

  it("never counts what was published before the account existed", () => {
    // Joined between the AI refresh and the calendar: only the calendar is news.
    expect(unreadReleases(visible, null, "2026-09-25T00:00:00Z")).toEqual(["life-calendar"]);
    // Joined after all three: history, nothing unread.
    expect(unreadReleases(visible, null, "2026-10-05T00:00:00Z")).toEqual([]);
  });

  it("clears up to the newest release shown, and no further", () => {
    expect(unreadReleases(visible, "2026-10-03T20:00:00Z", EARLY)).toEqual([]);
    expect(unreadReleases(visible, "2026-09-20T05:00:00Z", EARLY)).toEqual(["life-calendar"]);
  });

  it("makes a future release unread for everyone eligible, with nothing stored for it", () => {
    const next: Release = { id: "release-four" as Release["id"], publishedAt: "2026-11-01T12:00:00Z", icon: "sparkle" };
    const withFour = [next, ...(RELEASES as readonly Release[])];
    const seenAll = "2026-10-03T20:00:00Z";
    for (const a of [FREE, GRANDFATHERED, ADMIN]) {
      const v = visibleReleases(a, withFour);
      expect(unreadReleases(v, seenAll, EARLY, withFour), JSON.stringify(a)).toEqual(["release-four"]);
    }
    // …but not for an account created after it.
    expect(unreadReleases(visibleReleases(FREE, withFour), null, "2026-11-02T00:00:00Z", withFour)).toEqual([]);
  });

  it("starts from the later of the mark and the account's creation", () => {
    expect(unreadSince(null, null)).toBe(-Infinity);
    expect(unreadSince("2026-09-20T00:00:00Z", "2026-10-01T00:00:00Z")).toBe(Date.parse("2026-10-01T00:00:00Z"));
    expect(unreadSince("2026-10-02T00:00:00Z", "2026-09-01T00:00:00Z")).toBe(Date.parse("2026-10-02T00:00:00Z"));
  });

  it("marks with the newest release actually shown — never one that was not", () => {
    expect(newestShown(["ai-refresh", "life-calendar"])?.id).toBe("life-calendar");
    expect(newestShown(["ai-refresh"])?.id).toBe("ai-refresh");
    expect(newestShown([])).toBeNull();
    expect(newestShown(["not-a-release"])).toBeNull();
  });

  it("shows nothing as unread before the account has loaded", () => {
    const s = emptyState().whatsNew;
    expect(unreadReleases(s.releases, s.seenAt, s.accountCreatedAt)).toEqual([]);
  });
});

describe("analytics and wording", () => {
  it("registers the two events, which belong to What's New", () => {
    expect(FEATURES.whatsNew.events).toEqual(["whats_new_opened", "whats_new_cta_clicked"]);
    expect(FEATURE_OF_EVENT.whats_new_opened).toBe("whatsNew");
    expect(FEATURE_OF_EVENT.whats_new_cta_clicked).toBe("whatsNew");
  });

  it("has every label in every language", () => {
    for (const locale of LOCALES) {
      const t = dict(locale);
      for (const k of ["title", "open", "openUnread", "newTag", "notDeployed"] as const) {
        expect(t.whatsNew[k], `${locale}/${k}`).toBeTruthy();
      }
      expect(t.language.label).toBeTruthy();
    }
    expect([dict("en").whatsNew.title, dict("zh").whatsNew.title]).toEqual(["What's New", "最近更新"]);
    expect([dict("en").language.label, dict("zh").language.label]).toEqual(["Language", "语言"]);
  });

  it("only tells Grandfathered Pro members they have it", () => {
    expect(dict("en").whatsNew.releases["richhabit-pro"].body).toMatch(/you have Grandfathered Pro/);
    expect(releaseById("richhabit-pro")!.audience).toBe("grandfatheredPro");
  });
});

describe("the header", () => {
  const shell = fs.readFileSync(path.resolve(__dirname, "..", "src", "components", "AppShell.tsx"), "utf8");

  it("uses the new controls in the signed-in header, and leaves the signed-out pages alone", () => {
    expect(shell).toContain("<WhatsNew />");
    expect(shell).toContain("<LanguageMenu />");
    expect(shell).not.toContain("LanguageToggle");
    for (const page of ["Landing.tsx", "terms/TermsContent.tsx", "verify/VerifyContent.tsx",
      "reset/ResetContent.tsx", "forgot/ForgotForm.tsx"]) {
      const src = fs.readFileSync(path.resolve(__dirname, "..", "src", "app", page), "utf8");
      expect(src, page).toContain("<LanguageToggle />");
    }
  });
});
