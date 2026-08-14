# Rich Habits

A habit system rather than a checkbox list: notice the day you actually have, grade it,
pick a few habits to change, track them in phases, and review what the data says.

Bilingual — English and 简体中文.

Next.js 14 (App Router) · TypeScript · Tailwind · Render Postgres via `pg`, behind the app's own API layer.

## Getting it running

1. **Get a Postgres.** Either `docker compose up -d`, which applies `db/schema.sql` on first
   boot, or — with no Docker installed — `npm run db:dev`, which runs Postgres compiled to WASM
   on port 5433 and persists to `.pgdata/`. Both speak the real wire protocol, so the app can't
   tell the difference.

2. **Set your environment.**
   ```bash
   cp .env.example .env.local
   # local:  DATABASE_URL=postgresql://richhabits:richhabits@localhost:5432/richhabits
   # Render: paste the External Connection String
   ```

3. **Apply the schema** — only needed if you didn't use `docker compose` or `npm run db:dev`:
   ```bash
   npm run db:setup          # no psql required
   ```
   This creates every table, the indexes and constraints, and `seed_new_user()`, which gives each
   new account a set of starter habits and goals — all editable, none hard-coded into the app.

4. **Install and run.**
   ```bash
   npm install
   npm run dev            # http://localhost:3000
   ```

5. **Sign up** at `/login` with an email and a password of at least 8 characters. The account is
   created and seeded in one transaction, and you land on `/today` signed in.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit`, strict mode |
| `npm run lint` | ESLint via `next lint` |
| `npm test` | Vitest — 67 tests: habit engine, validation, throttle, TLS, i18n parity, coach contract |
| `npm run db:dev` | Local Postgres (WASM) on :5433, no Docker needed |
| `npm run db:setup` | Apply `db/schema.sql` to `DATABASE_URL`. Idempotent |

## How it's organised

```
src/
  lib/
    dates.ts        Date maths. Weeks run Sunday to Saturday.
    types.ts        The client-side shape of everything.
    habits.ts       The engine: scheduling, scoring, streaks, stats. Pure functions, no I/O.
    coach.ts        Context builder for the AI coach + data-only suggestions.
    i18n/           en.ts, zh.ts, locale resolution, the LocaleProvider.
    seed.ts         The starter habits, per language.
    auth.ts         Password hashing, session rows, the session cookie.
    throttle.ts     Failed sign-in limiter, in memory.
    http.ts         ApiError + field checks. No Next, no pg — importable anywhere.
    validate.ts     Every request body parsed into the shape SQL expects.
    api.ts          The guard every data route shares.
    db/pool.ts      The pg pool. DATABASE_URL is read here and nowhere else.
    db/queries.ts   The only file that knows SQL exists. Server-only.
    db/index.ts     The browser's half: one fetch per operation, no credentials.
  components/
    store.tsx       Loads state once, applies changes optimistically, rolls back on failure.
    ui.tsx          Sheet, Field, Segmented, ScoreDial, Heatmap, Spark, Bars.
    AppShell.tsx    Header, tab bar, theme, save indicator, error banner.
    screens/        One file per screen. They read the store; they never touch the API directly.
  app/
    (app)/          Authenticated routes: today, habits, week, insights, more/*
    login/          Password sign-in and sign-up
    api/auth/       signup, signin, signout
    api/health/     Liveness + a real database round-trip, for Render
    api/state/      The whole account in one read
    api/*/          One route per resource: habits, completions, goals, notes,
                    awareness, stacks, metrics, reviews, prefs
    api/coach/      The AI coach, against the OpenAI Responses API
  middleware.ts     Cookie check, redirects signed-out visitors to /login
db/schema.sql
docker-compose.yml   Local Postgres, schema applied on first boot
render.yaml          Blueprint: web service + database
tests/               habits · validate · throttle · coach
```

### Two decisions worth knowing about

**Misses are never stored.** A completion row exists only when something was done; absence is a
miss. Nothing derived — score, streak, consistency, perfect days — is stored either. It's all
computed from completions on read, and `daily_scores()` in the schema does the same in SQL so a
future native client gets identical numbers without a second implementation to keep in sync.

**Schedules are versioned.** `habit_schedules` rows carry `effective_from`, so changing a habit
from daily to three-times-a-week doesn't silently rewrite what last month was supposed to look like.

### Languages

Every string lives in `src/lib/i18n/en.ts`, and `zh.ts` is typed as `Dict` — a missing or misspelled
key fails the build rather than leaving a blank on someone's screen. A test also checks that no
Chinese value is still English, and that interpolated numbers and habit names survive translation.

Anything with a value in it is a function, not string concatenation at the call site: word order
differs, and `"3 days running"` cannot be assembled from parts that work in both languages.

A few things follow from that:

- **The locale is resolved on the server**, from the `rh_locale` cookie and then `Accept-Language`,
  and passed into the tree — so the first paint is already correct and there's no flash of English.
  Someone opening the link from a Chinese browser lands in Chinese without being told to change
  anything.
- **New accounts are seeded in the language they signed up in.** That's why the starter habits moved
  out of SQL into `src/lib/seed.ts` — and why `kind` is now stated outright instead of inferred from
  an English name prefix (`Avoid…`/`Limit…`/`Skip…`), which silently stopped working once the names
  could be Chinese.
- **Habit names are user data and are never translated.** Rename a habit in English, switch to
  Chinese, and it still reads as you wrote it. Goal *areas* are the exception: the English key is
  stored and translated on render, so old rows keep matching.
- **The coach answers in the user's language**, and is told to quote habit names as written rather
  than translating them.
- Dates go through `Intl` with an explicit tag (`en-US` / `zh-CN`), not the system locale — the
  browser's language and the one chosen in the app are often not the same.

### How access control works

There is no row-level security any more — it keyed off `auth.uid()`, which only exists inside
Supabase. The equivalent now lives in the API layer, and it is worth knowing the shape because
getting it subtly wrong is easy:

- The user id comes from the session cookie, in `withUser`. No route reads one from a body or a
  query string, so a request cannot name a different user.
- **Ownership is established once per write, before any statement runs.** A `where user_id = $n`
  on each statement is not sufficient on its own. An upsert whose guard sits in its `do update`
  branch is a no-op on conflict but still *inserts* when nothing conflicts, and a child-table
  insert naming a parent id has no guard at all. Both were reachable in an earlier draft: a
  request could rewrite another account's habit schedule, or attach another account's habit to
  its own goal. `assertOwns` / `assertRef` in `db/queries.ts` close that, and the checks run
  inside the same transaction as the write.
- A row owned by someone else returns the same `404 Not found` as a row that doesn't exist, so
  the API can't be used to probe which ids are real.
- Deletes stay idempotent — deleting something already gone is a 200, because the store applies
  changes optimistically and rolls back on error, and a double-click shouldn't read as a failure.

Every request body goes through `validate.ts` first. That is not decoration: without it a
malformed field reached Postgres and came back as a 500 carrying a constraint name.

### The AI coach seam

**Ask Rich Habits** on the Insights screen sends only the question. `/api/coach` re-reads the
account, builds the picture with `coach.buildContext` — per-habit stats by phase, goal linkage,
metrics, recent reviews — and answers from that, so the context can't be shaped from the browser.

Set `OPENAI_API_KEY` to switch it on; `OPENAI_MODEL` overrides the default of `gpt-5.6-terra`.
Without a key the route returns 501 rather than pretending. Nothing in the app depends on a model
being reachable: `coach.suggestions(state)` produces its observations from the data alone, and
that section renders above the question box either way.

## What's built

Every screen is wired to the database, and there are no buttons that do nothing.

Today · My habits (create, edit, pause, delete) · seven-day phase checklist · analytics with a
17-week heatmap, per-habit trends and a sleep/next-day correlation · health metrics with week,
month and year trends · goals with supporting habits and progress · habit awareness log with
grading · habit stacking · weekly review, stored per week · light and dark · mobile-first.

Not built, deliberately: Apple Health. `daily_metrics.source` marks where synced rows would come
from and metrics write through a single function, so a sync job can fill the same rows later.

## Deploying to Render

`render.yaml` is a blueprint: **New → Blueprint** in the Render dashboard, pointed at this repo,
creates the web service and the Postgres together and wires `DATABASE_URL` between them.

What it sets up, and why:

- **`preDeployCommand: npm run db:setup`** applies `db/schema.sql`. The script checks for the
  `users` table first and exits quietly if the database is already set up, so it is safe on every
  deploy rather than just the first. `preDeployCommand` needs a paid instance type — on the free
  tier, delete that line and run `npm run db:setup` once from the service's Shell tab.
- **`healthCheckPath: /api/health`** does a real `select now()` rather than only proving the
  process is alive, so an instance that can't reach Postgres is taken out of rotation.
- **`OPENAI_API_KEY` is `sync: false`** — Render prompts for it in the dashboard and it never
  enters this file or git. Leave it unset and the coach returns 501; nothing else is affected.
- **TLS is worked out from the connection string.** Render's internal host
  (`dpg-xxxx-a`) doesn't speak TLS and the external one (`dpg-xxxx-a.oregon-postgres.render.com`)
  requires it — the difference is the dot. Override with `DATABASE_SSL=false` / `=require` or an
  `sslmode` parameter if you ever need to.

The schema needs **Postgres 13 or newer** and no extensions, so it requires no elevated
privileges. `npm run build` does not touch the database, so a build can't fail on a cold one.

## Verified, not assumed

- `npm test` — 22 tests: the habit engine (scheduling in all three frequency modes, weighted vs
  unweighted scoring, streaks continuing across an unchecked today, streaks breaking on a missed
  past day, best/worst habit selection, an account with no habits) and the coach wire contract.
- `npm run typecheck` — clean under `strict`.
- `npm run lint` — no warnings or errors.
- `npm run build` — 27 routes compile, and the build does not need a database.
- Against a real Postgres: `db/schema.sql` applies clean and creates 14 tables; `seed_new_user()`
  produces 16 habits, 3 goals, 16 schedules and 11 goal links; `daily_scores()` returns the same
  weighted numbers the TS engine does (4/6 → 67 on a day with a w3 and a w1 done out of w3+w1+w2
  scheduled), and day-of-week scheduling drops a Mon/Wed/Fri habit from a Tuesday.
- Against the built server talking to that database: sign-up sets an HttpOnly cookie and seeds the
  account in one transaction; a duplicate email differing only in case is rejected 409; a short
  password is rejected 400; `/api/state` returns the full account; writes to completions, notes,
  metrics, goals and reviews round-trip with dates as calendar strings and numerics as numbers;
  a second account sees only its own rows, and its attempts to complete or delete the first
  account's habit change nothing; sign-out makes `/api/state` and `/api/coach` return 401.
- `DATABASE_URL`, the session cookie name and `pg` itself are absent from every client chunk.
- Cross-account writes, exercised over HTTP against a running server: an account posting another
  account's habit id is refused 404 and the victim's name, schedule and completions are unchanged;
  attaching a habit to someone else's goal is refused; a habit stack pointing at someone else's
  habit is refused.
- Malformed bodies return 400 with a readable message (`category must be one of morning, daytime,
  nighttime`), and a server-side failure returns a fixed string rather than the Postgres error.
- `/api/health` returns `{ok: true, db: "up"}` and 503 when the database is unreachable.
- In a Chinese browser with no cookie: `/login` renders in Chinese, sign-up seeds the 16 starter
  habits with Chinese names, `<html lang>` is `zh-Hans`, dates read `8月13日星期四`, and the coach
  answers in Chinese — correctly hedging that one day of data establishes no trend. Switching to
  English from 更多 changes the interface and leaves habit names as written.
- The deploy path, rehearsed end to end: `npm ci` is in sync with the lockfile; `npm run build`
  succeeds with `DATABASE_URL` unset; `npm run db:setup` creates 14 tables on an empty database
  and is a no-op on the next two runs; and a production-mode boot on a non-default `PORT` serves
  `/login`, answers `/api/health`, 401s `/api/state`, and sets the session cookie
  `Secure; HttpOnly; SameSite=lax`.

- In a real browser (Chrome via Playwright, mobile viewport): a signed-out visit to `/today`
  redirects to `/login`; sign-up lands on `/today` with the 16 seeded habits across the three
  windows; ticking habits updates the score; `/insights` renders the heatmap, per-habit table and
  the data-only Patterns section; and "Ask Rich Habits" returns a grounded answer — on a
  one-day-old account it said the data was too thin to diagnose a pattern rather than inventing
  one. Sign-out returns to `/login`.
