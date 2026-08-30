# RichHabit — Project Status

> Last updated: 2026-08-30
> Branch: main
> Latest verified commit: `6d7638a`
> Production: healthy and **up to date with `main`** (deployed 2026-08-30)

## 1. Current Production State

- **Production URL:** https://richhabit.onrender.com
- **Production database:** Neon (direct endpoint for schema work; the app runs
  through the pooler). The connection string lives only in Render's environment
  variables and is pasted on the command line for migrations — never in a file.
- **Current deployed commit:** `7b10c5d` or later, verified 2026-08-30. The
  live `.cal-day` rule is byte-identical to a local build of the current source
  (`min-height:30px`), and `.cal-months` is absent — that class only disappeared
  in `7b10c5d`, so every commit through it is live. Comparing one CSS rule
  against a local build is the quickest reliable way to tell which build is
  serving.
- **Last production migration:** `user_preferences.community_visible`, applied
  2026-08-30.
- **Production health:** `/api/health` → `ok`, `db: up`. 11 accounts, 120
  habits, 62 completions, 16 priorities, 3 important dates. Users are active
  daily.
- **Known production issues:** none. Render does **not** auto-deploy; every
  release needs Dashboard → Manual Deploy.

## 2. Work Completed

### Important Dates
- [x] Month calendar with navigation
- [x] Multi-day events
- [x] Custom colors
- [x] Long notes (10,000 characters)
- [x] Single-month view (was two)
- [x] Expired events drop out of Upcoming automatically (derived from the end
      date; they stay in the calendar when you navigate back)
- [ ] **Yearly recurrence — not started.** No field on `ImportantDate`, no
      column, no UI. Two decisions were raised and never settled: storing the
      rule on the original row and deriving occurrences rather than
      materialising copies, and what a Feb 29 event should do in common years
      (recommendation was Feb 28, so it stays in its own month).
- [ ] Birthday shortcut / category (depends on recurrence)

### Priorities
- [x] Automatic rollover
- [x] Original creation date preserved
- [x] More than 5 priorities
- [x] Ordering controls

### Community
- [x] Ranking
- [x] My Progress (default tab, month-to-date trend)
- [x] Privacy opt-out, enforced server-side

## 3. Implemented but Not Yet Deployed

Nothing. Everything through `7b10c5d` is live; `f8f5633` and `6d7638a` are
documentation only.

Deployed 2026-08-30: priorities beyond five (`950e746`), the Progress /
Community panel with the server-side opt-out (`43dd323`), the honest message
before a pending migration (`4a8ccef`), and the single-month Important Dates
panel (`7b10c5d`).

## 4. Database / Migration Status

### Local
- **Current state:** rebuilt clean on 2026-08-30 (`npm run db:dev` +
  `npm run db:deploy`). 27 tables, `important_dates` with the 10,000-character
  note constraint, `user_preferences.community_visible` present.
- **Pending migrations:** none.

### Production / Neon
- **Current state:** up to date with `main`.
- **Last migration:** `community_visible` (boolean, not null, default true) on
  2026-08-30. Verified by census either side: no row counts changed, no tables
  added or removed, and digests over habits, schedules, completions, goals,
  journals, priorities, accounts, important dates and the other preference
  columns all identical. All 11 accounts read as visible, so the board behaves
  exactly as before. A second run reported "Nothing to do".
- **Pending migrations:** none.

Never place passwords, API keys, tokens, or complete connection strings in this
file.

## 5. Current Work in Progress

Nothing half-finished. The last change simplified the Important Dates panel to
a single month; before that, configuration hygiene returned `.env.local` to
local-only after production credentials were temporarily placed in it to run the
migration.

Files most recently involved:
- `src/components/ImportantDates.tsx` — one month, navigable to any other
- `src/components/ProgressPanel.tsx` — the two-view rail card
- `src/lib/community.ts` — `scoreMember` enforces the opt-out
- `src/lib/trend.ts` — splitting a series into drawable runs
- `.env.local` — local database only (gitignored)

## 6. Open Issues / Decisions

- **Owner action, security:** the OpenAI API key **requires rotation** — it was
  exposed twice: in an earlier screenshot, and again on 2026-08-30 when a
  diagnostic printed a truncated value from `.env.local`. Diagnostics must
  report presence only (`OPENAI_API_KEY is set`) and never a value.
- **Owner action, security:** rotate the Neon password that was pasted into
  chat; delete `ADMIN_PASSWORD` from Render if still present.
- **Email verification is paused by owner decision** at Step 2 of the Resend
  setup (DNS records in GoDaddy for `rosalytics.com`, sender
  `info@rosalytics.com`). The implementation is finished, tested and merged —
  do not redesign it. Records: DKIM `TXT resend._domainkey`, SPF `TXT send`,
  `MX send` → `feedback-smtp.<region>.amazonses.com` priority 10. GoDaddy
  appends the domain, so enter `send`, not `send.rosalytics.com`; the MX goes on
  the `send` subdomain, never the root. Then verify in Resend, set
  `RESEND_API_KEY` / `MAIL_FROM` / `APP_URL` in the Render dashboard, test a
  real send while verification stays OFF, and only then enable it.
- **Yearly recurrence is not built**, and two decisions are open: store the rule
  on the original row and derive occurrences (recommended) rather than
  materialising copies; and what a Feb 29 event does in a common year
  (recommendation: Feb 28, so it stays in its own month). A birthday shortcut
  depends on it.
- Render free tier sleeps after ~15 minutes idle, and Neon suspends too, so the
  first request after a quiet spell is slow. Expected, not a fault.
- On 2026-08-30 the local working copy vanished from disk (cause never
  established). GitHub and production were intact; the checkout was restored by
  clone. Only gitignored files were lost, including the local dev database,
  which held nothing not reproducible from the schema and sign-up seeding.

## 7. Verification

Most recent verification (2026-08-30, on `7b10c5d`):

- **Unit tests:** 400 passing, 24 files
- **Typecheck:** clean
- **Lint:** clean
- **Build:** compiles
- **Browser/E2E:** 39 checks on the single-month Important Dates panel
  (navigation across six months, multi-day and cross-month rendering, upcoming
  beyond the visible month, create/edit/delete, bilingual, 390px); 33 on the
  Progress panel (default view, chart against
  a real month, switching, opt-out and back in, invisibility from a second
  account, the setting in More, English / 中文 / 双语, 390px); 42 on priorities
  beyond five; 147 across every sheet at three viewport sizes.
- **Production verification (2026-08-30, post-deploy):** health `ok` / `db: up`;
  every data route refuses an unauthenticated caller; every protected page
  redirects; `/admin` is not exposed. Build confirmed by CSS rule comparison
  against a local build. **No migration is required** — the only schema change
  since the previous deployed build was `community_visible` (`43dd323`), applied
  and censused on 2026-08-30, and nothing since touches `db/schema.sql` or
  `scripts/migrate.mjs`.
- **Not verified in production:** everything requiring a signed-in session —
  the one-month panel on screen, month navigation, Upcoming ordering, the
  Progress/Community tabs, opt-out across two accounts, priorities beyond five,
  bilingual and mobile. These are all green locally and need either the
  designated production test account or a manual pass. No production account was
  created for testing.

## 8. Next Step

**Start here next session:**

1. Owner: rotate the OpenAI API key — still outstanding.
2. Signed-in production pass, either by the owner or with the designated test
   account: the single-month panel and its navigation, Upcoming ordering across
   months, the Progress/Community tabs and the opt-out seen from a second
   account, priorities beyond five, and one mobile/bilingual look.
3. Then the next feature: **yearly recurrence for Important Dates**, which is
   not started. Settle the two open questions first (see section 6).

Do not begin unrelated implementation until the current deployment/migration
state has been verified.

## 9. Important Safety Notes

- Preserve existing user-created data.
- Local and production databases must remain clearly separated. `.env.local`
  holds the local connection **only** — not even a commented-out production
  string, which is how a migration once ran against production by accident.
- Confirm the database target before production writes: verify identity markers
  (`claire`, `emma`, the generated `richhabituser%` accounts) and take a census
  either side.
- Production migrations are explicit and out loud:
  `RH_ALLOW_REMOTE=1 DATABASE_URL='…' npm run db:migrate`.
- Schema-dependent code must have a safe deployment sequence. Preferences and
  important dates are both read with `select *`, so a database older than the
  code degrades to a clear message rather than an error.
- A data-loading failure must never masquerade as an empty account.
- Test accounts (`e2etest_*`) belong on the local/test database and are cleaned
  up after use. Never create one in production without explicit approval.
