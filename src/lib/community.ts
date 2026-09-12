import { query } from "@/lib/db/pool";
import { loadState } from "@/lib/db/queries";
import { rangeScore } from "@/lib/habits";
import { accomplishedBetween } from "@/lib/accomplishments";
import { iso, todayISO } from "@/lib/dates";
import type { AppState } from "@/lib/types";

/**
 * Community Progress — a month-to-date completion figure for every active
 * member, ranked.
 *
 * ## Why this loads each user's state instead of running one SQL query
 *
 * The app already has a definition of "how much of my habits did I do", in
 * `rangeScore()` / `dayScore()` / `isScheduled()`. Rewriting it in SQL would
 * produce a second definition that could disagree with the number a user
 * sees on their own screens, and a leaderboard that contradicts your own
 * analytics is worse than no leaderboard. Three things make the existing
 * rule genuinely not expressible as a simple ratio:
 *
 *   1. A `times`-per-week habit stays scheduled until that week's target is
 *      met, so whether it counts on a Thursday depends on what was completed
 *      Monday to Wednesday. It has to be walked day by day.
 *   2. Days with nothing scheduled are skipped, not counted as zero.
 *   3. Scoring is weight-aware.
 *
 * So this calls the same functions the interface calls. It costs one state
 * load per member, which is fine at the tens-of-users scale this is for and
 * is cached below; past a few hundred members it should become a nightly
 * materialised figure rather than a bigger query.
 *
 * ## Weighting
 *
 * Deliberately computed UNWEIGHTED for everyone. `weighted_score` is a
 * per-user preference, so honouring it would rank people by rules that
 * differ between them — two users with identical behaviour could place
 * differently because one prefers weighting. An unweighted percentage is one
 * yardstick applied to everybody. It can therefore differ slightly from the
 * weighted figure a user sees elsewhere in their own analytics, and the
 * screen says so rather than leaving them to notice.
 */

export interface CommunityEntry {
  rank: number;
  /** A username, a display name, or an initialled form. Never an email. */
  name: string;
  pct: number;
  /**
   * Priorities completed in the same window. A count and nothing else: no
   * titles, dates, quadrants or notes leave the server. Descriptive only — it
   * never enters the ranking, which stays on `pct`.
   */
  accomplishments: number;
  isMe: boolean;
}

export interface CommunitySnapshot {
  /** 'YYYY-MM' — the window everyone is measured over. */
  month: string;
  updatedAt: string;
  activeUsers: number;
  top: CommunityEntry[];
  /** Null when the signed-in user has nothing scheduled this month. */
  me: { rank: number; pct: number; name: string; accomplishments: number } | null;
}

/**
 * Who appears on the board, as its own named rule rather than a condition
 * buried in a query.
 *
 * Deliberately NOT the same rule as `OCCUPIES_A_SLOT` in db/capacity.ts, and
 * the difference is the point. That one answers "does this account consume one
 * of the fifty early-access places", and exempts admins because an admin is
 * staff rather than a member. This one answers "is this a person building
 * habits", and an admin building habits is exactly that.
 *
 * Conflating the two is how a role meant to grant permissions quietly becomes
 * a role that removes you from your own progress. A disabled account is still
 * excluded: it cannot sign in, so it is not participating in anything.
 *
 * Someone with nothing scheduled this month is filtered later, on their score
 * rather than on their row — no schedule means no percentage, which is not the
 * same as zero effort.
 */
export const RANKS_ON_LEADERBOARD = "u.disabled_at is null";

const TOP_N = 10;
/*
 * A minute of staleness is invisible when it is someone *else's* score moving,
 * and it saves recomputing every member for each visitor. It is not invisible
 * when it is your own: tick a habit, look at the board, and a number that has
 * not moved reads as a broken feature rather than a cached one.
 *
 * So the two cases are separated. This is the backstop that eventually picks
 * up other people's progress; your own is refreshed on demand — see
 * `markMemberStale`, which is why ticking a habit shows up immediately without
 * recomputing anybody else.
 */
const CACHE_MS = 60_000;

/** Every date from the 1st of the current month up to today, inclusive. */
export function monthToDate(today = todayISO()): { month: string; dates: string[] } {
  const d = new Date(`${today}T00:00:00`);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const dates: string[] = [];
  for (let day = 1; day <= d.getDate(); day++) {
    dates.push(iso(new Date(d.getFullYear(), d.getMonth(), day)));
  }
  return { month, dates };
}

/**
 * The reader's own calendar date, from the IANA time zone their browser sends.
 *
 * The server runs in UTC. Measuring "this month" by the server's clock meant
 * that on the evening of September 30 in California the board had already
 * moved to October — while the reader's own progress, computed on their device,
 * was still on September. Every figure a person sees about their month should
 * use the same calendar, so the board now takes the reader's.
 *
 * The header is untrusted input, but all it can choose is which of the dates
 * currently in effect somewhere on Earth to use — at most a day either side of
 * UTC — and each member's score is still computed from their own records. An
 * unknown or missing zone falls back to the server's date, which is what the
 * board used before.
 *
 * `now` is a parameter so the month boundary can be tested without a clock.
 */
export function viewerToday(timeZone: string | null | undefined, now = new Date()): string {
  if (timeZone && timeZone.length <= 64) {
    try {
      /* en-CA formats as YYYY-MM-DD. Parts rather than the string, so no locale
         data quirk can change the separator. */
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(now);
      const get = (type: string) => parts.find((p) => p.type === type)?.value;
      const date = `${get("year")}-${get("month")}-${get("day")}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    } catch {
      // An unrecognised zone name. Fall through to the server's date.
    }
  }
  return iso(now);
}

/** Every date in a whole calendar month — used to close a finished month. */
export function wholeMonth(month: string): { month: string; dates: string[] } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const dates: string[] = [];
  for (let day = 1; day <= last; day++) dates.push(iso(new Date(y, m - 1, day)));
  return { month, dates };
}

/** The 'YYYY-MM' before the given one. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The board shows the username and nothing else.
 *
 * `profiles` holds real first and last names and `users` holds emails, and
 * neither is a thing to publish to everyone who signs in merely because a
 * ranking exists. So no fallback here reads them: accounts that predate
 * usernames are given a generated one (`richhabituser01`) by the backfill in
 * scripts/migrate.mjs, which is derived from nothing about the person.
 *
 * The neutral label below is only for the gap between an account being made
 * and the backfill reaching it. It is deliberately not derived from a name or
 * an address, so the worst case is anonymity rather than exposure.
 */
export function displayName(u: { username: string | null }): string {
  return u.username?.trim() || "Member";
}

interface Row {
  id: string; username: string | null; created_at: string;
}

type Scored = CommunityEntry & { id: string; createdAt: string };

type Cached = Omit<CommunitySnapshot, "me" | "top"> & { all: Scored[] };

/*
 * One cached board per reader date.
 *
 * Readers in different time zones can be on different days — near a month's
 * end, in different months — and each must be measured over their own window.
 * At any instant only two or three dates are current somewhere, so this holds a
 * handful of entries, and expired ones are dropped whenever the board is read.
 *
 * Each entry keeps its own set of members whose score is known to be out of
 * date, to be recomputed the next time anybody reads that board.
 *
 * Marking is deliberately not recomputing. Ticking a habit is the hottest
 * write in the app, and making it wait on a state load and a re-sort would
 * charge every completion for a screen the user may not be looking at. Adding
 * an id to a set costs nothing, and someone working down a list of ten habits
 * pays for one recompute on their next look rather than ten.
 */
interface CacheEntry { at: number; snapshot: Cached; dates: string[]; stale: Set<string> }
const cache = new Map<string, CacheEntry>();

/**
 * Says that a member's score has changed. Cheap enough to call from any write
 * that could move a number — a habit tick, a completed or deleted priority, a
 * visibility change: it touches no database.
 */
export function markMemberStale(userId: string) {
  for (const entry of cache.values()) entry.stale.add(userId);
}

/**
 * Brings the marked members up to date in place, leaving everyone else alone.
 *
 * The board is re-ranked afterwards because one person's score moving can
 * change other people's places — you passing someone moves them down, and a
 * board where your rank improved but theirs did not is incoherent. Re-ranking
 * is a sort of a few dozen rows; it is the state loads that cost, and there is
 * exactly one of those per marked member.
 */
async function refreshStale(entry: CacheEntry) {
  const { snapshot, dates, stale } = entry;
  if (stale.size === 0) return snapshot;

  const ids = [...stale];
  stale.clear();

  const rows = await query<Row>(
    `select u.id, u.username, u.created_at
       from users u
      where ${RANKS_ON_LEADERBOARD} and u.id = any($1::uuid[])`, [ids]);

  // The same window the board was built over, not the server's own month.
  const byId = new Map(snapshot.all.map((e) => [e.id, e]));

  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    // Gone, or no longer eligible: drop them rather than leave a stale row.
    if (!row) { byId.delete(id); continue; }
    const entry = await scoreMember(row, dates);
    // Null means nothing is scheduled for them this month any more, which is
    // not a zero — so they leave the board rather than sink to the bottom.
    if (entry) byId.set(id, entry); else byId.delete(id);
  }

  return { ...snapshot, updatedAt: new Date().toISOString(), ...ranked([...byId.values()]) };
}

async function computeAll(window = monthToDate()) {
  const { month, dates } = window;

  /* Only the id, the public name and the account age are read. `profiles` is
     not joined at all, so a real name cannot reach this code path even by
     accident. */
  const users = await query<Row>(
    `select u.id, u.username, u.created_at
       from users u
      where ${RANKS_ON_LEADERBOARD}`,
  );

  const scored: Scored[] = [];
  for (const u of users) {
    const entry = await scoreMember(u, dates);
    // A null percentage means nothing was ever scheduled this month. That is
    // not zero effort, so they are not ranked as though it were. It is not the
    // same as a failure — that throws.
    if (entry) scored.push(entry);
  }

  return {
    month,
    updatedAt: new Date().toISOString(),
    ...ranked(scored),
  };
}

/**
 * One member's figure, by the same route the rest of the app takes.
 *
 * Pulled out of the loop so that refreshing one person costs one state load
 * rather than everybody's — and so there is only one definition of the number,
 * whether it is computed for the whole board or for you alone. Two code paths
 * here would be two answers to "what is my completeness".
 */
async function scoreMember(u: Row, dates: string[]): Promise<Scored | null> {
  /*
   * A failure to read a member is deliberately NOT caught here.
   *
   * It used to be — `catch { continue; }`, so that one odd account could not
   * take the whole board down. What that actually bought was the opposite: when
   * a migration had not been applied and every `loadState` threw, all eleven
   * members were skipped and the board rendered a calm, confident
   * "0 · Active users". A total outage presented as a valid empty leaderboard,
   * and it stayed that way until somebody thought to check the database.
   *
   * A ranking that silently omits people is worse than one that admits it is
   * broken, so this throws and /api/community answers 500. The page already
   * knows how to say it is unavailable, and the rail panel already renders
   * nothing rather than a wrong number.
   */
  const state: AppState = await loadState(u.id);

  /*
   * §19/§20. Opting out, enforced here rather than in the query that lists
   * members — which is deliberate for three reasons.
   *
   * It is one place. Both paths into the board come through this function: the
   * full recompute and the refresh of a single stale member. A `where` clause
   * would have to be repeated in two queries that could then disagree, and
   * `refreshStale` already knows what to do with a null — it removes them.
   *
   * It is server-side, which is the requirement. Nothing about the decision
   * reaches the browser: an opted-out member is gone before a snapshot exists,
   * so their username, percentage and rank are not merely hidden by the client,
   * they were never sent to it, and they are absent from `activeUsers` because
   * that is counted from the ranked list.
   *
   * And it survives the column not being there yet. `loadState` reads
   * preferences with `select *`, so an un-migrated database yields `true` here
   * and the board behaves exactly as it did before the setting existed.
   *
   * Their own data is untouched by any of this — the state was just read in
   * full, and it is only this ranking that they leave.
   */
  if (state.prefs.communityVisible === false) return null;

  // The same scoring the app uses, with weighting forced off so every member
  // is measured the same way.
  const unweighted: AppState = { ...state, prefs: { ...state.prefs, weighted: false } };
  const score = rangeScore(unweighted, dates);
  if (score.pct === null) return null;
  /* Counted by the same rule Insights and My Progress use, over the same days.
     Only the number is kept; the priorities themselves go no further. */
  const accomplishments = dates.length
    ? accomplishedBetween(state.priorities, dates[0], dates[dates.length - 1]).length
    : 0;
  return {
    id: u.id, rank: 0, name: displayName(u), pct: score.pct, accomplishments,
    isMe: false, createdAt: String(u.created_at),
  };
}

/**
 * Places, and the count that goes with them.
 *
 * Ties broken by account age, oldest first. Any deterministic rule would do;
 * the point is that a refresh must not reshuffle equal scores — including a
 * refresh caused by one member's score being recomputed on its own.
 *
 * Accomplishments play no part, not even as a tiebreak. Ranking by them would
 * reward splitting work into many small priorities.
 */
function ranked(scored: Scored[]) {
  const all = [...scored].sort(
    (a, b) => b.pct - a.pct || a.createdAt.localeCompare(b.createdAt));
  all.forEach((e, i) => { e.rank = i + 1; });
  return { activeUsers: all.length, all };
}

/**
 * Writes a finished month's board once, the first time anyone looks at the
 * new one. No scheduler to run or forget, and the work happens once because
 * the insert refuses duplicates.
 *
 * `do nothing` on conflict is what makes it safe to call on every request and
 * what stops a re-run from rewriting a month that was already closed. It only
 * ever inserts; it never touches habits or completions.
 */
async function archiveMonth(month: string) {
  const already = await query<{ n: string }>(
    "select count(*)::int as n from community_month_scores where month = $1", [month]);
  if (Number(already[0]?.n ?? 0) > 0) return;

  const finished = await computeAll(wholeMonth(month));
  for (const e of finished.all) {
    await query(
      `insert into community_month_scores (month, user_id, rank, pct, name)
       values ($1,$2,$3,$4,$5) on conflict (month, user_id) do nothing`,
      [month, e.id, e.rank, e.pct, e.name],
    );
  }
}

/**
 * The board as one reader sees it, measured over their month to date.
 *
 * `today` is the reader's calendar date (see `viewerToday`); it defaults to the
 * server's date for callers that have no reader.
 */
export async function communitySnapshot(meId: string, today = todayISO()): Promise<CommunitySnapshot> {
  for (const [key, e] of cache) if (Date.now() - e.at > CACHE_MS) cache.delete(key);

  let entry = cache.get(today);
  if (!entry) {
    const window = monthToDate(today);
    const snapshot = await computeAll(window);
    /* A full recompute has just scored everybody, so nothing is outstanding —
       a fresh entry starts with an empty stale set, and a mark made mid-compute
       does not cause a pointless second pass over someone already counted. */
    entry = { at: Date.now(), snapshot, dates: window.dates, stale: new Set() };
    cache.set(today, entry);
    /* Closing the previous month is best-effort: a history record failing to
       write must never stop today's board from rendering. It stays on the
       server's own month, exactly as before, so no archived month is closed
       early or rewritten because a reader happens to be in another zone. */
    archiveMonth(previousMonth(monthToDate().month)).catch(() => {});
  } else if (entry.stale.size > 0) {
    // Somebody ticked something since the last look. Rescore just them.
    entry.snapshot = await refreshStale(entry);
  }
  const { month, updatedAt, activeUsers, all } = entry.snapshot;

  const mine = all.find((e) => e.id === meId) || null;
  /* Exactly the public fields, listed rather than spread, so nothing added to
     the internal row for sorting (an id, an account's creation time) can leak. */
  const top = all.slice(0, TOP_N).map((e) => ({
    rank: e.rank, name: e.name, pct: e.pct, accomplishments: e.accomplishments, isMe: e.id === meId,
  }));

  return {
    month, updatedAt, activeUsers, top,
    me: mine
      ? { rank: mine.rank, pct: mine.pct, name: mine.name, accomplishments: mine.accomplishments }
      : null,
  };
}

/** Exposed for tests; also lets an admin action drop a stale snapshot. */
export function clearCommunityCache() { cache.clear(); }
