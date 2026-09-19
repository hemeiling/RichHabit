import { query } from "@/lib/db/pool";
import { loadState } from "@/lib/db/queries";
import { rangeScore } from "@/lib/habits";
import { accomplishedBetween } from "@/lib/accomplishments";
import { iso, todayISO } from "@/lib/dates";
import type { AppState } from "@/lib/types";

/**
 * Community Progress — two independent month-to-date rankings.
 *
 * ## Two rankings, never one
 *
 * Habits measure consistency: how much of what you scheduled you did.
 * Accomplishments measure execution: how many priorities you finished. They are
 * different units answering different questions, so each has its own list, its
 * own rank and its own eligibility, and nothing here adds them together. Being
 * first in one and fourth in the other is an ordinary, intended result.
 *
 * Every member is read once and scored for both; the two lists are then sorted
 * separately from that one set of scores. So the rankings cannot disagree about
 * who is visible, and a member's data is loaded once per refresh, not twice.
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
 * Accomplishments follow the same reasoning: they are counted by the one rule in
 * lib/accomplishments that Insights and My Progress also use.
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
 * screen says so rather than leaving them to notice. Accomplishments are never
 * weighted either: every quadrant counts one.
 */

/** A row of the habit ranking. The shape is unchanged from before accomplishments. */
export interface CommunityEntry {
  rank: number;
  /** A username, a display name, or an initialled form. Never an email. */
  name: string;
  pct: number;
  isMe: boolean;
}

/**
 * A row of the accomplishment ranking: a count and nothing else. No title,
 * date, quadrant, plan or id of any priority is ever part of it.
 */
export interface AccomplishmentEntry {
  rank: number;
  name: string;
  count: number;
  isMe: boolean;
}

export interface AccomplishmentBoard {
  /** How many members are ranked, i.e. have at least one accomplishment. */
  members: number;
  top: AccomplishmentEntry[];
  /** Null when the reader is not ranked: nothing completed yet, or hidden. */
  me: { rank: number; count: number; name: string } | null;
  /** The reader's own count this month, ranked or not; null when hidden. */
  mine: number | null;
}

export interface CommunitySnapshot {
  /** 'YYYY-MM' — the window everyone is measured over. */
  month: string;
  updatedAt: string;
  /* The habit ranking, in the fields it has always had. */
  activeUsers: number;
  top: CommunityEntry[];
  /** Null when the signed-in user has nothing scheduled this month. */
  me: { rank: number; pct: number; name: string } | null;
  /* The accomplishment ranking, separate. */
  accomplishments: AccomplishmentBoard;
}

/**
 * Who can appear on either board, as its own named rule rather than a condition
 * buried in a query.
 *
 * Deliberately NOT the same rule as `OCCUPIES_A_SLOT` in db/capacity.ts, and
 * the difference is the point. That one answers "does this account consume one
 * of the early-access places", and exempts admins because an admin is staff
 * rather than a member. This one answers "is this a person building habits",
 * and an admin building habits is exactly that.
 *
 * Conflating the two is how a role meant to grant permissions quietly becomes
 * a role that removes you from your own progress. A disabled account is still
 * excluded: it cannot sign in, so it is not participating in anything.
 *
 * Each board then has its own eligibility on top of this, applied to the score
 * rather than the row: the habit ranking needs something scheduled this month
 * (no schedule is not zero effort), and the accomplishment ranking needs at
 * least one completed priority. Neither depends on the other, so someone with
 * no habits still appears among accomplishments.
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

/**
 * One visible member's two figures, kept apart. `pct` is null when nothing was
 * scheduled this month; `count` is zero when nothing was completed. The id and
 * account age never leave the server — they exist to refresh and to order.
 */
export interface Member {
  id: string;
  name: string;
  createdAt: string;
  pct: number | null;
  count: number;
}

type HabitRow = { id: string; rank: number; name: string; pct: number; createdAt: string };
type AccomplishmentRow = { id: string; rank: number; name: string; count: number; createdAt: string };

interface Board {
  month: string;
  updatedAt: string;
  members: Member[];
  habits: HabitRow[];
  accomplishments: AccomplishmentRow[];
}

/**
 * The habit ranking — exactly the rule it has always had.
 *
 * Only members with something scheduled; highest percentage first; ties broken
 * by account age, oldest first. Any deterministic rule would do; the point is
 * that a refresh must not reshuffle equal scores — including a refresh caused
 * by one member's score being recomputed on its own.
 */
export function rankHabits(members: Member[]): HabitRow[] {
  return members
    .filter((m) => m.pct !== null)
    .sort((a, b) => b.pct! - a.pct! || a.createdAt.localeCompare(b.createdAt))
    .map((m, i) => ({ id: m.id, rank: i + 1, name: m.name, pct: m.pct!, createdAt: m.createdAt }));
}

/**
 * The accomplishment ranking.
 *
 * Only members with at least one accomplishment; most first. Equal counts share
 * a rank ("#2, #2, #4") rather than being split by something the numbers do not
 * say — there is no fair way to decide who "won" a tie, and inventing one from
 * private priority data would be worse. Within a shared rank the listing order
 * is the board's existing stable convention, account age, so it never jitters.
 */
export function rankAccomplishments(members: Member[]): AccomplishmentRow[] {
  const sorted = members
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count || a.createdAt.localeCompare(b.createdAt));
  let rank = 0;
  return sorted.map((m, i) => {
    if (i === 0 || m.count !== sorted[i - 1].count) rank = i + 1;
    return { id: m.id, rank, name: m.name, count: m.count, createdAt: m.createdAt };
  });
}

const boardFrom = (month: string, members: Member[]): Board => ({
  month,
  updatedAt: new Date().toISOString(),
  members,
  habits: rankHabits(members),
  accomplishments: rankAccomplishments(members),
});

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
interface CacheEntry { at: number; board: Board; dates: string[]; stale: Set<string> }
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
 * Both rankings are rebuilt afterwards because one person's score moving can
 * change other people's places — you passing someone moves them down, and a
 * board where your rank improved but theirs did not is incoherent. Re-ranking
 * is a sort of a few dozen rows; it is the state loads that cost, and there is
 * exactly one of those per marked member.
 */
async function refreshStale(entry: CacheEntry): Promise<Board> {
  const { board, dates, stale } = entry;
  if (stale.size === 0) return board;

  const ids = [...stale];
  stale.clear();

  const rows = await query<Row>(
    `select u.id, u.username, u.created_at
       from users u
      where ${RANKS_ON_LEADERBOARD} and u.id = any($1::uuid[])`, [ids]);

  // The same window the board was built over, not the server's own month.
  const byId = new Map(board.members.map((m) => [m.id, m]));

  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    // Gone, or no longer eligible: drop them rather than leave a stale row.
    if (!row) { byId.delete(id); continue; }
    const member = await scoreMember(row, dates);
    // Null means they have hidden themselves, so they leave both boards.
    if (member) byId.set(id, member); else byId.delete(id);
  }

  return boardFrom(board.month, [...byId.values()]);
}

async function computeAll(window = monthToDate()): Promise<Board> {
  const { month, dates } = window;

  /* Only the id, the public name and the account age are read. `profiles` is
     not joined at all, so a real name cannot reach this code path even by
     accident. */
  const users = await query<Row>(
    `select u.id, u.username, u.created_at
       from users u
      where ${RANKS_ON_LEADERBOARD}`,
  );

  const members: Member[] = [];
  for (const u of users) {
    const member = await scoreMember(u, dates);
    // Null only when the member has opted out. Having nothing scheduled or
    // nothing completed is not a reason to skip them here: each board applies
    // its own eligibility when it ranks.
    if (member) members.push(member);
  }

  return boardFrom(month, members);
}

/**
 * One member's two figures, by the same route the rest of the app takes.
 *
 * Pulled out of the loop so that refreshing one person costs one state load
 * rather than everybody's — and so there is only one definition of each number,
 * whether it is computed for the whole board or for you alone.
 */
async function scoreMember(u: Row, dates: string[]): Promise<Member | null> {
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
   * One opt-out therefore removes a member from both rankings at once.
   *
   * It is server-side, which is the requirement. Nothing about the decision
   * reaches the browser: an opted-out member is gone before a snapshot exists,
   * so their username, figures and ranks are not merely hidden by the client,
   * they were never sent to it, and they are absent from every count because
   * those are counted from the ranked lists.
   *
   * And it survives the column not being there yet. `loadState` reads
   * preferences with `select *`, so an un-migrated database yields `true` here
   * and the board behaves exactly as it did before the setting existed.
   *
   * Their own data is untouched by any of this — the state was just read in
   * full, and it is only these rankings that they leave.
   */
  if (state.prefs.communityVisible === false) return null;

  // The same scoring the app uses, with weighting forced off so every member
  // is measured the same way.
  const unweighted: AppState = { ...state, prefs: { ...state.prefs, weighted: false } };
  const score = rangeScore(unweighted, dates);
  /* Counted by the same rule Insights and My Progress use, over the same days.
     Only the number is kept; the priorities themselves go no further. */
  const count = dates.length
    ? accomplishedBetween(state.priorities, dates[0], dates[dates.length - 1]).length
    : 0;
  return { id: u.id, name: displayName(u), createdAt: String(u.created_at), pct: score.pct, count };
}

/**
 * Writes a finished month's habit board once, the first time anyone looks at
 * the new one. No scheduler to run or forget, and the work happens once because
 * the insert refuses duplicates.
 *
 * `do nothing` on conflict is what makes it safe to call on every request and
 * what stops a re-run from rewriting a month that was already closed. It only
 * ever inserts; it never touches habits or completions. Accomplishments are not
 * archived: the table has no column for them and none was asked for.
 */
async function archiveMonth(month: string) {
  const already = await query<{ n: string }>(
    "select count(*)::int as n from community_month_scores where month = $1", [month]);
  if (Number(already[0]?.n ?? 0) > 0) return;

  const finished = await computeAll(wholeMonth(month));
  for (const e of finished.habits) {
    await query(
      `insert into community_month_scores (month, user_id, rank, pct, name)
       values ($1,$2,$3,$4,$5) on conflict (month, user_id) do nothing`,
      [month, e.id, e.rank, e.pct, e.name],
    );
  }
}

/**
 * Both boards as one reader sees them, measured over their month to date.
 *
 * `today` is the reader's calendar date (see `viewerToday`); it defaults to the
 * server's date for callers that have no reader.
 */
export async function communitySnapshot(meId: string, today = todayISO()): Promise<CommunitySnapshot> {
  for (const [key, e] of cache) if (Date.now() - e.at > CACHE_MS) cache.delete(key);

  let entry = cache.get(today);
  if (!entry) {
    const window = monthToDate(today);
    const board = await computeAll(window);
    /* A full recompute has just scored everybody, so nothing is outstanding —
       a fresh entry starts with an empty stale set, and a mark made mid-compute
       does not cause a pointless second pass over someone already counted. */
    entry = { at: Date.now(), board, dates: window.dates, stale: new Set() };
    cache.set(today, entry);
    /* Closing the previous month is best-effort: a history record failing to
       write must never stop today's board from rendering. It stays on the
       server's own month, exactly as before, so no archived month is closed
       early or rewritten because a reader happens to be in another zone. */
    archiveMonth(previousMonth(monthToDate().month)).catch(() => {});
  } else if (entry.stale.size > 0) {
    // Somebody ticked something since the last look. Rescore just them.
    entry.board = await refreshStale(entry);
  }
  const { month, updatedAt, members, habits, accomplishments } = entry.board;

  /* Exactly the public fields, listed rather than spread, so nothing kept for
     sorting or refreshing (an id, an account's creation time) can leak. */
  const myHabit = habits.find((e) => e.id === meId) || null;
  const myAccomplishment = accomplishments.find((e) => e.id === meId) || null;
  const meMember = members.find((m) => m.id === meId) || null;

  return {
    month,
    updatedAt,
    activeUsers: habits.length,
    top: habits.slice(0, TOP_N).map((e) => ({ rank: e.rank, name: e.name, pct: e.pct, isMe: e.id === meId })),
    me: myHabit ? { rank: myHabit.rank, pct: myHabit.pct, name: myHabit.name } : null,
    accomplishments: {
      members: accomplishments.length,
      top: accomplishments.slice(0, TOP_N)
        .map((e) => ({ rank: e.rank, name: e.name, count: e.count, isMe: e.id === meId })),
      me: myAccomplishment
        ? { rank: myAccomplishment.rank, count: myAccomplishment.count, name: myAccomplishment.name }
        : null,
      mine: meMember ? meMember.count : null,
    },
  };
}

/** Exposed for tests; also lets an admin action drop a stale snapshot. */
export function clearCommunityCache() { cache.clear(); }

/* ───────────────────── read-only standings, for Admin ────────────────────── */

/**
 * One member's place, as far as an already-computed board can say.
 *
 * Deliberately only two states. `ranked` and `none` are things a board knows;
 * "hidden" is not — an opted-out member is dropped inside `scoreMember` before
 * the board exists, so their absence is indistinguishable from never having been
 * scored. Calling that "hidden" would be asserting a private preference from
 * missing data, so absent members are simply not in the map and the caller shows
 * a dash.
 */
export type Standing =
  | { state: "ranked"; rank: number; pct: number }
  | { state: "none" };

export interface Standings {
  /** 'YYYY-MM' the figures were measured over. */
  month: string;
  /** When the board was last computed, for an "as of" tooltip. */
  updatedAt: string;
  byUser: Map<string, Standing>;
}

/**
 * The standings from the cache, or null when there are none.
 *
 * **This never computes anything.** No `loadState`, no `computeAll`, no
 * `refreshStale`, no query, and no mutation of the cache — the whole point is
 * that an admin screen can show Community figures without paying the ~16
 * queries per member that producing them costs. A cold or expired cache returns
 * null, and the caller shows "—" rather than a manufactured rank. The cache is
 * filled only by people reading their own Community board.
 *
 * With no argument it returns the freshest live entry whatever date it is keyed
 * by. That is deliberate: entries are keyed by the *reader's* calendar date, and
 * a page request carries no time-zone header, so insisting on the server's UTC
 * date would miss the entry the app actually populated for most of the day. The
 * month and timestamp come back with it so the screen can say what it is showing.
 *
 * Stale members are not refreshed — `entry.stale` is left exactly as it is for
 * the next real reader, so nothing an admin does changes what anybody else sees.
 */
export function communityStandings(today?: string): Standings | null {
  const live = (e: CacheEntry) => Date.now() - e.at <= CACHE_MS;

  let entry: CacheEntry | undefined;
  if (today !== undefined) {
    const found = cache.get(today);
    entry = found && live(found) ? found : undefined;
  } else {
    for (const e of cache.values()) {
      if (live(e) && (!entry || e.at > entry.at)) entry = e;
    }
  }
  if (!entry) return null;

  const { board } = entry;
  const byUser = new Map<string, Standing>();
  // Nothing scheduled this month is a real, reportable state: the member was
  // scored, and the habit ranking has no place for them.
  for (const m of board.members) byUser.set(m.id, { state: "none" });
  for (const h of board.habits) byUser.set(h.id, { state: "ranked", rank: h.rank, pct: h.pct });

  return { month: board.month, updatedAt: board.updatedAt, byUser };
}
