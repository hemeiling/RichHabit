# RichHabit — Project Status

> Last updated: 2026-08-30
> Branch: main
> Latest verified commit: `26635ed`
> Production: healthy, but **behind main** — three commits await a manual deploy

## 1. Current Production State

- **Production URL:** https://richhabit.onrender.com
- **Production database:** Neon (direct endpoint for schema work; the app runs
  through the pooler). The connection string lives only in Render's environment
  variables and is pasted on the command line for migrations — never in a file.
- **Current deployed commit:** `adbfb73`. Confirmed by build fingerprint: the
  live stylesheet carries `cal-months` and `textarea-grow` but not
  `todays-priorities-title` or `progress-panel-title`.
- **Last production migration:** `user_preferences.community_visible`, applied
  2026-08-30.
- **Production health:** `/api/health` → `ok`, `db: up`. 11 accounts, 120
  habits, 62 completions, 16 priorities, 3 important dates. Users are active
  daily.
- **Known production issues:** none. Render does **not** auto-deploy; every
  release needs Dashboard → Manual Deploy.

## 2. Work Completed

### Important Dates
- [x] Two-month calendar
- [x] Multi-day events
- [x] Custom colors
- [x] Long notes (10,000 characters)
- [x] Single-month view (was two)
- [ ] Yearly recurrence
- [ ] Expired-event filtering

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

| Feature | Commit | Migration | Pushed | Production |
|---|---|---|---|---|
| Priorities beyond five | `950e746` | None needed | Yes | **No** |
| Progress / Community panel + opt-out | `43dd323` | Done | Yes | **No** |
| Honest message before a pending migration | `4a8ccef` | None needed | Yes | **No** |
| Status record of the migration | `2a82a0e` | — | Yes | **No** |
| Handoff rewrite + local-only `.env.local` | `5cfdfc8` | — | Yes | **No** |
| Important Dates: one month, not two | `26635ed` | None needed | Yes | **No** |

Deploy order does not matter for any of these: the migration is already applied
and the code tolerates its absence anyway.

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

Nothing half-finished. The last change was configuration hygiene: `.env.local`
was returned to local-only after production credentials were temporarily placed
in it to run the migration.

Files most recently involved:
- `src/components/ProgressPanel.tsx` — the two-view rail card
- `src/lib/community.ts` — `scoreMember` enforces the opt-out
- `src/lib/trend.ts` — splitting a series into drawable runs
- `src/app/api/prefs/route.ts` — cache invalidation and the pre-migration message
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
- Render free tier sleeps after ~15 minutes idle, and Neon suspends too, so the
  first request after a quiet spell is slow. Expected, not a fault.
- On 2026-08-30 the local working copy vanished from disk (cause never
  established). GitHub and production were intact; the checkout was restored by
  clone. Only gitignored files were lost, including the local dev database,
  which held nothing not reproducible from the schema and sign-up seeding.

## 7. Verification

Most recent verification (2026-08-30, on `2a82a0e`):

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
- **Production verification:** migration verified by before/after census. The
  panel itself is **not yet verified in production** because it is not yet
  deployed. Unauthenticated checks pass: health, and every API route refusing an
  unauthenticated caller.

## 8. Next Step

**Start here next session:**

1. Owner: rotate the OpenAI API key.
2. Owner: Render → Manual Deploy → Deploy latest commit (`2a82a0e`).
3. Run the unauthenticated production checks
   (`node live-verify.mjs https://richhabit.onrender.com`), then the signed-in
   checklist using the designated production test account — never a
   newly-created one.
4. Update section 1 with the newly deployed commit and section 7 with the
   production verification result.

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
