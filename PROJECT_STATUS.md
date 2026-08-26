# RichHabit — project status

**Persistent handoff checkpoint.** Read this first when resuming; it is kept
current at each milestone. Last updated at the rolling-priorities milestone.

---

## ⛔ PAUSED HERE — Step 2: Configure the Resend DNS records in GoDaddy

The owner has **intentionally decided not to continue DNS/email configuration
right now** and will return to it later.

**On resume, continue from Step 2. Do not redesign or rebuild the
email-verification implementation — it is finished, tested and merged.**

---

## Do not change these

| Rule | Why |
|---|---|
| **DO NOT enable email verification until a real verification email has successfully arrived.** | With `REQUIRE_EMAIL_VERIFICATION=true` and no working transport, every new registration sits pending forever and the only symptom is sign-ups that never complete. |
| **DO NOT delete or reset existing users or their data.** | 9 active non-admin accounts + 1 admin exist in production with real history. |
| **DO NOT automatically delete pending/unverified accounts.** | Explicit owner decision — this stays manual. No sweeper, cron or scheduled job exists; keep it that way unless the owner asks. |
| **DO NOT commit API keys, passwords or other secrets.** | `.env*` is gitignored except `.env.example`, which carries names only. `.mail-outbox/` is gitignored because it contains live confirmation links. |
| **DO NOT force existing users through verification.** | They are grandfathered by column default — see below. |
| **`REQUIRE_EMAIL_VERIFICATION` must remain OFF.** | Verified set nowhere: absent from `render.yaml`, commented out in `.env.example`. |

---

## Current state

**Important Dates / 重要日程** — this milestone. Preceded by the rolling
priorities, the Today two-column layout and the admin role work.

### Important Dates — new

A small private calendar in Today's right rail, under Community Progress: the
trips, customer visits, deadlines and family occasions someone marks
themselves. Two months by default (this one and the next), navigable
backwards and forwards without limit.

- **Two dates and nothing else.** `important_dates` stores a title, a start, an
  inclusive end, a colour, an optional note and an optional kind. Which days an
  event occupies is derived by comparing the two dates — never stored per day —
  so a range crossing a month, a quarter or a year is the same row as any
  other. The same reasoning as the rolling post-it: nothing is ever copied.
- **The default window is an offset from today, not a stored month**, so it
  rolls forward on its own. A tab left open overnight re-checks the date when
  the window regains focus; nothing polls.
- **A range is one element.** Each week row lays its events into lanes
  (`layoutWeek`), so a five-day trip is a single bar spanning five columns and
  keeps its line across the week — not five marks that happen to be adjacent.
  Square ends mean "carries on past this row", round ends mean it really starts
  or ends there. Three lanes are drawn per row; a busier day says "+n" and its
  full list is one tap away.
- **Editing is one sheet.** An empty day opens a new event, a day with one
  event opens that event, a day with several lists them. Changing dates updates
  the row — the id is the identity — so a moved event never becomes two.
- **Private.** Never in Community Progress, never in another user's view, never
  read by an admin screen, and not a habit or a schedule. The analytics event
  carries a span in days and two booleans; no title, note or colour.
- **Deployable before its migration.** See below — this is the part worth not
  undoing.


### Earlier milestones

**Community Progress, password confirmation and usernames.** Preceded by
`0487b54` (email verification), `432c673` (the 50-user cap) and `28a1ec2` (the
RichHabit rebrand).

### Community Progress / 社区进步 — new

A live, month-to-date leaderboard at **Settings → Community Progress**
(`/more/community`), headed "**August · Live Ranking / 8月 · 实时排名**".

- **One definition of completion, not two.** The board calls the app's own
  `rangeScore()` / `isScheduled()` per user rather than reimplementing the
  rule in SQL. That is deliberate and worth not undoing: a `times`-per-week
  habit stays scheduled until the week's target is met, so it is
  path-dependent and cannot be expressed as `completed ÷ scheduled`; days with
  nothing scheduled are skipped rather than scored zero. A SQL rewrite would
  be a second definition that could disagree with a user's own analytics.
- **Unweighted for everyone.** `weighted_score` is a per-user preference, so
  honouring it would rank people by rules that differ between them. The screen
  says so, because the figure can differ from the weighted one elsewhere.
- **Eligibility:** any active account with at least one scheduled check-in this
  month — **admins included**. `RANKS_ON_LEADERBOARD` in `src/lib/community.ts`
  is deliberately a different rule from `OCCUPIES_A_SLOT` in
  `src/lib/db/capacity.ts`: the latter still exempts admins, so they consume
  none of the fifty early-access places. Admin governs permissions and
  capacity, never whether someone appears in their own progress.
- **Nothing is stored to serve it.** Recomputed from `habit_completions` on
  every visit behind a 60-second cache, so the order moves as people tick
  habits off and starts fresh on the 1st with no reset step.
- `community_month_scores` archives a finished month the first time anyone
  opens the new one — insert-only, `on conflict do nothing`, never read to
  build a live ranking. Losing every row would cost history and change no
  present number.
- **Privacy:** the board shows the **username and nothing else**.
  `displayName()` accepts only a username, so a real name or an email cannot
  reach it structurally; a test locks that shape in. `profiles` is not even
  joined.

### Usernames — every account now has one

- **The 9 grandfathered accounts were given generated defaults**
  `richhabituser01`–`richhabituser09` (the admin holds `01`). Derived from a
  counter, never from an email or a real name.
- **Backfilled with `where username is null`.** The two self-chosen names in
  production — `claire` and `emma` — were not touched, and all 11 are unique.
  Login was unaffected: all 9 have emails and could always sign in by email.
- **`claire` is intentionally username-only** (a family account with no email
  address). The `users_identified` constraint supports this. Do not "fix" it
  by adding an email.
- Editable at **Settings → Username / 用户名**. Uniqueness is enforced by the
  database (`users_username_idx` on `lower(username)`), not a read-then-write
  check. Renaming writes one column: the account uuid everything else
  references is untouched, so habits, history, score and rank cannot move.

### Change password — completed

The API and page already existed and were already safe. Added the missing
**confirm-new-password** field with match validation, and an entry at
**Settings → Change password**. The forced-change flow is unchanged: it still
redirects there and still lands on Today; only a user who arrived deliberately
gets a back link.

### ⚠️ Incident during this milestone — read before running any script

`npm run db:migrate` was run against **production Neon** while believed to be
local. Cause: `.env.local` line 6 is a commented-out local URL and line 33 is
the live Neon one; a hand-rolled regex matched the commented line. Effects were
additive only — created `community_month_scores`, filled 9 NULL usernames. No
habit, completion, goal, journal or spending row was read or written, and no
existing username was overwritten.

### Database safety guards — fixed

`assertLocalDatabase()` already existed but only `prune-test-accounts.mjs`
called it, so the other four scripts connected straight past it. Rather than
add the call in four places — which the next script would forget — the guard
now lives inside **`connect()`**, so every db script is protected by default:

- **Refuses any non-local database** unless `RH_ALLOW_REMOTE=1`, printing the
  host and database it declined and the exact command to use if you mean it.
- **Always announces the target** (`→ host/database`, plus `** REMOTE **`).
  The destination used to be invisible, which is how the wrong one goes
  unnoticed.
- Each caller names its action, so the refusal reads "Refusing to migrate the
  schema" rather than something generic.

**The documented production command in `render.yaml` now requires the flag:**

    RH_ALLOW_REMOTE=1 DATABASE_URL='postgresql://…' npm run db:deploy

Verified three ways: refused against Neon with no flag, proceeded against
127.0.0.1:5433, and the override let a non-local host through. Nothing in Neon
was touched by any of it.

Never parse `.env` by hand — use `loadEnv()`. The incident's root cause was a
hand-rolled regex matching a commented-out line.

### Local development is now separated from production — fixed

`.env.local` had production Neon active and the local database commented out,
so `npm run dev` read and wrote real users' rows. Two changes:

1. **`.env.local` swapped** — the local PGlite database (127.0.0.1:5433) is
   active; Neon's string is kept in the file but commented, with the command
   to use it deliberately. A timestamped `.env.local.bak.*` was left beside it.
2. **`databaseUrl()` refuses a remote database in development** —
   `src/lib/env.ts`, mirroring the script guard so there is one concept, not
   two. The error names the host and gives the two commands that fix it.
   **Skipped entirely when `NODE_ENV=production`**, so the deployed app is
   untouched; `tests/db-target.test.ts` pins that, because a guard that fired
   in production would be a worse failure than the one it prevents.

Development database, from nothing:

    npm run db:dev        # PGlite on 127.0.0.1:5433, no install, data in .pgdata/
    npm run db:deploy     # schema into it
    npm run dev

`RH_ALLOW_REMOTE=1` is the single escape hatch for both the app and the
scripts.

### 50-user early-access cap — implemented and tested

- `EARLY_ACCESS_USER_LIMIT`, default **50**, `0` = unlimited.
- Applies to **active, non-admin** accounts. **Admins are exempt.**
- One definition of "occupies a place" — `OCCUPIES_A_SLOT` in
  `src/lib/db/capacity.ts` — shared by sign-up, verification, re-enable and the
  admin dashboard, so the number displayed and the number enforced cannot drift.
- Enforced in the database: count and write happen in one transaction holding
  `pg_advisory_xact_lock` (transaction-scoped, so it survives a pooler in
  transaction mode — production connects through one).
- Disabling or deleting an account releases its place immediately.

### Registration and sign-in

- New sign-up collects **first name, last name, username, email, password,
  confirm password, and required acceptance of the Free Early Access
  disclaimer**. Username and email are each unique.
- **Sign in with either username or email**; the type is decided server-side
  from the value, and the failure message is generic so it cannot enumerate
  accounts.
- Accounts predating these fields keep their nulls and are never locked out.

### Email verification — implemented, switched OFF

- **`users.verification_required` decides per account**, stamped once at
  creation from `REQUIRE_EMAIL_VERIFICATION` and **never re-read from the
  environment**.
- **Existing accounts have `verification_required = false`** — this is the
  column default, which *is* the grandfathering rule. The migration
  deliberately backfills nothing; setting `email_verified_at = now()` on
  existing rows would record a verification that never happened.
- Admin-created accounts also get `false` — the admin is the vouching party.
- **A pending/unverified account consumes no slot.** It reserves its email and
  username only. Confirming the link is what activates it and takes one of
  the 50.
- **Concurrency-safe.** Redemption runs inside `withCapacityLock` — the same
  advisory lock, predicate and transaction as sign-up — and answers 409 rather
  than letting the platform exceed the limit. The refused token is left
  **unconsumed**, so the same link works once a place frees up.
- The link is redeemed by **POST from a button**, not GET, because mail filters
  and link-preview bots fetch every URL in a message and a GET would be spent
  by a scanner before the recipient ever clicked.
- Only the **SHA-256 of the token** is stored (`email_verifications` table).
- Resend endpoint answers identically whether or not the account exists, and
  only ever mails the address already on the account.
- `MAIL_OUTBOX_DIR` writes the real composed message to a file instead of
  sending — how the flow is tested with no provider. **Never set in production.**

### What was verified

- **76 browser checks** over the whole flow (`scratchpad/verifyflow.mjs`),
  against real Postgres and real Chrome — including a grandfathered account
  signing in by email *and* by username while verification was on.
- **44 checks** on the race (`scratchpad/verifyrace.mjs`): 6 simultaneous
  confirmations against 1 free place, 4 rounds — **exactly one winner each
  round, five 409s, count never above the limit.**
- **251 unit tests**, typecheck, lint, production build — all green.
- **Migration rehearsal** from the previously committed schema with planted
  pre-existing accounts: additive, idempotent, existing rows untouched.
- The 21 pre-existing browser suites still pass.

### Architectural decisions worth not re-litigating

1. **Grandfathering by column, not by backfill.** The predicate reads
   `verification_required`, never the env var, so it is a constant string.
   Turning the flag off and on cannot retroactively lock anyone out.
   *(This also fixed a latent fault: the earlier inert design interpolated the
   flag into the SQL, so enabling verification would have stopped counting all
   9 existing users and freed 9 places that were not free.)*
2. **Pending accounts hold no slot**, so the slot is taken at verification —
   which is precisely why verification must be capacity-checked and refusable.
3. **No email provider is required for the app to run.** Missing transport
   raises at the point of sending; it never silently sends nothing, and
   Admin → Users warns on screen if verification is on without one.

---

## External configuration still required

| Item | Value |
|---|---|
| Domain | `rosalytics.com` |
| DNS management | **GoDaddy** |
| Planned sender | `info@rosalytics.com` |
| Planned provider | **Resend** (free tier: 3,000/month) |

### Remaining sequence

- **Step 2 — Configure Resend DNS records in GoDaddy.** ← **RESUME HERE**
  Three records: DKIM `TXT resend._domainkey`, SPF `TXT send`, and
  `MX send` → `feedback-smtp.<region>.amazonses.com` priority 10.
  **GoDaddy appends the domain to the Name field** — enter `send`, not
  `send.rosalytics.com`. The MX goes on the `send` subdomain, **never the
  root**, so the existing `info@rosalytics.com` mailbox is unaffected; do not
  edit or replace any root MX record.
- **Step 3** — Verify `rosalytics.com` in Resend and configure
  `info@rosalytics.com` as the sender.
- **Step 4** — Securely configure `RESEND_API_KEY`, `MAIL_FROM` and `APP_URL`
  in the **Render dashboard** (never in a file, never in chat). `APP_URL` is the
  public origin; confirmation links are built from it and it is deliberately not
  inferred from the `Host` header.
- **Step 5** — Test a real verification email **while
  `REQUIRE_EMAIL_VERIFICATION` remains OFF**, so a broken send cannot block
  real sign-ups.
- **Step 6** — Only after a real email has successfully arrived, enable
  `REQUIRE_EMAIL_VERIFICATION=true`.

While the Resend domain is unverified, Resend delivers only to the address the
Resend account was created with — useful for Step 5.

---

## Pending Neon migration

### Important Dates — run when convenient, NOT a release blocker

The commit adds an `important_dates` table. Unlike the priorities migration
below, **deploying the code before the migration is safe** — that was a
deliberate design requirement after the last time production code arrived
ahead of its schema:

- `loadState` treats a missing `important_dates` as *unavailable*, not empty.
  Every other part of the account loads exactly as before, and the panel says
  "Important dates aren't switched on yet…" in the reader's language instead of
  showing an empty calendar. An empty calendar and a missing table must never
  look the same.
- A write answers **503** with the same sentence, not a 500.
- Nothing else queries the table.

Verified by dropping the table against a running instance: Today rendered all
ten habits, the panel explained itself, a save came back 503, `db:migrate`
recreated the table, and the next save succeeded with no restart.

To switch it on:

```
RH_ALLOW_REMOTE=1 DATABASE_URL='<Neon connection string>' npm run db:migrate
```

Purely additive — one `create table` and one index, no backfill, no existing
row read or written. Idempotent: running it twice does nothing the second time.


### Rolling priorities — required before or with the next deploy

The commit that makes unfinished priorities carry forward adds a `priorities`
table and rebuilds every existing day note into it. **The application reads
that table on every page load, so a deploy of this commit without the migration
leaves the app unable to load state.** Run `db:deploy` first, or immediately
after pushing:

```
RH_ALLOW_REMOTE=1 DATABASE_URL='<Neon connection string>' npm run db:deploy
```

What it does, all additive:

- creates `priorities`;
- reads every row of `day_priorities` and rebuilds it as records, folding a
  line retyped across several mornings into the one task it always was, and
  splitting it again where it was finished and later written afresh;
- **leaves `day_priorities` exactly as it stands.** Nothing is dropped,
  truncated or rewritten, so the original notes remain and this is reversible.

It prints what it did, including how many priorities will start carrying
forward and how many accounts will open Today with more than five lines — that
last one only happens where history put them there, and every line is still
shown.

Re-running is safe: it sees the table is already populated and leaves it alone.

### Earlier

Checked directly against production on 2026-08-16. Production is at **9 active
non-admin accounts + 1 admin = 10 total**, comfortably under the 50 cap.
Everything earlier (feedback, gratitude, monthly reflections, day priorities,
terms, names, `email_verified_at`) **is already applied**. Only two objects from
commit `0487b54` are missing:

- table `email_verifications`
- column `users.verification_required`

**Before the next production deploy of `0487b54` or later, run against Neon:**

```
DATABASE_URL='<Neon connection string>' npm run db:deploy
```

Both halves (`db:setup && db:migrate`) are idempotent and additive. Nothing is
dropped, backfilled or rewritten; existing rows take
`verification_required = false` from the column default.

> Until this runs, a deployed build will fail on any query touching those
> objects. Running it while verification is OFF is safe and changes no
> behaviour.

---

## Other outstanding items

- **Owner action, security:** rotate the OpenAI key that appeared in an earlier
  screenshot; rotate the Neon password that was pasted into chat; delete
  `ADMIN_PASSWORD` from Render if still present (no env var is a credential
  anywhere in this app).
- Render env: `PG_POOL_MAX` should be `5`; `PG_IDLE_MS` should be unset.
- Free tier: the service sleeps after ~15 min idle and Neon suspends too, so the
  first request after a quiet spell is slow. Expected, not a fault.

---

## Handoff protocol

Update this file at each meaningful milestone, or whenever the owner says work
is stopping — recording: what was completed, relevant commits, what was
verified, architectural decisions, outstanding work, external configuration
still required, the exact next step, and anything that must not be changed.
Verify claims against the repository before writing them.
