import { ApiError } from "@/lib/http";
import { query, transaction } from "@/lib/db/pool";
import { emptyState, isNumericTracking } from "@/lib/types";
import type {
  AppState, AwarenessEntry, DayMetrics, Goal, Habit, Prefs, SpendingRecord, Stack, WeeklyReview,
} from "@/lib/types";

/**
 * The only place that knows SQL. Server-only: every function takes the user id
 * the session resolved to, and every statement is scoped by it — that scoping
 * is what row-level security used to do inside Supabase, moved to the layer
 * that now owns the connection.
 *
 * The browser reaches these through /api/* and never names a user.
 */

const num = (v: unknown) => (v === "" || v == null ? null : Number(v));

type Q = typeof query;

/**
 * Ownership, established once per write rather than re-derived per statement.
 *
 * A `where user_id = $n` on each statement is not enough on its own: an upsert
 * whose guard sits in its `do update` branch does nothing on conflict but still
 * inserts when there is no conflicting row, and a child-table insert naming a
 * parent id has no guard at all. Both were reachable — a request could rewrite
 * another account's habit schedule, or attach another account's habit to its
 * own goal. So: check the parent row first, then write.
 *
 * `null` owner means the row does not exist yet, which is a create and fine.
 */
type Owned = "habits" | "goals" | "habit_stacks" | "habit_awareness_entries";

async function assertOwns(q: Q, table: Owned, id: string, userId: string) {
  const rows = await q<{ user_id: string }>(
    `select user_id from ${table} where id = $1`, [id],
  );
  if (rows[0] && rows[0].user_id !== userId) {
    // Same message and status as a genuinely missing row, so this cannot be
    // used to test whether an id exists on another account.
    throw new ApiError("Not found", 404);
  }
  return rows[0]?.user_id === userId;
}

/**
 * For ids a row *points at* rather than the row being written. Those must
 * already exist and belong to the caller — otherwise the foreign key fails
 * later as a 500 where a 404 is the honest answer.
 */
async function assertRef(q: Q, table: Owned, id: string, userId: string) {
  if (!(await assertOwns(q, table, id, userId))) throw new ApiError("Not found", 404);
}

// ------------------------------- read --------------------------------------

export async function loadState(userId: string): Promise<AppState> {
  const [habits, schedules, goalLinks, goals, completions, notes, awareness, stacks, metrics,
    reviews, spending, prefs] =
    await Promise.all([
      query("select * from habits where user_id = $1 order by sort_order, created_at", [userId]),
      query("select * from habit_schedules where user_id = $1 order by effective_from desc", [userId]),
      query("select * from goal_habits where user_id = $1", [userId]),
      query("select * from goals where user_id = $1 and archived = false", [userId]),
      query("select * from habit_completions where user_id = $1", [userId]),
      query("select * from day_notes where user_id = $1", [userId]),
      query("select * from habit_awareness_entries where user_id = $1", [userId]),
      query("select * from habit_stacks where user_id = $1", [userId]),
      query("select * from daily_metrics where user_id = $1", [userId]),
      query("select * from weekly_reviews where user_id = $1", [userId]),
      // Bounded: a year is enough for month-over-month, and the payload stays
      // small however long the account has existed.
      query(`select * from spending_records
              where user_id = $1 and spent_on >= current_date - 365
              order by spent_on desc`, [userId]),
      query("select * from user_preferences where user_id = $1", [userId]),
    ]);

  const state = emptyState();

  const latestSchedule = new Map<string, any>();
  schedules.forEach((s: any) => {
    if (!latestSchedule.has(s.habit_id)) latestSchedule.set(s.habit_id, s); // ordered desc
  });
  const goalOf = new Map<string, string>();
  goalLinks.forEach((l: any) => goalOf.set(l.habit_id, l.goal_id));

  state.habits = habits.map((h: any): Habit => {
    const s = latestSchedule.get(h.id);
    return {
      id: h.id,
      name: h.name,
      templateKey: h.template_key ?? null,
      description: h.description ?? "",
      category: h.category,
      type: h.kind,
      frequency: {
        mode: s?.mode ?? "daily",
        days: s?.days_of_week ?? [0, 1, 2, 3, 4, 5, 6],
        timesPerWeek: s?.times_per_week ?? 3,
      },
      tracking: h.tracking_type ?? "boolean",
      minimum: h.minimum == null ? null : Number(h.minimum),
      target: h.target == null ? null : Number(h.target),
      unit: h.unit ?? "",
      anchor: h.anchor ?? "",
      environment: h.environment ?? "",
      friction: h.friction ?? "",
      startDate: h.start_date,
      status: h.status,
      active: h.status === "active",
      replacesHabitId: h.replaces_habit_id ?? null,
      rationale: h.rationale ?? null,
      weight: h.weight,
      goalId: goalOf.get(h.id) ?? null,
      sortOrder: h.sort_order ?? 0,
      createdAt: new Date(h.created_at).getTime(),
    };
  });

  state.goals = goals.map((g: any): Goal => ({
    id: g.id, name: g.name, templateKey: g.template_key ?? null,
    area: g.area ?? "Health", why: g.why ?? "",
  }));

  /**
   * §20/§39. Whether a day counts is *derived* from the value against the
   * habit's bar, not from the row merely existing.
   *
   * A row records what happened — three glasses of eight. Whether three is
   * enough is a separate question, and answering it here means the definition
   * can change without a migration, and that "minimum met" and "target met"
   * stay distinct concepts rather than being collapsed into one flag.
   *
   * A habit with no bar, or one measured by a yes/no, counts by having a row —
   * which is the behaviour every existing completion already relies on.
   */
  const barFor = new Map(state.habits.map((h) => [h.id, h]));
  completions.forEach((c: any) => {
    const habit = barFor.get(c.habit_id);
    const value = c.value == null ? null : Number(c.value);
    let done = true;

    if (habit && value != null && isNumericTracking(habit.tracking)) {
      if (habit.tracking === "maximum") {
        done = habit.target == null || value <= habit.target;
      } else {
        const bar = habit.minimum ?? habit.target;
        done = bar == null ? value > 0 : value >= bar;
      }
    }

    state.completions[c.done_on] ??= {};
    state.completions[c.done_on][c.habit_id] = { done, value, note: c.note ?? "" };
  });

  notes.forEach((n: any) => { state.dayNotes[n.note_date] = n.body ?? ""; });

  state.awareness = awareness.map((a: any): AwarenessEntry => ({
    id: a.id, time: a.at_time?.slice(0, 5) ?? "", activity: a.activity,
    duration: a.duration ?? "", context: a.context ?? "", notes: a.notes ?? "", grade: a.grade,
  }));

  state.stacks = stacks.map((k: any): Stack => ({
    id: k.id, triggerHabitId: k.trigger_habit_id ?? "", triggerText: k.trigger_text ?? "",
    newHabitId: k.new_habit_id ?? "", newText: k.new_text ?? "",
    time: k.trigger_time?.slice(0, 5) ?? "", location: k.trigger_location ?? "",
  }));

  metrics.forEach((m: any) => {
    state.metrics[m.metric_date] = {
      weight: m.weight, calories: m.calories, sleep: m.sleep_hours, water: m.water,
      cardioMin: m.cardio_minutes, cardio: m.cardio_day, gym: m.gym_day,
    };
  });

  state.reviews = reviews.map((r: any): WeeklyReview => ({
    id: r.id, weekStart: r.week_start, wentWell: r.went_well ?? "", gotInWay: r.got_in_way ?? "",
    focus: r.focus_next ?? "", modify: r.modify ?? "", add: r.add_or_drop ?? "", stats: r.stats ?? undefined,
  }));

  state.spending = spending.map((s: any): SpendingRecord => ({
    id: s.id, date: s.spent_on, amount: Number(s.amount),
    description: s.description ?? "", category: s.category ?? "other",
    needWant: s.need_want ?? "need", planned: s.planned !== false, notes: s.notes ?? "",
  }));

  if (prefs[0]) {
    state.prefs = {
      theme: prefs[0].theme,
      weighted: prefs[0].weighted_score,
      goalWeight: prefs[0].goal_weight == null ? null : Number(prefs[0].goal_weight),
      locale: prefs[0].locale ?? "en",
    };
  }
  return state;
}

// ------------------------------ mutations ----------------------------------

/** Returns true when the row did not exist before — i.e. this was a create. */
export async function saveHabit(userId: string, h: Habit): Promise<boolean> {
  return transaction(async (q) => {
    const existed = await assertOwns(q, "habits", h.id, userId);
    // A habit may only point at a goal the same account owns.
    if (h.goalId) await assertRef(q, "goals", h.goalId, userId);

    await q(
      `insert into habits (id, user_id, name, template_key, description, category, kind,
                           tracking_type, minimum, target, unit, anchor, environment, friction,
                           weight, start_date, status, replaces_habit_id, rationale, sort_order)
       values ($1,$2,$3,$4,$5,$6::habit_category,$7::habit_kind,$8::tracking_type,$9,$10,$11,
               $12,$13,$14,$15,$16,$17::habit_status,$18,$19,$20)
       on conflict (id) do update set
         name = excluded.name, template_key = excluded.template_key,
         description = excluded.description, category = excluded.category,
         kind = excluded.kind, tracking_type = excluded.tracking_type,
         minimum = excluded.minimum, target = excluded.target, unit = excluded.unit,
         anchor = excluded.anchor, environment = excluded.environment,
         friction = excluded.friction,
         weight = excluded.weight, start_date = excluded.start_date, status = excluded.status,
         replaces_habit_id = excluded.replaces_habit_id, rationale = excluded.rationale,
         sort_order = excluded.sort_order
       where habits.user_id = $2`,
      [h.id, userId, h.name, h.templateKey, h.description || null, h.category, h.type,
        h.tracking, h.minimum, h.target, h.unit || null,
        h.anchor || null, h.environment || null, h.friction || null,
        h.weight, h.startDate, h.status, h.replacesHabitId, h.rationale, h.sortOrder],
    );

    // A schedule change opens a new version from today, so history keeps its own rules.
    await q(
      `insert into habit_schedules (habit_id, user_id, mode, days_of_week, times_per_week, effective_from)
       values ($1,$2,$3::freq_mode,$4,$5, current_date)
       on conflict (habit_id, effective_from) do update set
         mode = excluded.mode, days_of_week = excluded.days_of_week,
         times_per_week = excluded.times_per_week
       where habit_schedules.user_id = $2`,
      [h.id, userId, h.frequency.mode, h.frequency.days,
        h.frequency.mode === "times" ? h.frequency.timesPerWeek : null],
    );

    await q("delete from goal_habits where habit_id = $1 and user_id = $2", [h.id, userId]);
    if (h.goalId) {
      await q(
        "insert into goal_habits (goal_id, habit_id, user_id) values ($1,$2,$3)",
        [h.goalId, h.id, userId],
      );
    }
    return !existed;
  });
}

export async function deleteHabit(userId: string, id: string) {
  await query("delete from habits where id = $1 and user_id = $2", [id, userId]);
}

/** Done writes a row; not done removes it. A miss is the absence of a row. */
export async function setCompletion(
  userId: string, habitId: string, date: string, done: boolean, value?: number | null, note?: string,
) {
  if (done) {
    await query(
      `insert into habit_completions (habit_id, user_id, done_on, value, note)
       select $1, $2, $3, $4, $5
        where exists (select 1 from habits where id = $1 and user_id = $2)
       on conflict (habit_id, done_on) do update set value = excluded.value, note = excluded.note`,
      [habitId, userId, date, value ?? null, note || null],
    );
  } else {
    await query(
      "delete from habit_completions where habit_id = $1 and done_on = $2 and user_id = $3",
      [habitId, date, userId],
    );
  }
}

export async function saveGoal(userId: string, g: Goal): Promise<boolean> {
  const existed = await assertOwns(query, "goals", g.id, userId);
  await query(
    `insert into goals (id, user_id, name, template_key, area, why) values ($1,$2,$3,$4,$5,$6)
     on conflict (id) do update set name = excluded.name, template_key = excluded.template_key,
       area = excluded.area, why = excluded.why
     where goals.user_id = $2`,
    [g.id, userId, g.name, g.templateKey, g.area, g.why || null],
  );
  return !existed;
}

export async function deleteGoal(userId: string, id: string) {
  await query("delete from goals where id = $1 and user_id = $2", [id, userId]);
}

export async function saveDayNote(userId: string, date: string, body: string) {
  await query(
    `insert into day_notes (user_id, note_date, body) values ($1,$2,$3)
     on conflict (user_id, note_date) do update set body = excluded.body`,
    [userId, date, body],
  );
}

export async function saveAwareness(userId: string, e: AwarenessEntry): Promise<boolean> {
  const existed = await assertOwns(query, "habit_awareness_entries", e.id, userId);
  await query(
    `insert into habit_awareness_entries (id, user_id, activity, at_time, duration, context, notes, grade)
     values ($1,$2,$3,$4,$5,$6,$7,$8::grade)
     on conflict (id) do update set
       activity = excluded.activity, at_time = excluded.at_time, duration = excluded.duration,
       context = excluded.context, notes = excluded.notes, grade = excluded.grade
     where habit_awareness_entries.user_id = $2`,
    [e.id, userId, e.activity, e.time || null, e.duration || null, e.context || null, e.notes || null, e.grade],
  );
  return !existed;
}

export async function deleteAwareness(userId: string, id: string) {
  await query("delete from habit_awareness_entries where id = $1 and user_id = $2", [id, userId]);
}

export async function saveStack(userId: string, k: Stack): Promise<boolean> {
  return transaction(async (q) => {
    const existed = await assertOwns(q, "habit_stacks", k.id, userId);
    // Both ends of a stack point at habits; neither may be someone else's.
    if (k.triggerHabitId) await assertRef(q, "habits", k.triggerHabitId, userId);
    if (k.newHabitId) await assertRef(q, "habits", k.newHabitId, userId);
    await saveStackRow(q, userId, k);
    return !existed;
  });
}

async function saveStackRow(q: Q, userId: string, k: Stack) {
  await q(
    `insert into habit_stacks (id, user_id, trigger_habit_id, trigger_text, new_habit_id,
                               new_text, trigger_time, trigger_location)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (id) do update set
       trigger_habit_id = excluded.trigger_habit_id, trigger_text = excluded.trigger_text,
       new_habit_id = excluded.new_habit_id, new_text = excluded.new_text,
       trigger_time = excluded.trigger_time, trigger_location = excluded.trigger_location
     where habit_stacks.user_id = $2`,
    [k.id, userId, k.triggerHabitId || null, k.triggerText || null, k.newHabitId || null,
      k.newText || null, k.time || null, k.location || null],
  );
}

export async function deleteStack(userId: string, id: string) {
  await query("delete from habit_stacks where id = $1 and user_id = $2", [id, userId]);
}

export async function saveMetrics(userId: string, date: string, m: DayMetrics) {
  await query(
    `insert into daily_metrics (user_id, metric_date, weight, calories, sleep_hours, water,
                                cardio_minutes, cardio_day, gym_day, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual')
     on conflict (user_id, metric_date) do update set
       weight = excluded.weight, calories = excluded.calories, sleep_hours = excluded.sleep_hours,
       water = excluded.water, cardio_minutes = excluded.cardio_minutes,
       cardio_day = excluded.cardio_day, gym_day = excluded.gym_day, source = excluded.source`,
    [userId, date, num(m.weight), num(m.calories), num(m.sleep), num(m.water),
      num(m.cardioMin), !!m.cardio, !!m.gym],
  );
}

export async function saveReview(userId: string, r: WeeklyReview) {
  await query(
    `insert into weekly_reviews (id, user_id, week_start, went_well, got_in_way,
                                 focus_next, modify, add_or_drop, stats)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (user_id, week_start) do update set
       went_well = excluded.went_well, got_in_way = excluded.got_in_way,
       focus_next = excluded.focus_next, modify = excluded.modify,
       add_or_drop = excluded.add_or_drop, stats = excluded.stats`,
    [r.id, userId, r.weekStart, r.wentWell, r.gotInWay, r.focus, r.modify, r.add,
      r.stats ? JSON.stringify(r.stats) : null],
  );
}

export async function saveSpending(userId: string, r: SpendingRecord) {
  await query(
    `insert into spending_records (id, user_id, spent_on, amount, description, category,
                                   need_want, planned, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (id) do update set
       spent_on = excluded.spent_on, amount = excluded.amount,
       description = excluded.description, category = excluded.category,
       need_want = excluded.need_want, planned = excluded.planned, notes = excluded.notes
     where spending_records.user_id = $2`,
    [r.id, userId, r.date, r.amount, r.description || null, r.category,
      r.needWant, r.planned, r.notes || null],
  );
}

export async function deleteSpending(userId: string, id: string) {
  await query("delete from spending_records where id = $1 and user_id = $2", [id, userId]);
}

export async function savePrefs(userId: string, p: Prefs) {
  await query(
    `insert into user_preferences (user_id, theme, weighted_score, goal_weight, locale)
     values ($1,$2,$3,$4,$5)
     on conflict (user_id) do update set
       theme = excluded.theme, weighted_score = excluded.weighted_score,
       goal_weight = excluded.goal_weight, locale = excluded.locale`,
    [userId, p.theme, p.weighted, p.goalWeight, p.locale],
  );
}

/**
 * What the account section shows. Deliberately small: an email, when the
 * account started, and two counts that come from rows the user can already see.
 *
 * The role is read here rather than trusted from the client, and it is only
 * ever used to decide whether to *show* the admin link — /admin re-checks it
 * against the database on every request and 404s regardless of what any client
 * believes.
 */
export interface AccountSummary {
  email: string;
  createdAt: string;
  isAdmin: boolean;
  activeHabits: number;
  daysRecorded: number;
}

export async function loadAccount(userId: string): Promise<AccountSummary | null> {
  const rows = await query<any>(
    `select coalesce(u.email, u.username) as email,
            u.created_at,
            u.role = 'admin' as is_admin,
            (select count(*) from habits h
              where h.user_id = u.id and h.status = 'active')          as active_habits,
            (select count(distinct done_on) from habit_completions c
              where c.user_id = u.id)                                  as days_recorded
       from users u where u.id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    email: r.email,
    // The full instant, not a calendar date: the server has no idea what
    // timezone the reader is in, so the browser decides which day it was.
    createdAt: new Date(r.created_at).toISOString(),
    isAdmin: r.is_admin === true,
    activeHabits: Number(r.active_habits),
    daysRecorded: Number(r.days_recorded),
  };
}

/**
 * The user's own arrangement of a section.
 *
 * One statement rather than a save per habit: the order is a single fact about
 * a list, and writing it row by row would leave the list briefly inconsistent
 * if a request failed halfway. `user_id` is in the where clause, so ids the
 * account does not own simply match nothing — a foreign id is a no-op, not an
 * error and not a write.
 */
export async function reorderHabits(userId: string, ids: string[]) {
  if (ids.length === 0) return;
  await query(
    `update habits as h set sort_order = o.position
       from unnest($2::uuid[]) with ordinality as o(id, position)
      where h.id = o.id and h.user_id = $1`,
    [userId, ids],
  );
}
