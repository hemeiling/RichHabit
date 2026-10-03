/**
 * What's New — the product's release history, defined in code.
 *
 * There is deliberately no CMS, no publishing workflow and no notification
 * framework. Shipping an announcement means adding one entry below and its
 * wording to the dictionaries (`whatsNew.releases[id]` in en.ts and zh.ts), then
 * shipping the app. Every eligible person sees it as unread on their next load —
 * nothing is backfilled, and no row is written because a release exists.
 *
 * ## Seen, per person
 *
 * One timestamp per account (`user_preferences.whats_new_seen_at`): the
 * publication time of the newest release that person has actually been shown.
 * A release is unread when it was published after both that mark and the moment
 * the account was created — so somebody who joins today inherits the history
 * without being told it is news.
 *
 * The mark is a release's publication time, never the time the panel was
 * opened. Opening the panel a minute before a deploy must not quietly "see" the
 * release that deploy brings.
 *
 * ## Audience
 *
 * A release may be for some accounts only. Who is in an audience is decided on
 * the server, from the same `Actor` the entitlement module builds — never from
 * anything the browser says — and the browser receives only the ids it may
 * show. Admins see every release so the whole experience can be reviewed, with
 * the audience named on the ones they would not otherwise get.
 *
 * Nothing here, and nothing this feature stores or records, contains anything a
 * person wrote.
 */
import { isGrandfatheredPro, type Actor } from "@/lib/entitlements";

export type ReleaseIcon = "calendar" | "crown" | "sparkle";

/** An audience narrower than everyone. The rule lives in `inAudience`. */
export type ReleaseAudience = "grandfatheredPro";

export interface Release {
  /** Stable for ever: it is what analytics and the seen mark refer to. */
  id: ReleaseId;
  /** When it reached people, as an ISO instant. Strictly newer than the next entry. */
  publishedAt: string;
  icon: ReleaseIcon;
  /** Where its call to action goes. Absent means no call to action. */
  href?: string;
  /** Absent means everyone. */
  audience?: ReleaseAudience;
}

/**
 * Newest first. Ids are kebab-case and never reused; times strictly decrease.
 * tests/whats-new.test.ts enforces both, and that every id has wording in both
 * languages.
 */
export const RELEASES = [
  {
    id: "life-calendar",
    publishedAt: "2026-10-03T20:00:00Z",
    icon: "calendar",
    // The Important Dates panel on Priority Compass, by its existing heading.
    href: "/priorities#important-dates-title",
  },
  {
    id: "richhabit-pro",
    publishedAt: "2026-09-20T05:00:00Z",
    icon: "crown",
    // Says "you have Grandfathered Pro". Only true for the people who do.
    audience: "grandfatheredPro",
  },
  {
    id: "ai-refresh",
    publishedAt: "2026-09-19T12:00:00Z",
    icon: "sparkle",
  },
] as const satisfies readonly (Omit<Release, "id"> & { id: string })[];

export type ReleaseId = (typeof RELEASES)[number]["id"];

const BY_ID = new Map<string, Release>(RELEASES.map((r) => [r.id, r as Release]));
export const releaseById = (id: string): Release | undefined => BY_ID.get(id);
export const isReleaseId = (v: unknown): v is ReleaseId => typeof v === "string" && BY_ID.has(v);

/** Whether an account belongs to an audience. The only place this is decided. */
export function inAudience(audience: ReleaseAudience, actor: Actor): boolean {
  switch (audience) {
    case "grandfatheredPro": return isGrandfatheredPro(actor);
  }
}

/** A release this account may be shown, and whether only as an admin's preview. */
export interface VisibleRelease {
  id: ReleaseId;
  /** Shown because the reader is an admin, not because they are in its audience. */
  preview: boolean;
}

/**
 * The releases this account may see, newest first.
 *
 * Everyone gets the releases with no audience. An audience release goes to its
 * members — and to admins, marked as a preview, so they can read every
 * announcement as it will appear. Nobody else ever receives its id, so a Free
 * account cannot be told it was upgraded.
 */
export function visibleReleases(actor: Actor, releases: readonly Release[] = RELEASES): VisibleRelease[] {
  const out: VisibleRelease[] = [];
  for (const r of releases) {
    if (!r.audience) out.push({ id: r.id, preview: false });
    else if (inAudience(r.audience, actor)) out.push({ id: r.id, preview: false });
    else if (actor.isAdmin) out.push({ id: r.id, preview: true });
  }
  return out;
}

/**
 * Where "unread" starts for this account: the later of the seen mark and the
 * moment the account was created. A release published before either is history.
 */
export function unreadSince(seenAt: string | null, accountCreatedAt: string | null): number {
  const seen = seenAt ? Date.parse(seenAt) : -Infinity;
  const created = accountCreatedAt ? Date.parse(accountCreatedAt) : -Infinity;
  return Math.max(seen, created);
}

/** The visible releases published after this account's starting point. */
export function unreadReleases(
  visible: readonly { id: string }[], seenAt: string | null, accountCreatedAt: string | null,
  releases: readonly Release[] = RELEASES,
): string[] {
  const since = unreadSince(seenAt, accountCreatedAt);
  const byId = new Map(releases.map((r) => [r.id as string, r]));
  return visible
    .map((v) => byId.get(v.id))
    .filter((r): r is Release => !!r && Date.parse(r.publishedAt) > since)
    .map((r) => r.id);
}

/**
 * The release whose publication time becomes the seen mark when a panel showing
 * `shown` is opened: the newest one actually on screen. Null when nothing was.
 */
export function newestShown(shown: readonly string[]): Release | null {
  let newest: Release | null = null;
  for (const id of shown) {
    const r = releaseById(id);
    if (r && (!newest || Date.parse(r.publishedAt) > Date.parse(newest.publishedAt))) newest = r;
  }
  return newest;
}
