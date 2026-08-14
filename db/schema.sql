-- ===========================================================================
-- Rich Habits — Postgres schema (Render, or any plain Postgres)
-- Run once against DATABASE_URL:  psql "$DATABASE_URL" -f db/schema.sql
-- Principle: store events (a completion happened), derive everything else.
-- Scores, streaks and percentages are never stored — see the functions at the end.
-- ===========================================================================
--
-- Ported from the Supabase schema. Three things changed and nothing else:
--   1. `auth.users` became the local `users` table below, so identity lives in
--      the same database as the data it owns.
--   2. Row-level security is gone. It keyed off `auth.uid()`, which only exists
--      inside Supabase. Every query now runs through the API layer, which takes
--      the user id from the session cookie and scopes each statement by it —
--      the browser never sends a user id and never sees DATABASE_URL.
--   3. The `on_auth_user_created` trigger is gone. The starter habits and goals
--      it inserted now live in src/lib/seed.ts, so they can be created in the
--      language the account signed up in. The sign-up route writes them inside
--      the same transaction as the user row.

-- Requires Postgres 13 or newer. There is deliberately no `create extension
-- pgcrypto` here: the only thing this schema wanted from it was
-- gen_random_uuid(), which has been in core since 13. Dropping it means the
-- schema needs no elevated privileges and runs anywhere.

-- ------------------------------- enums -------------------------------------
create type habit_category as enum ('morning', 'daytime', 'nighttime');
create type habit_kind     as enum ('good', 'avoid');
create type freq_mode      as enum ('daily', 'days', 'times');
create type grade          as enum ('good', 'bad', 'neutral');

-- ------------------------------ identity -----------------------------------
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);
-- Email is compared case-insensitively; the index is what enforces uniqueness.
create unique index users_email_idx on users (lower(email));

-- Opaque session tokens. The cookie carries the id; nothing is signed into it,
-- so revoking a session is a delete rather than a key rotation.
create table sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);
create index sessions_expiry_idx on sessions (expires_at);

-- ------------------------------ profiles -----------------------------------
create table profiles (
  id          uuid primary key references users on delete cascade,
  display_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table user_preferences (
  user_id       uuid primary key references users on delete cascade,
  theme         text not null default 'light' check (theme in ('light','dark')),
  weighted_score boolean not null default true,
  goal_weight   numeric(6,2),
  -- Language is a presentation preference, so it is one column here rather than
  -- a duplicated set of rows anywhere. 'both' renders every label twice over.
  locale        text not null default 'en' check (locale in ('en','zh','both')),
  week_starts_on smallint not null default 0 check (week_starts_on between 0 and 6),
  updated_at    timestamptz not null default now()
);

-- -------------------------------- goals ------------------------------------
create table goals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users on delete cascade,
  name       text not null,
  area       text,
  why        text,
  target_date date,
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_user_idx on goals (user_id) where not archived;

-- -------------------------------- habits -----------------------------------
create table habits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users on delete cascade,
  name        text not null,
  description text,
  category    habit_category not null,
  kind        habit_kind not null default 'good',
  target      numeric(8,2),
  unit        text,
  weight      smallint not null default 2 check (weight between 1 and 3),
  start_date  date not null default current_date,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index habits_user_active_idx on habits (user_id, category) where active;

-- Schedules are versioned rather than overwritten: changing a habit from daily
-- to three-times-a-week must not rewrite last month's history.
create table habit_schedules (
  id             uuid primary key default gen_random_uuid(),
  habit_id       uuid not null references habits on delete cascade,
  user_id        uuid not null references users on delete cascade,
  mode           freq_mode not null default 'daily',
  days_of_week   smallint[] not null default '{0,1,2,3,4,5,6}',
  times_per_week smallint check (times_per_week between 1 and 7),
  effective_from date not null default current_date,
  created_at     timestamptz not null default now(),
  constraint days_valid check (mode <> 'days' or array_length(days_of_week,1) > 0),
  constraint times_valid check (mode <> 'times' or times_per_week is not null)
);
create unique index habit_schedule_version_idx on habit_schedules (habit_id, effective_from);

-- Many-to-many: one habit can serve more than one goal.
create table goal_habits (
  goal_id  uuid not null references goals on delete cascade,
  habit_id uuid not null references habits on delete cascade,
  user_id  uuid not null references users on delete cascade,
  primary key (goal_id, habit_id)
);
create index goal_habits_habit_idx on goal_habits (habit_id);

-- One row per habit per day, and only when it was actually done.
-- Absence of a row is a miss; nothing is written for a missed day.
create table habit_completions (
  id         uuid primary key default gen_random_uuid(),
  habit_id   uuid not null references habits on delete cascade,
  user_id    uuid not null references users on delete cascade,
  done_on    date not null,
  value      numeric(8,2),
  note       text,
  created_at timestamptz not null default now(),
  unique (habit_id, done_on)
);
create index completions_user_date_idx on habit_completions (user_id, done_on desc);

create table habit_stacks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users on delete cascade,
  trigger_habit_id uuid references habits on delete set null,
  trigger_text    text,
  new_habit_id    uuid references habits on delete set null,
  new_text        text,
  trigger_time    time,
  trigger_location text,
  created_at      timestamptz not null default now(),
  constraint stack_has_trigger check (trigger_habit_id is not null or trigger_text is not null),
  constraint stack_has_target  check (new_habit_id is not null or new_text is not null)
);
create index stacks_user_idx on habit_stacks (user_id);

create table habit_awareness_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users on delete cascade,
  logged_on  date not null default current_date,
  at_time    time,
  activity   text not null,
  duration   text,
  context    text,
  notes      text,
  grade      grade not null default 'neutral',
  promoted_habit_id uuid references habits on delete set null,
  created_at timestamptz not null default now()
);
create index awareness_user_date_idx on habit_awareness_entries (user_id, logged_on desc);

create table daily_metrics (
  user_id     uuid not null references users on delete cascade,
  metric_date date not null,
  weight      numeric(6,2),
  calories    int,
  sleep_hours numeric(4,2),
  water       int,
  cardio_minutes int,
  cardio_day  boolean not null default false,
  gym_day     boolean not null default false,
  source      text not null default 'manual',   -- 'manual' | 'apple_health' | 'wearable'
  updated_at  timestamptz not null default now(),
  primary key (user_id, metric_date)
);

create table day_notes (
  user_id  uuid not null references users on delete cascade,
  note_date date not null,
  body     text,
  updated_at timestamptz not null default now(),
  primary key (user_id, note_date)
);

create table weekly_reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users on delete cascade,
  week_start  date not null,
  went_well   text,
  got_in_way  text,
  focus_next  text,
  modify      text,
  add_or_drop text,
  stats       jsonb,                 -- snapshot of the week as reviewed
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, week_start)
);

-- --------------------------- updated_at trigger ----------------------------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','user_preferences','goals','habits','daily_metrics','day_notes','weekly_reviews']
  loop
    execute format(
      'create trigger %I_touch before update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

-- ------------------------------ new-user seed ------------------------------
-- The starter habits and goals used to live here as seed_new_user(), fired by a
-- trigger on auth.users. They moved to src/lib/seed.ts: the names have to be
-- translated per account, and deriving 'avoid' from an English name prefix
-- stopped working once they could be Chinese. The sign-up route inserts them
-- inside the same transaction that creates the user, so the guarantee is
-- unchanged — no account exists half-seeded.

-- ------------------------------ derived views ------------------------------
-- The schedule in force on a given date.
create or replace function schedule_on(p_habit uuid, p_date date)
returns habit_schedules language sql stable as $$
  select * from habit_schedules
  where habit_id = p_habit and effective_from <= p_date
  order by effective_from desc limit 1
$$;

-- Which habits were scheduled on which days, expanded per user per date.
create or replace function scheduled_habits(p_user uuid, p_from date, p_to date)
returns table (habit_id uuid, on_date date, weight smallint, completed boolean)
language sql stable as $$
  with days as (select generate_series(p_from, p_to, interval '1 day')::date d),
  sched as (
    select h.id, h.weight, d.d,
           (schedule_on(h.id, d.d)).mode           as mode,
           (schedule_on(h.id, d.d)).days_of_week   as dow,
           (schedule_on(h.id, d.d)).times_per_week as tpw
    from habits h cross join days d
    where h.user_id = p_user and h.active and h.start_date <= d.d
  )
  select s.id, s.d, s.weight, c.id is not null
  from sched s
  left join habit_completions c on c.habit_id = s.id and c.done_on = s.d
  where s.mode = 'daily'
     or (s.mode = 'days'  and extract(dow from s.d)::smallint = any(s.dow))
     or (s.mode = 'times' and (
           c.id is not null
           or (select count(*) from habit_completions x
               where x.habit_id = s.id
                 and x.done_on >= date_trunc('week', s.d + 1)::date - 1
                 and x.done_on <= s.d) < s.tpw))
$$;

-- Daily weighted habit score. Nothing about this is stored.
create or replace function daily_scores(p_user uuid, p_from date, p_to date)
returns table (on_date date, scheduled int, completed int, score numeric)
language sql stable as $$
  select on_date,
         count(*)::int,
         count(*) filter (where completed)::int,
         round(100.0 * coalesce(sum(weight) filter (where completed), 0) / nullif(sum(weight), 0), 0)
  from scheduled_habits(p_user, p_from, p_to)
  group by on_date order by on_date
$$;
