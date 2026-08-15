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
create type user_role      as enum ('user', 'admin');
-- §14. A habit's life, which a boolean could not hold: the survey needs
-- somewhere to put a suggestion the user has not accepted yet, and retiring an
-- established habit must not look the same as pausing a struggling one.
-- §12. How a habit is measured. A tracker that assumes every habit is a
-- checkbox cannot express "six of eight glasses" or "under an hour", and
-- pretending it can is what makes tracking feel dishonest.
create type tracking_type  as enum (
  'boolean',    -- did it / didn't
  'count',      -- 2 of 2
  'duration',   -- 20 of 30 minutes
  'quantity',   -- 6 of 8 glasses
  'interval',   -- moved 5 times today
  'maximum',    -- stayed under the limit
  'avoidance'   -- successfully didn't
);

create type habit_status   as enum (
  'candidate',    -- a behaviour the user named, not yet a habit
  'recommended',  -- proposed by the coach, awaiting the user's decision
  'planned',      -- accepted, not started
  'active',       -- on the sheet and being tracked
  'paused',       -- temporarily off the sheet, history kept
  'established',  -- holding on its own; no longer needs daily attention
  'retired'       -- deliberately stopped
);

-- ------------------------------ identity -----------------------------------
create table users (
  id            uuid primary key default gen_random_uuid(),
  -- Nullable: a managed account may be identified by username alone. One of
  -- the two must be present, which the check below enforces.
  email         text,
  -- Lowercase, 3-30 chars, no '@' — see src/lib/identity.ts. Nullable, because
  -- an account that signed itself up has an address and needs no second name.
  username      text,
  password_hash text not null,
  -- Set by `npm run admin:grant` or by an existing admin through the admin API,
  -- which checks the caller's own role against this column on every request.
  -- Nothing a non-admin can call touches it.
  role          user_role not null default 'user',
  -- Null means active. A disabled account keeps all its data and can be turned
  -- back on; it simply stops resolving to a session, so every protected route
  -- and every API call refuses it.
  disabled_at   timestamptz,
  -- Set when an admin issues a temporary password. The app makes the user
  -- choose their own before it will let them anywhere else.
  must_change_password boolean not null default false,
  /*
   * Where this account came from, recorded when it is made rather than guessed
   * later: 'self_signup' from the public form, 'admin' from Admin -> Users,
   * 'test' from the throwaway test instance. Null on rows that predate the
   * column — those are honestly unclassified, and the admin screens say so
   * rather than pretending an email pattern is evidence.
   */
  created_via   text check (created_via in ('self_signup','admin','test')),
  created_at    timestamptz not null default now(),
  -- An account nobody can name is an account nobody can sign in to.
  constraint users_identified check (email is not null or username is not null)
);
-- Email is compared case-insensitively; the index is what enforces uniqueness.
create unique index users_email_idx on users (lower(email));
-- Usernames are compared lowercased, so uniqueness has to be too.
create unique index users_username_idx on users (lower(username));

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
  -- As for habits: set on seeded goals, cleared when the user renames one.
  template_key text,
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
  -- The English wording, kept readable for psql and as a fallback. It is NOT
  -- the display value for a seeded habit: see template_key.
  name        text not null,
  -- Set only on habits this app seeded. The interface renders the translation
  -- for this key instead of `name`, so starter habits follow the reader's
  -- language. Cleared the moment the user renames the habit, after which their
  -- text is canonical and is never translated.
  template_key text,
  description text,
  category    habit_category not null,
  kind        habit_kind not null default 'good',
  tracking_type tracking_type not null default 'boolean',
  -- §20. Two versions of the same habit. The minimum is what still counts on a
  -- bad day; the target is what a good day looks like. Kept apart so a small
  -- win can count without pretending the full target was reached.
  minimum     numeric(8,2),
  target      numeric(8,2),
  unit        text,
  -- §11/§22. How the habit is set up to actually happen. Free text on purpose:
  -- these are the user's own arrangements, not something to enumerate.
  anchor      text,   -- "after I pour my morning coffee"
  environment text,   -- what they changed to make it easier
  friction    text,   -- what they put in the way of the old behaviour
  weight      smallint not null default 2 check (weight between 1 and 3),
  start_date  date not null default current_date,
  -- Only 'active' habits appear on Today and count towards the score. The other
  -- statuses are what let the survey propose without imposing: nothing reaches
  -- the sheet unless the user puts it there.
  status      habit_status not null default 'active',
  -- §10. When a habit is proposed to replace a behaviour the user named, the
  -- link is kept rather than the old behaviour being deleted. The pair —
  -- what they do now, and what they mean to do instead — is the thing worth
  -- coaching against later.
  replaces_habit_id uuid references habits on delete set null,
  -- §18. Why this was suggested, in the user's own language. Only ever set on
  -- habits the coach proposed; a recommendation the user cannot interrogate is
  -- not one they can meaningfully approve.
  rationale   text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index habits_user_active_idx on habits (user_id, category) where status = 'active';
create index habits_replaces_idx on habits (replaces_habit_id) where replaces_habit_id is not null;

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


-- ===========================================================================
-- Product usage analytics
--
-- Kept conceptually apart from habit data. These tables answer "is anyone
-- using this, how, and do they come back" — never "what is this person's
-- life like". Nothing here stores a habit name, a note, a metric value or a
-- goal description; entity_id is a bare uuid so a row can be counted and
-- joined but not read for its content.
-- ===========================================================================

-- `user_id` is nullable and detaches rather than cascading: deleting a person
-- must not rewrite history that is only ever read in aggregate. See the
-- deletion strategy in README.
create table user_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references users on delete set null,
  started_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at         timestamptz,
  event_count      int not null default 0,
  device_type      text,          -- 'mobile' | 'tablet' | 'desktop' | null
  timezone         text,          -- IANA name, for local-time reporting
  created_at       timestamptz not null default now()
);
-- Finding the caller's open session is the hottest query in the tracker.
create index sessions_open_idx on user_sessions (user_id, last_activity_at desc);
create index user_sessions_started_idx on user_sessions (started_at);

create table analytics_events (
  id            bigserial primary key,
  -- Detaches on delete, like user_sessions: the event stays, the identity goes.
  user_id       uuid references users on delete set null,
  anonymous_id  text,            -- pre-signup, when there is no user yet
  session_id    uuid references user_sessions on delete set null,
  event_name    text not null,
  event_category text,
  feature       text,            -- the adoption bucket this rolls up into
  page          text,
  entity_type   text,
  entity_id     uuid,            -- an id only; never a name or a note
  properties    jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now(),
  user_timezone text,
  app_version   text,
  created_at    timestamptz not null default now()
);
create index events_user_time_idx on analytics_events (user_id, occurred_at desc);
create index events_time_idx on analytics_events (occurred_at desc);
create index events_name_idx on analytics_events (event_name, occurred_at desc);
create index events_session_idx on analytics_events (session_id);
create index events_feature_idx on analytics_events (feature, occurred_at desc);
-- Note: no index on occurred_at::date. Casting timestamptz to date is STABLE
-- rather than IMMUTABLE — it depends on the session TimeZone — so Postgres
-- refuses it in an index expression. The two indexes above already serve the
-- per-day counts, which are all range scans over occurred_at.


-- ------------------------------ habit library ------------------------------
-- §10–11. Curated habits a user can browse and adopt. Rows are the *catalogue*,
-- shared by everyone and owned by no one; adopting one copies it into `habits`
-- with its template_key, after which the user's copy is theirs to edit.
--
-- No display text here either: `key` resolves through the dictionaries, so the
-- library reads in whichever language the browser is using.
create table habit_library (
  key            text primary key,
  category       habit_category not null,
  kind           habit_kind not null default 'good',
  life_domain    text,             -- §18: health, career, learning, money, …
  tracking_type  text not null default 'boolean',  -- §19
  suggested_weight   smallint not null default 2 check (suggested_weight between 1 and 3),
  -- §20. The minimum is the version that still counts on a bad day; the target
  -- is what a good day looks like. Kept apart on purpose.
  suggested_minimum  numeric(8,2),
  suggested_target   numeric(8,2),
  suggested_unit     text,
  suggested_frequency freq_mode not null default 'daily',
  sort_order     int not null default 0
);
create index habit_library_category_idx on habit_library (category, sort_order);

-- ---------------------------- spending awareness ---------------------------
-- §17/§27. Deliberately not a habit. "Did you record your spending" could be a
-- boolean habit, but what was spent is an outcome, and forcing it into a
-- checkbox would lose the only part worth looking at.
--
-- Categories are stored as English keys and translated on render, the same way
-- goal areas are, so an existing row keeps matching after a language change.
create table spending_records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users on delete cascade,
  spent_on    date not null default current_date,
  -- Currency-agnostic on purpose: the module is about proportion and
  -- awareness, and a single user's own numbers compare fine to each other.
  amount      numeric(12,2) not null check (amount >= 0),
  description text,
  category    text not null default 'other',
  -- §27. Two separate judgements, both the user's own.
  need_want   text not null default 'need' check (need_want in ('need','want')),
  planned     boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now()
);
create index spending_user_date_idx on spending_records (user_id, spent_on desc);

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
    -- §14. `active` is the status now; the boolean column it replaced is gone.
    where h.user_id = p_user and h.status = 'active' and h.start_date <= d.d
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

-- ---------------------------- account setup links --------------------------
-- An admin-created account starts with no password the admin has seen. The
-- setup link is the preferred route: a single-use token the admin hands over,
-- which lets the person choose their own password. No mail is sent because this
-- deployment has no mail transport — pretending otherwise would silently strand
-- every account created this way.
create table user_invites (
  token       uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users on delete cascade,
  created_by  uuid references users on delete set null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index user_invites_user_idx on user_invites (user_id);

-- ------------------------------- audit log ---------------------------------
-- Who did what to whom. Both sides are recorded as text as well as by id,
-- because the log has to survive the deletion of either party — an entry that
-- says "someone deleted someone" is not an audit log. It never records a
-- password, a token, or anything the user wrote.
create table admin_audit_log (
  id           bigserial primary key,
  admin_id     uuid references users on delete set null,
  admin_email  text not null,
  target_id    uuid references users on delete set null,
  target_email text,
  action       text not null,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index admin_audit_log_created_idx on admin_audit_log (created_at desc);
