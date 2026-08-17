import { query } from "@/lib/db/pool";
import { ACTIVATION, ENGAGEMENT, FEATURES, RETENTION_DAYS, type EngagementStatus } from "./config";

/**
 * Every admin metric, computed from the events that were actually recorded.
 *
 * Two standing rules:
 *   - Nothing is inflated. "Active" means an event exists; a user with no
 *     events counts as not active, and an incomplete cohort shows a gap rather
 *     than a flattering number.
 *   - No habit names, notes, metric values or goal text are selected anywhere
 *     in this file. Aggregates are counts of ids.
 *
 * Timestamps are stored in UTC. Anything reported in local time converts with
 * the timezone the event itself carried, per row, rather than assuming one.
 */

const featureKeys = Object.keys(FEATURES) as (keyof typeof FEATURES)[];

// ───────────────────────────── overview ──────────────────────────────────────

export interface Overview {
  totalUsers: number;
  dau: number;
  wau: number;
  mau: number;
  newThisWeek: number;
  newToday: number;
  returningUsers: number;
  dauOverMau: number | null;
}

export async function overview(): Promise<Overview> {
  const [row] = await query<Record<string, string>>(`
    with active as (
      select user_id, occurred_at from analytics_events where user_id is not null
    )
    select
      (select count(*) from users)                                              as total_users,
      (select count(distinct user_id) from active
        where occurred_at >= now() - interval '1 day')                          as dau,
      (select count(distinct user_id) from active
        where occurred_at >= now() - interval '7 days')                         as wau,
      (select count(distinct user_id) from active
        where occurred_at >= now() - interval '30 days')                        as mau,
      (select count(*) from users where created_at >= now() - interval '7 days') as new_week,
      (select count(*) from users where created_at >= date_trunc('day', now()))  as new_today,
      -- Returning = active in the last 7 days but not brand new, so growth is
      -- never mistaken for retention.
      (select count(distinct user_id) from active a
        join users u on u.id = a.user_id
       where a.occurred_at >= now() - interval '7 days'
         and u.created_at < now() - interval '7 days')                          as returning
  `);

  const dau = Number(row.dau), mau = Number(row.mau);
  return {
    totalUsers: Number(row.total_users),
    dau, wau: Number(row.wau), mau,
    newThisWeek: Number(row.new_week),
    newToday: Number(row.new_today),
    returningUsers: Number(row.returning),
    dauOverMau: mau > 0 ? Math.round((dau / mau) * 1000) / 10 : null,
  };
}

// ───────────────────────────── growth ────────────────────────────────────────

export async function signupsOverTime(days: number) {
  return query<{ day: string; signups: number; cumulative: number }>(`
    with span as (
      select generate_series(date_trunc('day', now()) - ($1::int - 1) * interval '1 day',
                             date_trunc('day', now()), interval '1 day')::date as day
    )
    select s.day,
           count(u.id)::int as signups,
           (select count(*) from users where created_at < s.day + interval '1 day')::int as cumulative
      from span s
      left join users u on u.created_at::date = s.day
     group by s.day order by s.day
  `, [days]);
}

// ───────────────────────── engagement / sessions ─────────────────────────────

export async function activeOverTime(days: number) {
  return query<{ day: string; dau: number }>(`
    with span as (
      select generate_series(date_trunc('day', now()) - ($1::int - 1) * interval '1 day',
                             date_trunc('day', now()), interval '1 day')::date as day
    )
    select s.day, count(distinct e.user_id)::int as dau
      from span s
      left join analytics_events e on e.occurred_at::date = s.day
     group by s.day order by s.day
  `, [days]);
}

export interface SessionStats {
  sessionsToday: number;
  sessionsPerUser: number | null;
  avgDurationMin: number | null;
  medianDurationMin: number | null;
  avgEventsPerSession: number | null;
}

export async function sessionStats(): Promise<SessionStats> {
  const [row] = await query<Record<string, string | null>>(`
    with finished as (
      -- Duration is first-to-last activity. A single-event session is zero
      -- minutes long, which is honest: we cannot know how long they looked.
      select extract(epoch from (last_activity_at - started_at)) / 60 as minutes,
             event_count
        from user_sessions
       where started_at >= now() - interval '30 days'
    )
    select
      (select count(*) from user_sessions where started_at >= date_trunc('day', now())) as today,
      (select round(count(*)::numeric / nullif(count(distinct user_id), 0), 2)
         from user_sessions where started_at >= now() - interval '30 days')             as per_user,
      (select round(avg(minutes)::numeric, 1) from finished)                            as avg_min,
      (select round((percentile_cont(0.5) within group (order by minutes))::numeric, 1)
         from finished)                                                                 as median_min,
      (select round(avg(event_count)::numeric, 1) from finished)                        as avg_events
  `);
  const num = (v: string | null) => (v == null ? null : Number(v));
  return {
    sessionsToday: Number(row.today ?? 0),
    sessionsPerUser: num(row.per_user),
    avgDurationMin: num(row.avg_min),
    medianDurationMin: num(row.median_min),
    avgEventsPerSession: num(row.avg_events),
  };
}

// ───────────────────────────── features ──────────────────────────────────────

export interface FeatureRow {
  key: string; label: string; users: number; events: number; adoption: number | null;
}

export async function featureAdoption(): Promise<FeatureRow[]> {
  const rows = await query<{ feature: string; users: string; events: string }>(`
    select feature, count(distinct user_id)::text as users, count(*)::text as events
      from analytics_events
     where feature is not null
     group by feature
  `);
  const [{ total }] = await query<{ total: string }>("select count(*)::text as total from users");
  const denominator = Number(total);

  return featureKeys.map((key) => {
    const hit = rows.find((r) => r.feature === key);
    const users = hit ? Number(hit.users) : 0;
    return {
      key,
      label: FEATURES[key].label,
      users,
      events: hit ? Number(hit.events) : 0,
      adoption: denominator ? Math.round((users / denominator) * 1000) / 10 : null,
    };
  }).sort((a, b) => b.users - a.users);
}

// ─────────────────────────── usage times ─────────────────────────────────────

/**
 * Day-of-week × hour-of-day, in each event's own local time.
 *
 * `occurred_at at time zone tz` converts a UTC instant to wall-clock time in
 * that zone; rows with no timezone fall back to UTC rather than being dropped,
 * so the totals still add up.
 */
export async function usageHeatmap() {
  return query<{ dow: number; hour: number; events: number; users: number }>(`
    with localised as (
      select (occurred_at at time zone coalesce(nullif(user_timezone, ''), 'UTC')) as local_ts,
             user_id
        from analytics_events
       where occurred_at >= now() - interval '90 days'
    )
    select extract(dow from local_ts)::int  as dow,
           extract(hour from local_ts)::int as hour,
           count(*)::int                    as events,
           count(distinct user_id)::int     as users
      from localised
     group by 1, 2 order by 1, 2
  `);
}

// ───────────────────────────── retention ─────────────────────────────────────

export interface RetentionPoint { day: number; eligible: number; returned: number; pct: number | null; }

/** Day-N retention: of users old enough to have had the chance, how many came back. */
export async function retention(): Promise<RetentionPoint[]> {
  const out: RetentionPoint[] = [];
  for (const day of RETENTION_DAYS) {
    const [row] = await query<{ eligible: string; returned: string }>(`
      with eligible as (
        select id, created_at from users
         where created_at <= now() - ($1::int + 1) * interval '1 day'
      )
      select (select count(*) from eligible)::text as eligible,
             (select count(distinct e.id) from eligible e
               where exists (
                 select 1 from analytics_events a
                  where a.user_id = e.id
                    and a.occurred_at::date = (e.created_at + $1 * interval '1 day')::date
               ))::text as returned
    `, [day]);
    const eligible = Number(row.eligible), returned = Number(row.returned);
    out.push({ day, eligible, returned, pct: eligible ? Math.round((returned / eligible) * 1000) / 10 : null });
  }
  return out;
}

export interface CohortRow { week: string; users: number; weeks: (number | null)[]; }

/** Weekly signup cohorts against weekly return activity. Gaps stay gaps. */
export async function cohorts(weeks = 6): Promise<CohortRow[]> {
  const rows = await query<{ cohort: string; users: string; week_no: string; active: string }>(`
    with c as (
      select id, date_trunc('week', created_at)::date as cohort from users
       where created_at >= date_trunc('week', now()) - ($1::int - 1) * interval '1 week'
    ),
    sizes as (select cohort, count(*) as users from c group by cohort),
    activity as (
      select c.cohort,
             floor(extract(epoch from (a.occurred_at - c.cohort)) / (7*86400))::int as week_no,
             a.user_id
        from c join analytics_events a on a.user_id = c.id
    )
    select s.cohort::text as cohort, s.users::text as users,
           a.week_no::text as week_no, count(distinct a.user_id)::text as active
      from sizes s left join activity a on a.cohort = s.cohort and a.week_no >= 0
     group by s.cohort, s.users, a.week_no
     order by s.cohort desc
  `, [weeks]);

  const byCohort = new Map<string, CohortRow>();
  const now = Date.now();
  for (const r of rows) {
    const key = r.cohort;
    if (!byCohort.has(key)) {
      const age = Math.floor((now - new Date(key).getTime()) / (7 * 86400_000));
      byCohort.set(key, {
        week: key,
        users: Number(r.users),
        // null where that week has not happened yet — never 0%, which would
        // read as "nobody came back".
        weeks: Array.from({ length: weeks }, (_, i) => (i <= age ? 0 : null)),
      });
    }
    const row = byCohort.get(key)!;
    if (r.week_no != null) {
      const i = Number(r.week_no);
      if (i >= 0 && i < weeks) {
        row.weeks[i] = row.users ? Math.round((Number(r.active) / row.users) * 1000) / 10 : 0;
      }
    }
  }
  return [...byCohort.values()];
}

// ──────────────────────────── funnel ─────────────────────────────────────────

export interface FunnelStep { key: string; label: string; users: number; pct: number | null; }

export async function funnel(): Promise<FunnelStep[]> {
  const [row] = await query<Record<string, string>>(`
    select
      (select count(*) from users)                                           as registered,
      (select count(distinct user_id) from analytics_events
        where event_name = 'habit_created')                                  as created_habit,
      (select count(distinct user_id) from analytics_events
        where event_name = 'habit_completed')                                as completed_habit,
      -- Came back on a later calendar day than they signed up.
      (select count(distinct a.user_id) from analytics_events a
        join users u on u.id = a.user_id
       where a.occurred_at::date > u.created_at::date)                       as returned_next_day,
      (select count(*) from (
         select user_id from analytics_events
          where event_name in ('habit_completed','habit_created')
          group by user_id having count(distinct occurred_at::date) >= 7
       ) x)                                                                  as tracked_seven_days,
      (select count(distinct user_id) from analytics_events
        where event_name = 'weekly_review_completed')                        as did_review,
      (select count(distinct a.user_id) from analytics_events a
        join users u on u.id = a.user_id
       where u.created_at <= now() - interval '30 days'
         and a.occurred_at >= u.created_at + interval '30 days')             as active_after_30
  `);

  const steps: [string, string, number][] = [
    ["registered", "Registered", Number(row.registered)],
    ["created_habit", "Created first habit", Number(row.created_habit)],
    ["completed_habit", "Completed first habit", Number(row.completed_habit)],
    ["returned", "Returned another day", Number(row.returned_next_day)],
    ["seven_days", "Tracked on 7 days", Number(row.tracked_seven_days)],
    ["review", "Completed a weekly review", Number(row.did_review)],
    ["day_30", "Active after 30 days", Number(row.active_after_30)],
  ];
  const top = steps[0][2];
  return steps.map(([key, label, users]) => ({
    key, label, users, pct: top ? Math.round((users / top) * 1000) / 10 : null,
  }));
}

// ─────────────────────────── activation ──────────────────────────────────────

export async function activationRate(): Promise<{ eligible: number; activated: number; pct: number | null }> {
  const [row] = await query<{ eligible: string; activated: string }>(`
    with eligible as (
      select id, created_at from users where created_at <= now() - ($1::int * interval '1 day')
    ),
    qualifying as (
      select e.id from eligible e
       where exists (select 1 from analytics_events a
                      where a.user_id = e.id and a.event_name = 'habit_created')
         and (select count(distinct a.occurred_at::date) from analytics_events a
               where a.user_id = e.id
                 and a.occurred_at < e.created_at + ($1::int * interval '1 day')) >= $2::int
    )
    select (select count(*) from eligible)::text as eligible,
           (select count(*) from qualifying)::text as activated
  `, [ACTIVATION.windowDays, ACTIVATION.distinctActiveDays]);
  const eligible = Number(row.eligible), activated = Number(row.activated);
  return { eligible, activated, pct: eligible ? Math.round((activated / eligible) * 1000) / 10 : null };
}

// ──────────────────────── habit engagement ───────────────────────────────────

export async function habitEngagement() {
  const [row] = await query<Record<string, string | null>>(`
    select
      (select round(avg(c)::numeric, 1) from (
        select count(*) c from habits group by user_id) x)                    as avg_habits,
      (select round(avg(c)::numeric, 1) from (
        select count(*) c from habit_completions
         where done_on >= current_date - 30 group by user_id, done_on) x)     as avg_completions_per_day,
      (select count(distinct user_id) from habits)::text                      as with_habit,
      (select count(distinct user_id) from habit_completions)::text           as with_completion,
      (select count(distinct user_id) from goals)::text                       as with_goal,
      (select count(distinct user_id) from weekly_reviews)::text              as with_review,
      (select count(distinct user_id) from habit_stacks)::text                as with_stack,
      (select count(*) from users)::text                                      as total
  `);
  const total = Number(row.total ?? 0);
  const pct = (v: string | null) => (total ? Math.round((Number(v ?? 0) / total) * 1000) / 10 : null);
  return {
    avgHabitsPerUser: row.avg_habits == null ? null : Number(row.avg_habits),
    avgCompletionsPerDay: row.avg_completions_per_day == null ? null : Number(row.avg_completions_per_day),
    pctCreatedHabit: pct(row.with_habit),
    pctCompletedHabit: pct(row.with_completion),
    pctCreatedGoal: pct(row.with_goal),
    pctDidReview: pct(row.with_review),
    pctUsedStacking: pct(row.with_stack),
  };
}

// ─────────────────────────── users list ──────────────────────────────────────

export interface AdminUserRow {
  id: string;
  /** How the account is identified: address, or username when it has none. */
  email: string;
  /** The columns behind that, so the table can show both. */
  address: string | null;
  username: string | null;
  displayName: string | null;
  /** From the sign-up form. Null on accounts created before it asked. */
  firstName: string | null;
  lastName: string | null;
  emailVerifiedAt: string | null;
  /**
   * Whether this account was ever asked to prove its address. False on every
   * account that predates verification, which is why they read as active rather
   * than as forever-unverified.
   */
  verificationRequired: boolean;
  /** 'self_signup' | 'admin' | 'test', or null on rows that predate the column. */
  createdVia: string | null;
  role: string; createdAt: string;
  /** Null means active. Shown in the list so a disabled account is visible. */
  disabledAt: string | null;
  firstActive: string | null; lastActive: string | null;
  activeDays: number; sessions: number; habits: number;
  completions: number; goals: number; reviews: number;
  status: EngagementStatus;
}

export type UserSort = "active" | "least_active" | "newest" | "oldest" | "last_active";
export type RoleFilter = "all" | "user" | "admin";
export type StatusFilter = "all" | "active" | "pending" | "disabled";
export type KindFilter = "all" | "email" | "username";
/** Only ever from `created_via`, never inferred from what an address looks like. */
export type SourceFilter = "all" | "real" | "test" | "unclassified";

export interface UserQuery {
  search?: string;
  sort?: UserSort;
  role?: RoleFilter;
  status?: StatusFilter;
  kind?: KindFilter;
  source?: SourceFilter;
  page?: number;
  pageSize?: number;
}

export interface AdminUserPage {
  rows: AdminUserRow[];
  /** Everything the filters match, not just this page. */
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

const SORT_SQL: Record<UserSort, string> = {
  active: "active_days desc nulls last, last_active desc nulls last",
  least_active: "active_days asc nulls first, last_active asc nulls first",
  newest: "u.created_at desc",
  oldest: "u.created_at asc",
  last_active: "last_active desc nulls last",
};

/**
 * Counts and dates only. No habit name, note, metric or goal text is selected —
 * the admin view answers "is this person using it", not "what are they doing
 * with their life".
 */
export async function adminUsers(q: UserQuery = {}): Promise<AdminUserPage> {
  const {
    search = "", sort = "active", role = "all", status = "all",
    kind = "all", source = "all",
  } = q;
  const pageSize = Math.min(200, Math.max(10, q.pageSize ?? 50));
  const page = Math.max(1, q.page ?? 1);

  /*
   * Filters are built as fragments with numbered parameters rather than
   * interpolated — the only thing that ever reaches the SQL text is a key from
   * these maps, and the values travel as bound parameters.
   */
  const where: string[] = [
    "($1 = '' or u.email ilike '%' || $1 || '%' or u.username ilike '%' || $1 || '%'"
    + " or p.display_name ilike '%' || $1 || '%')",
  ];
  if (role !== "all") where.push(`u.role = '${role === "admin" ? "admin" : "user"}'::user_role`);
  // "Active" means active, not merely not-disabled: an account waiting on its
  // confirmation link is neither, and has its own filter.
  if (status === "active") {
    where.push("u.disabled_at is null");
    where.push("(not u.verification_required or u.email_verified_at is not null)");
  }
  if (status === "pending") {
    where.push("u.disabled_at is null");
    where.push("u.verification_required and u.email_verified_at is null");
  }
  if (status === "disabled") where.push("u.disabled_at is not null");
  if (kind === "email") where.push("u.email is not null");
  if (kind === "username") where.push("u.email is null and u.username is not null");
  if (source === "test") where.push("u.created_via = 'test'");
  if (source === "real") where.push("u.created_via in ('self_signup','admin')");
  if (source === "unclassified") where.push("u.created_via is null");
  const clause = where.join(" and ");

  const counted = await query<{ n: string }>(
    `select count(*) as n from users u
       left join profiles p on p.id = u.id
      where ${clause}`, [search]);
  const total = Number(counted[0].n);

  const rows = await query<Record<string, any>>(`
    select u.id, coalesce(u.email, u.username) as identifier,
           u.email as address, u.username, p.display_name,
           p.first_name, p.last_name, u.email_verified_at, u.verification_required,
           u.created_via,
           u.role::text as role, u.created_at, u.disabled_at,
           ev.first_active, ev.last_active, coalesce(ev.active_days, 0) as active_days,
           coalesce(s.sessions, 0) as sessions,
           coalesce(h.habits, 0) as habits,
           coalesce(hc.completions, 0) as completions,
           coalesce(g.goals, 0) as goals,
           coalesce(wr.reviews, 0) as reviews
      from users u
      left join profiles p on p.id = u.id
      left join (select user_id, min(occurred_at) first_active, max(occurred_at) last_active,
                        count(distinct occurred_at::date) active_days
                   from analytics_events group by user_id) ev on ev.user_id = u.id
      left join (select user_id, count(*) sessions from user_sessions group by user_id) s on s.user_id = u.id
      left join (select user_id, count(*) habits from habits group by user_id) h on h.user_id = u.id
      left join (select user_id, count(*) completions from habit_completions group by user_id) hc on hc.user_id = u.id
      left join (select user_id, count(*) goals from goals group by user_id) g on g.user_id = u.id
      left join (select user_id, count(*) reviews from weekly_reviews group by user_id) wr on wr.user_id = u.id
     where ${clause}
     order by ${SORT_SQL[sort] ?? SORT_SQL.active}
     limit $2 offset $3
  `, [search, pageSize, (page - 1) * pageSize]);

  return {
    total, page, pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((r) => ({
      id: r.id, email: r.identifier, address: r.address ?? null,
      username: r.username ?? null, displayName: r.display_name ?? null,
      firstName: r.first_name ?? null, lastName: r.last_name ?? null,
      emailVerifiedAt: r.email_verified_at ?? null,
      verificationRequired: r.verification_required === true,
      createdVia: r.created_via ?? null, role: r.role,
      createdAt: r.created_at, disabledAt: r.disabled_at ?? null,
      firstActive: r.first_active, lastActive: r.last_active,
      activeDays: Number(r.active_days), sessions: Number(r.sessions),
      habits: Number(r.habits), completions: Number(r.completions),
      goals: Number(r.goals), reviews: Number(r.reviews),
      status: classify({
        createdAt: r.created_at, lastActive: r.last_active, activeDays: Number(r.active_days),
      }),
    })),
  };
}

/**
 * One account, by id. Its own query rather than a search: `search` matches
 * addresses and names, so paging the whole list to find a uuid would be both
 * slow and, past the last page, wrong.
 */
export async function adminUserById(id: string): Promise<AdminUserRow | null> {
  const found = await query<{ identifier: string }>(
    "select coalesce(email, username) as identifier from users where id = $1", [id]);
  if (!found[0]) return null;
  const page = await adminUsers({ search: found[0].identifier, pageSize: 200 });
  return page.rows.find((r) => r.id === id) ?? null;
}

/** Every id the current filters match, for "select all matching". */
export async function adminUserIds(q: UserQuery = {}): Promise<string[]> {
  const page = await adminUsers({ ...q, page: 1, pageSize: 200 });
  if (page.total <= 200) return page.rows.map((r) => r.id);
  const all: string[] = [];
  for (let p = 1; p <= page.pages; p++) {
    const chunk = await adminUsers({ ...q, page: p, pageSize: 200 });
    all.push(...chunk.rows.map((r) => r.id));
  }
  return all;
}

const daysSince = (d: string | Date | null) =>
  d == null ? Infinity : (Date.now() - new Date(d).getTime()) / 86400_000;

/** Bands from config, first match wins. */
export function classify(
  { createdAt, lastActive, activeDays }:
  { createdAt: string | Date; lastActive: string | Date | null; activeDays: number },
): EngagementStatus {
  const sinceSignup = daysSince(createdAt);
  const sinceSeen = daysSince(lastActive);

  if (sinceSignup <= ENGAGEMENT.newUserDays) return "new";
  if (sinceSeen > ENGAGEMENT.dormantAfterDays) return "dormant";
  if (sinceSeen > ENGAGEMENT.atRiskAfterDays) return "at_risk";
  // "Multiple days per week" is measured over the recent window, not all time.
  if (sinceSeen <= ENGAGEMENT.activeWithinDays && activeDays >= ENGAGEMENT.highlyEngagedDaysPerWeek)
    return "highly_engaged";
  if (sinceSeen <= ENGAGEMENT.activeWithinDays) return "active";
  return "at_risk";
}

export async function userProfile(userId: string) {
  const row = await adminUserById(userId);
  if (!row) return null;
  const recent = await query<{ day: string; events: number }>(`
    select occurred_at::date::text as day, count(*)::int as events
      from analytics_events where user_id = $1 and occurred_at >= now() - interval '30 days'
     group by 1 order by 1
  `, [userId]);
  const features = await query<{ feature: string; events: number }>(`
    select feature, count(*)::int as events from analytics_events
     where user_id = $1 and feature is not null group by feature order by 2 desc
  `, [userId]);
  return { ...row, recent, features };
}

// ───────────────────────────── system ────────────────────────────────────────

export async function systemHealth() {
  const [row] = await query<Record<string, string | null>>(`
    select
      (select count(*) from analytics_events)::text                              as events,
      (select count(*) from user_sessions)::text                                 as sessions,
      (select max(occurred_at)::text from analytics_events)                      as latest_event,
      -- Integrity checks: an event with no session, or one whose user is gone,
      -- means the tracker is misbehaving.
      (select count(*) from analytics_events where session_id is null)::text     as orphan_events,
      (select count(*) from analytics_events e
        where e.user_id is not null
          and not exists (select 1 from users u where u.id = e.user_id))::text   as dangling_users,
      (select count(*) from analytics_events where user_timezone is null
         or user_timezone = '')::text                                            as missing_tz
  `);
  return {
    events: Number(row.events ?? 0),
    sessions: Number(row.sessions ?? 0),
    latestEvent: row.latest_event,
    orphanEvents: Number(row.orphan_events ?? 0),
    danglingUsers: Number(row.dangling_users ?? 0),
    missingTimezone: Number(row.missing_tz ?? 0),
  };
}
