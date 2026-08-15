# Rich Habits

A habit system rather than a checkbox list: notice the day you actually have, grade it,
pick a few habits to change, track them in phases, and review what the data says.

Bilingual — English and 简体中文, switched from **EN | 中文** in the header. A third option, 双语,
renders every label in both at once for a screen two people share.

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

   Every variable is documented in `.env.example`, which is the only env file in git.
   All of them are server-only — there is not a single `NEXT_PUBLIC_*` in this project,
   because the browser needs no configuration; it only calls same-origin `/api` routes.
   `src/lib/env.ts` is the one module that reads `process.env`.

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
| `npm test` | Vitest — 111 tests: engine, validation, throttle, TLS, i18n, library, analytics, spending, coach |
| `npm run admin:grant` | `-- <email>` to grant admin, `--revoke`, or `--list` |
| `npm run db:dev` | Local Postgres (WASM) on :5433, no Docker needed |
| `npm run db:setup` | Apply `db/schema.sql` to a fresh `DATABASE_URL`. Idempotent |
| `npm run db:migrate` | Bring an existing database up to date. Idempotent |

## How it's organised

```
src/
  lib/
    dates.ts        Date maths. Weeks run Sunday to Saturday.
    types.ts        The client-side shape of everything.
    habits.ts       The engine: scheduling, scoring, streaks, stats. Pure functions, no I/O.
    coach.ts        Context builder for the AI coach + data-only suggestions.
    i18n/           en.ts, zh.ts, locale resolution, the LocaleProvider.
    analytics/      config.ts (every threshold), track.ts, queries.ts.
    admin.ts        The role check. 404s, so /admin is not discoverable.
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
                    awareness, stacks, metrics, reviews, spending, prefs
    (app)/more/refine  Behaviours to change, and the backlog they wait in
    api/coach/      The AI coach, against the OpenAI Responses API
  middleware.ts     Cookie presence only; validity is decided against the database
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

**EN | 中文 sits in the header on every screen.** Switching is instant — the dictionary is swapped in
React state, so nothing reloads, no scroll position is lost and no half-typed input is thrown away.
A third option, 双语, shows both languages on every label at once.

Where the choice lives, and why in three places:

| Layer | Holds | Why |
|---|---|---|
| React state | what you see now | instant switching, no reload |
| `rh_locale` cookie | next request | the server can read it before any query, so the first paint is right |
| `user_preferences.locale` | the account | follows you to another device |

The cookie decides the first paint; the stored preference wins once state loads. A visitor with no
cookie gets their browser's `Accept-Language`, and an explicit choice always beats browser detection.
Language is one column — no user, habit, completion or analytics row is duplicated per language.

Every string lives in `src/lib/i18n/en.ts` under semantic keys (`nav.today`, `common.save`), and
`zh.ts` is typed as `Dict` — a missing key fails the build. `both.ts` is *derived* by walking the two
together, so it cannot fall behind them. Adding Japanese means adding one file and one entry in
`LOCALES`; no component changes.

Consequences worth knowing:

- **Values are interpolated once, not twice.** Anything with a number or a name in it is a function,
  not concatenation at the call site — `"3 days running"` cannot be assembled from parts that work in
  both languages. Functions that mention a category or a unit take a *key* and resolve their own
  language's word, or the bilingual mode renders it twice over.
- **User text is never translated.** Rename a habit in English, switch to Chinese, and it stays as
  you wrote it. Goal *areas* are the exception: the English key is stored and translated on render,
  so existing rows keep matching.
- **Seeded habits are keyed, not stored as text.** `habits.template_key` holds `read_for_learning`;
  the display name is resolved from the dictionaries at render time, so starter habits follow the
  reader's language instead of being frozen into whichever one the account signed up in. `name`
  keeps the English wording so a row is still readable in `psql` and so anything bypassing the
  resolver degrades to English rather than to a bare key.
- **A key means ours, no key means theirs.** Rename a seeded habit and its key is dropped — from
  then on it is your text and is never translated, even if you type the original wording back.
  `src/lib/templates.ts` is the whole rule. Units and goal names work the same way; goal *areas*
  store an English key and are translated on render.
- **The AI coach is told the locale** and answers in it; the analysis and the numbers are identical
  either way, because `habits.ts` and `correlate.ts` contain no language at all.
- **Server-side messages are localised too** — sign-in failures, sign-up validation, the generic save
  failure and the coach's own errors all come from the dictionary.
- **Dates go through `Intl`** with an explicit tag (`en-US` / `zh-CN`), never the system locale.

### The habit lifecycle

`docs/RICH_HABITS_REFERENCE.md` is the canonical product reference. Two pieces of
it shape the schema:

**A starter sheet of ten** (§3), not sixteen. It has to be readable on the first
morning; the personalisation survey is what grows it. All ten are habits to
build — the "avoid" ones live in the library until someone chooses them.

**A status, not a boolean** (§14). `habits.status` is one of `candidate`,
`recommended`, `planned`, `active`, `paused`, `established`, `retired`. Only
`active` reaches Today and the score. This is what a boolean could not express:
the survey needs somewhere to put a habit it is *proposing*, so that nothing
lands on the sheet without the user putting it there (§12), and retiring a habit
you have outgrown should not look like pausing one you are struggling with.
Every status keeps the habit and its full history.

`habit_library` (§10–11) is the catalogue: shared, owned by nobody, and carrying
suggested defaults — tracking type, minimum, target, unit, life domain. Adopting
one copies it into your own habits, after which the copy is yours and the
catalogue no longer touches it. Like starter habits, library entries are keyed,
so the catalogue reads in whichever language you are using.

### How a habit is measured

Not every habit is a checkbox (§12). `habits.tracking_type` is one of `boolean`,
`count`, `duration`, `quantity`, `interval`, `maximum` or `avoidance`, and Today
renders accordingly: a yes/no habit keeps its tick, a numeric one gets a stepper
and reads `4 / 8 glasses`, and a `maximum` habit reads `under 1 hr` because it
succeeds by staying below its target rather than reaching it.

**A minimum and a target are different bars** (§20). The minimum is what still
counts on a bad day; the target is what a good day looks like. Four glasses of
eight is *done*, labelled `Minimum` — the day counts without pretending the
target was reached.

Crucially, **whether a day counts is derived, not stored**. The completion row
records what happened; comparing it to the habit's bar answers whether that was
enough. That keeps "minimum met" and "target met" as separate questions (§39),
and means the definition can change without a migration. `db/queries.ts` is
authoritative; the store mirrors it so an optimistic tap doesn't flash as
complete before the next load disagrees.

`anchor`, `environment` and `friction` (§11, §22) are free text — the user's own
arrangements, not something to enumerate. The anchor appears on the Today row,
where it does its work, rather than only in the editor.

### Behaviours, candidates, and the sheet

`More → Refine my habits` is where someone names what they'd like to change
(§5). Three rules from `CLAUDE.md` §8 shape it, and they are worth stating
because breaking any one of them makes the feature dishonest:

- **Their wording is stored verbatim**, with no template key, so it is never
  translated or rephrased. "I sit for hours without moving" stays exactly that
  in both languages.
- **Nothing reaches the sheet without being put there.** Everything captured is
  a `candidate`: absent from Today, absent from the score, absent from My
  Habits. Activating is a separate, deliberate tap.
- **A behaviour is not yet a habit.** "I sit for hours" is an observation, not
  something with a schedule. Turning it into something trackable is the next
  step, not an automatic one.

My Habits shows the sheet; the backlog lives here. That separation is what lets
the coach propose things without imposing them.

**Suggest replacements** asks for one habit per named behaviour (§8–10). Three
things make a proposal something you can actually judge:

- **It is a proposal, never a change.** Every suggestion arrives as
  `recommended` and sits in the backlog. Nothing it produces can alter a habit
  you already have.
- **The original behaviour is kept.** `replaces_habit_id` links the new habit to
  what it replaces rather than deleting it. The pair — what you do now, and what
  you mean to do instead — is the thing worth coaching against later.
- **It explains itself.** Each carries a rationale in your language. A
  suggestion you cannot interrogate is not one you can meaningfully approve.

`src/lib/recommend.ts` is the whole provider boundary, so the model can change
without the rest of the app knowing. No API key means no suggestions and nothing
else changes — tracking never depends on a model being reachable.

The screen is the selection workspace from §12, and it keeps four things apart
because they mean different things:

| Group | What it holds | Status |
|---|---|---|
| Behaviours I want to change | your own words, untracked | `candidate` |
| Recommended | the coach's proposals | `recommended` |
| From the library | templates you picked but haven't started | `planned` |
| My focus habits | what you actually track | `active` |

Adding from the library copies the template into your own row — keyed, so it
reads in either language — and lands it as `planned`. Anything already taken is
shown as such rather than offered twice. Above nine active habits the workspace
mentions pacing (§13); it is a sentence, not a limit, and the backlog keeps
whatever you leave there.

### Spending is not a habit

"Record what I spent" would make a fine checkbox, and that is exactly the problem: what was
spent is an outcome, and the only interesting part — where the money actually goes — does not
survive being flattened into done/not-done. So spending lives in its own table with its own
shape (amount, category, need or want, planned or not) and its own screen under **More →
Spending awareness**.

Two properties it keeps deliberately. It reports proportions and stops there — no budget, no
target, nothing coloured red; a module that scored people would become the opposite of awareness.
And amounts are currency-agnostic, because it only ever compares one person's numbers against
their own.

The month-over-month figure is real arithmetic on `YYYY-MM` strings rather than `Date.setMonth`,
which lands on March 3 when today is March 31 and would quietly compare a month against itself.
`src/lib/spending.ts` is pure and tested for exactly that.

Analytics see `spending_recorded` and nothing else — no amount, no description, no category.

### Signing out

The account section is the first card on **More**: which address you are signed
in as, when the account started, two counts, and — for an admin, decided by
`users.role` in the database — a link to the analytics. Sign out sits at the
bottom in a card of its own, a full-width row rather than a small button beside
"Export JSON", where it used to be indistinguishable from a settings action.
Nothing about it is red; signing out destroys nothing.

What happens when you confirm:

1. `POST /api/auth/signout` deletes the `sessions` row. That is the part that
   matters — the token becomes meaningless everywhere, including in any copy of
   the cookie that outlives the browser.
2. The cookie is expired by exactly one writer. `cookies().delete()` emitted
   `rh_session=; Path=/; HttpOnly` with **no `Max-Age`**, which is an empty
   *session* cookie rather than a deleted one, and setting it a second time in
   the route made it worse: two `Set-Cookie` values for one name, and whichever
   Next merged last won. `destroySession` now writes it once, explicitly expired.
3. The browser is sent to `/login` with `location.replace`, not `router.push`.
   Next keeps a client-side cache of rendered routes and React keeps the
   account's state in memory; a soft navigation leaves both, so Back could
   repaint the previous user's habits without asking the server anything.
4. Signed-in responses carry `Cache-Control: no-store`, set in middleware, so
   neither the HTTP cache nor bfcache can hand the page back afterwards.

The client never decides any of this. If the request fails, the app says so and
stays signed in rather than pretending.

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

### Admin analytics

`/admin` is a product-analytics tool for whoever owns the deployment. It is
deliberately outside the `(app)` group — no habit store, no tab bar, no language
switcher — because it answers a different question. The product tells the user
"how am I doing"; this tells the owner "is anyone using it, and do they come back".

**Access.** `users.role` is read from the database on every admin request, never
carried in the cookie or trusted from the client, so revoking someone takes effect
on their next request. A non-admin gets **404, not 403** — a signed-in user should
not learn that `/admin` exists. Every page and route re-checks; the layout guard is
convenience, not the boundary. There is **no API that can write a role**: granting
admin is `npm run admin:grant -- you@example.com`, run against the database.

> The brief asked for Supabase row-level security here. Supabase was removed
> earlier, so the equivalent is: the role check above, plus the per-request user
> scoping every other query already uses. No service-role credential exists to
> leak, because there is no service role — the app has one database user and the
> browser never sees `DATABASE_URL`.

**Privacy is a design constraint, not a policy.** The events table has no column
that can hold a habit name, a note, a metric value or goal text. `entity_id` is a
bare uuid; `properties` passes through a sanitiser that keeps numbers, booleans and
short enum-like strings and **drops everything else** — a truncated note is still a
note. The admin user profile shows counts and dates only. Seeing someone's actual
content would need a separate, explicitly authorised and audited tool.

**How events get recorded.** One layer, `trackEvent`, called from the API routes —
not scattered through React components. Every meaningful action already crosses the
API, so that is where the instrumentation lives. It is wrapped in a try/catch and
tested: if the events table is unreachable, checking off a habit still succeeds.

**Sessions** are derived, not polled. A run of activity with no gap longer than 30
minutes is one session; nothing writes on a timer, so a long reading session costs
one row rather than one per few seconds.

**Timestamps** are stored in UTC. Hour-of-day and day-of-week reporting converts
per row using the timezone the event itself carried (`occurred_at at time zone …`),
falling back to UTC rather than dropping the row.

**Nothing is flattered.** A cohort week that has not happened yet renders as `—`,
never 0%. Retention counts only users old enough to have had the chance to return.
Activation counts only accounts past the window. All thresholds live in
`src/lib/analytics/config.ts`.

### One thing worth not re-breaking

Middleware runs on the edge runtime, so it cannot open a database connection: it
can only see that a session cookie *exists*. The app layout checks whether the
session behind it is *valid*. If both act on their own answer, a cookie that
exists but no longer resolves — an expired session, a revoked one, a rebuilt
database — makes `/today` redirect to `/login` and `/login` redirect back,
forever. That is `ERR_TOO_MANY_REDIRECTS`, and it would reach every user
eventually, because sessions expire after 30 days.

So there is exactly one place that decides whether someone is signed in: the
login page, against the database. Middleware only redirects signed-*out* traffic
away from private paths, which it can do safely from cookie presence alone.

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
grading · habit stacking · spending awareness · weekly review, stored per week · light and dark ·
mobile-first.

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

- `npm test` — 111 tests: the habit engine (scheduling in all three frequency modes, weighted vs
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
- **The admin flow end to end, 35 checks**: a user signs up, creates and completes a habit and
  returns in a new session; `habit_created`, `habit_completed` and `app_opened` are recorded against
  one session whose event count accumulates; the habit's *name* appears nowhere in the events table;
  events carry a local timezone. That user then gets 404 on `/admin`, `/admin/users`,
  `/admin/retention` and `/admin/system`, sees no admin link, and cannot change their own role by
  posting one. A granted admin loads every admin page, sees the user listed with real counts, and
  sees no habit names on the users list, the feature table or the usage profile.
- Cross-account writes, exercised over HTTP against a running server: an account posting another
  account's habit id is refused 404 and the victim's name, schedule and completions are unchanged;
  attaching a habit to someone else's goal is refused; a habit stack pointing at someone else's
  habit is refused.
- Malformed bodies return 400 with a readable message (`category must be one of morning, daytime,
  nighttime`), and a server-side failure returns a fixed string rather than the Postgres error.
- `/api/health` returns `{ok: true, db: "up"}` and 503 when the database is unreachable.
- Every session-cookie state resolves in a single redirect: a session that no longer exists, a
  malformed cookie and an empty cookie all land on the login form, while a valid session still
  reaches `/today` and a signed-in visitor to `/login` is sent on.
- **The acceptance journey, end to end in a browser at 390px**, twenty checks: signed-out visitor
  redirected → account created and seeded with 16 habits and 3 goals → new habit created, scheduled
  daily, given a target, priority and goal → appears on Today → one tap checks it off and the score
  moves 0% → 8% → an amount and a note logged against it → the completion shows in the seven-day
  grid and the weekly summary → **a brand-new browser context signs back in and everything survived**
  (habit, completion, value, note) → no shame-based wording anywhere on Today.
- No screen scrolls sideways at 320, 390, 768 or 1440px — all ten screens checked with data present.
- Behaviours to change, 16 checks in a browser: a captured behaviour is stored and shown verbatim,
  held as a candidate, and reaches neither Today nor My Habits; its wording survives a switch to
  Chinese while the screen around it translates; only an explicit "Put on my sheet" activates it;
  it persists across a new session; and the screen fits 320, 390 and 1440px. Analytics recorded
  `behaviour_captured` with none of the user's text.
- The starter sheet and lifecycle in a browser, 13 checks: a new account gets exactly ten habits,
  four/three/three across the day, all active; moving one to *established* removes it from Today
  and from the score while keeping the habit and its history; reactivating puts it back; and the
  whole sheet reads in Chinese.
- Switching EN → 中文 → EN in a browser, 24 checks: the eight starter habits named in the report
  render as 阅读学习 / 锻炼 / 规划今日优先事项 / 推进个人目标 / 避免一早查看邮件 /
  完成重要的目标相关工作 / 喝足够的水 / 避免垃圾食品 and back again; seeded units and goals switch
  too; a habit called "Practice violin" is untouched throughout; and renaming a seeded habit stops
  it translating while the others carry on.
- **Signing out, 46 checks in a browser, two users on one machine**: Alice creates
  a habit and a note, signs out, and her cookie is gone from the jar; replaying
  the token she had is refused 401 and cannot reach `/today`; Back does not
  repaint her habits or her notes; every protected route redirects; signed-in
  pages answer `no-store`. Bob then signs up in the same browser and no habit,
  note, row or email address of Alice's appears anywhere — and when Alice signs
  back in afterwards, her habit and her note are both still there. The control
  is a 77px full-width row in a card of its own, not red, not mixed in with
  settings; it confirms first, names the account, and promises the history is
  kept; cancelling leaves the session untouched. All of it again in Chinese
  (退出登录 / 账户 / 注册于 / 进行中的习惯), with the email address untranslated,
  and visible with no sideways scroll at 320, 390, 768 and 1440px.
- The admin entry, 7 checks: invisible to an ordinary user, who also gets 404
  from `/admin`; it appears after `users.role` is set to admin in the database
  and opens the analytics; revoking removes both again. The link is rendered
  from the role read server-side, and `/admin` re-checks for itself regardless.
- **Spending awareness, 38 checks in a browser**: three purchases of 60 / 30 / 10 report a 100.00
  total with food at 60.0%, transport 30.0% and entertainment 10.0%, ordered largest first; the
  unplanned and wants shares are computed separately and both land on 10.0%; with no prior month it
  says so rather than inventing a comparison; a negative amount and an absurd one are both refused
  400; removing a record survives a reload; the whole screen reads in Chinese while the user's own
  "Groceries" stays exactly as typed; and nothing on the page is red or judging. Checked directly
  against the events table afterwards: every `spending_recorded` row has empty properties, and no
  row anywhere mentions an amount or a description.
- `npm run db:migrate` backfilled 42 template keys on the existing database — ids, completions,
  schedules and goal links untouched — and is a no-op on the second run.
- Bilingual rendering in a real browser: every label carries both languages, nothing overflows its
  container and the page does not scroll sideways at 420px. Sign-up seeds the 16 starter habits with
  bilingual names, and the coach answers in English and then Chinese while quoting habit names as
  stored — correctly noting that one day of data establishes no pattern. Switching to `中文` or
  `English` in More narrows the interface and leaves habit names as written.
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
