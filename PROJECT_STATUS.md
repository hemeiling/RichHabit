# RichHabit — Project Status

> Last updated: 2026-09-12
>
> **RELEASE APPROVED · PRODUCTION DATABASE MIGRATED · MAIN UPDATED · DEPLOY VERIFICATION PENDING**
>
> The Product Owner approved the application release on 2026-09-12. `main` is
> fast-forwarded to release commit `cd3eef4` plus this status update. The
> intention migration was rehearsed on a Neon branch and applied to production
> before `main` moved. Production verification of the deploy follows in the next
> status update.

## Production, verified 2026-09-12

| | Commit |
| --- | --- |
| production (Render, `https://richhabit.onrender.com`) | `109d295` |
| GitHub `main` (read-only `ls-remote`) | `109d295` |
| local `main` | `109d295`, plus the uncommitted release below |

Verified from production's public login page, without credentials: its only
stylesheet is byte-identical to a local build of `109d295` (sha256 `1ffcb6dd…`),
its dictionary chunk is identical to that build once numeric module ids are
masked, and it contains every string and CSS class `109d295` introduced and none
from this release. There is no Render CLI or API key here, and `/api/health`
reports no version, so this asset comparison is the verification method.

Production is neither ahead of nor behind `main`. No commit lies between
production and the release; the release is one new commit on top of `109d295`.
`109d295` changed neither the migration nor the schema, so production's
migration level is that of `a59b118`, whose `planned_on` migration was applied
on 2026-09-09.

## The release

### Contents

My Journey navigation, the decomposition of Today into Rich Habits and Priority
Compass, Clarify Your Intention with its migration, backward-compatible routing,
and two narrow bug fixes. All approved by the Product Owner.

```
My Journey                        foldable group; no page, no route
    Clarify Your Intention        /intention
    Rich Habits                   /habits      day header, habits, journal, My Progress
    Priority Compass              /priorities  matrix, Important Dates, past days
Week · Insights · Community · More (My Habit Sheet at /more/habits)
```

| Request | Answer |
| --- | --- |
| `/today` | 308 to `/habits`, query kept, `Cache-Control: no-store, must-revalidate` |
| `/habits?edit=` or `?from=` | 307 to `/more/habits`, query kept, same cache header |

### The exact commit set

47 paths: 45 added or modified files and one rename. It contains no file-mode
changes, no executable new files, no environment files, logs, screenshots,
build output or scratch files. Stage with `git -c core.fileMode=false` so the
166 mode-only paths in this OneDrive checkout stay out.

- **A. My Journey navigation:** `src/components/Sidebar.tsx`,
  `src/components/AppShell.tsx`, `tests/navigation.test.ts`,
  `tests/i18n.test.ts`; nav hunks of `src/app/globals.css` and both dictionaries.
- **B. Rich Habits and Priority Compass:** `src/components/screens/Today.tsx` →
  `RichHabits.tsx` (rename), `src/components/screens/PriorityCompass.tsx`,
  `src/app/(app)/habits/page.tsx`, `src/app/(app)/priorities/page.tsx`,
  `src/app/(app)/more/habits/page.tsx`, `src/components/screens/More.tsx`, and
  the page labels in `src/app/api/{completions,habits,habits/reorder,important-dates,notes,priorities}/route.ts`.
- **C. Clarify Your Intention:** `src/app/(app)/intention/page.tsx`,
  `src/app/api/intention/route.ts`, `src/components/screens/Intention.tsx`,
  `src/lib/intention.ts`, `src/lib/types.ts`, `src/lib/validate.ts`,
  `src/lib/db/queries.ts`, `src/lib/db/index.ts`, `src/lib/db/diagnose.ts`,
  `src/lib/analytics/config.ts`, `src/components/ui.tsx`,
  `tests/intention.test.ts`, `tests/branding.test.ts`; intention hunks of
  `src/components/store.tsx`, `src/app/globals.css` and both dictionaries.
- **D. Intention migration and schema:** `db/schema.sql`, `scripts/migrate.mjs`
  — each differs from `HEAD` by exactly one added block.
- **E. Backward-compatible routing:** `src/middleware.ts`,
  `src/app/(app)/today/page.tsx`, `src/app/page.tsx`, `src/app/login/page.tsx`,
  `src/app/login/LoginForm.tsx`, `src/app/setup/[token]/SetupForm.tsx`,
  `src/app/change-password/ChangePasswordForm.tsx`,
  `src/components/AdminShell.tsx`, `src/components/screens/Goals.tsx`,
  `src/components/screens/Awareness.tsx`.
- **F. Narrow bug fixes:** dark mode (the `[data-theme]` rule in
  `src/app/globals.css`); the Saving indicator (`runDebounced` in
  `src/components/store.tsx`).
- **G. Documentation:** `PROJECT_STATUS.md`.

Content changes deliberately left OUT, all outside these categories and all
predating this work:

- `scripts/inspect-prod-readonly.mjs` and `tests/inspect-prod-readonly.test.ts`:
  uncommitted edits that break that test. They are the known baseline failure.
- `docs/RichHabit_Solution_Architecture.md` and `docs/RichHabit_User_Manual.md`:
  untracked documents not written in this work.

### The schema change

```sql
create or replace function text_array_within(items text[], max_items int, max_chars int)
returns boolean language sql immutable parallel safe as $$
  select coalesce(cardinality(items), 0) <= max_items
     and not exists (select 1 from unnest(items) as item where length(item) > max_chars)
$$;

create table intentions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users on delete cascade,
  want          text not null default '' check (length(want) <= 2000),
  why_chain     text[] not null default '{}'
                constraint intentions_why_chain_check
                check (text_array_within(why_chain, 3, 2000)),
  ownership     text check (ownership in ('mine','outside','unsure')),
  ownership_note text not null default '' check (length(ownership_note) <= 2000),
  vision        text[] not null default '{}'
                constraint intentions_vision_check
                check (text_array_within(vision, 4, 2000)),
  habit_ids     uuid[] not null default '{}'
                constraint intentions_habit_ids_check
                check (cardinality(habit_ids) <= 3),
  priority_id   uuid,
  step          smallint not null default 1 check (step between 1 and 5),
  completed_at  timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index intentions_one_active on intentions (user_id)
  where archived_at is null;
```

Approved by the Product Owner, including `habit_ids <= 3`. Purely additive,
created only if missing, run inside the migration's single transaction.

## Verification of the exact release tree

The release set was exported from a temporary index into a clean tree with no
environment file, and every check ran against that tree rather than the working
directory.

| Check | Result |
| --- | --- |
| typecheck, lint, production build | clean |
| unit tests | 506 of 506 |
| migration rehearsal on a production-like copy | 22 of 22 |
| navigation and page composition | 56 of 56 |
| Priority Compass width parity and past days | 13 of 13 |
| data safety fingerprint while using every moved feature | 14 of 14 |
| ownership, limits and log privacy | 24 of 24 |
| autosave, resume, journal regression | 9 of 9 |
| mobile drawer and bilingual sidebar | 14 of 14 |
| intention walks in English, Chinese, bilingual, dark | 121 of 121 |
| new code against a database without the new table | 11 of 11 |

In the working directory the unit suite reports 507 of 508, because it includes
the excluded `inspect-prod-readonly` edits. The release tree carries `HEAD`'s
versions of those files and passes.

The rehearsal copy held app-created users, habits, completions, priorities,
journal entries and important dates across 27 tables, brought to production's
migration level first. The first run made exactly two changes; every existing
table's rows and structure were byte-identical afterwards; a second run changed
nothing; direct inserts over every limit were refused by the named constraint.

Expected stylesheet once the release is serving, for verifying the deploy:
`00a67853ba1e8d0b.css (sha256 488ebf311ed45b28…)`.

## Environment clean-up, 2026-09-12

- The pasted production credential was removed from `.env.local`, which now
  holds only local settings. The file is gitignored and never committed, and the
  endpoint appears in no history, project file or document. The Product Owner is
  rotating the credential.
- Two stale `npm start` servers on ports 3004 and 3007, started 2026-08-15 from a
  RichHabit copy in `~/.Trash`, were stopped with approval. Both ports are free.
  The graceful SIGTERM did not run because of a scripting error; they were
  stopped with SIGKILL after each PID was re-checked as a RichHabit server
  working in that copy. Neither held a database connection.
- Whether that Trash copy contains a production credential is **unknown**: macOS
  does not let this session read `~/.Trash`, and the path no longer resolves.
  Nothing there was deleted.

## Release progress, 2026-09-12

| Step | State |
| --- | --- |
| pre-flight: production healthy and still `109d295` | done, 19:57 UTC |
| clean commit | `cd3eef49368b43766acbec33e24942c9169e798e` |
| commit tree equals the verified tree | yes, `4ebb312611fbf846a79fef5a3f4b35f665788d6b` |
| mode changes in the commit | 0 |
| release branch pushed | `release/my-journey-intention` |
| GitHub `main` | still `109d295` |
| Render auto-deploy setting | not verifiable from this session |
| credential rotated and Render `DATABASE_URL` updated | done by the Product Owner |
| production healthy after rotation, still `109d295` | yes, 20:10 UTC: health ok, database up, stylesheet byte-identical |
| migration target identified, read-only | the Neon endpoint production used before rotation; database `neondb`; 27 tables; schema at the `a59b118` level; no intentions objects yet |
| Neon rehearsal branch | `rehearsal-intentions-2026-09-12`, created by the Product Owner from `production`; same Neon project, different branch timeline; byte-identical to production across 27 tables before migrating |
| migration rehearsal on the Neon branch | passed 56 of 56: the two expected changes, a no-op second run, 13 schema checks, 26 constraint tests rolled back, all 27 existing tables byte-identical |
| production migration | applied 20:25 UTC: `created text_array_within()`, `created intentions`, `Done — 2 change(s).` |
| idempotency run on production | `Nothing to do; already up to date.` |
| production verification | 38 of 38: new objects, constraints and index present; `intentions` empty; all 27 existing tables and 1,181 rows byte-identical before and after |
| temporary database credentials in `.env.local` | removed; local development URL restored |
| application release | approved by the Product Owner; `main` fast-forwarded to the release; deploy verification pending |

**Migration notes.** Both databases were reached through pooled connections.
The rehearsal URL was pooled rather than direct as described; that is a
connection type, not an identity, and does not affect this single-transaction
migration. The pg driver printed its standard notice that `sslmode=require` is
treated as `verify-full`; it comes from the driver and changed nothing. No test
intention was created in production. The rehearsal branch can be deleted in Neon
once the deploy is verified.

The working tree on the release branch still holds the four excluded content
changes. It now shows 212 mode-only paths rather than 166, because the 46
committed files are stored as 644 while this OneDrive checkout marks them
executable.

## Release sequence

Steps 0 to 3 are complete. The Product Owner approved step 4 on 2026-09-12.

The migration is additive and the new code is safe before it, but order still
matters: migrating first means the intention page works from the first request,
a migration failure stops the release before users see new code, and a later
code rollback never needs the database touched.

**0. Before the release**

1. Rotate the production database credential. Update `DATABASE_URL` on Render.
   Render restarts the current deploy; confirm production is still healthy and
   still serving stylesheet `5ec78f0f7d7b0bdd.css`.
2. Confirm in the Render dashboard whether auto-deploy is on for `main`.
   `render.yaml` does not say.
3. Create a Neon branch of production. It is the restore point and the final
   rehearsal target.

**1. Clean commit** on a release branch from `109d295`: stage exactly the 47
paths above with `git -c core.fileMode=false`, confirm no mode changes and that
the staged tree matches the verified set, and commit.

**2. Push the release branch.** Pushing a branch other than `main` deploys
nothing.

**3. Production migration**

1. From the release commit, run the migration against the Neon branch. Expect
   exactly `created text_array_within()`, `created intentions`, `Done — 2
   change(s).`, then `Nothing to do` on a second run.
2. Run it against production:
   `RH_ALLOW_REMOTE=1 DATABASE_URL='<rotated production URL>' npm run db:migrate`.
   Check the target line says the production host with `** REMOTE **`. Expect the
   same two changes, then `Nothing to do` on a second run.
3. If the output shows anything else, stop. Do not deploy.

**4. Application deployment:** fast-forward `main` to the release commit and
push. Render builds with `npm ci && npm run build`. Confirm the login page serves
the expected release stylesheet above and contains "My Journey".

**5. Production smoke tests**

- Read-only, no credentials: health `ok`; `/today` answers 308 to `/habits`;
  `/habits?edit=x` answers 307 to `/more/habits`; `/intention` signed out
  redirects to login; `POST /api/intention` signed out answers 401.
- Signed in by the Product Owner: My Journey tree; Rich Habits shows existing
  habits and history; Priority Compass shows existing priorities, past days and
  Important Dates; My Habit Sheet opens; an intention autosaves, survives a
  reload and resumes; a habit and a priority created from step five appear on
  their pages; dark mode and bilingual mode read correctly.
- Existing habits, priorities, completions and journal entries are all present.

**6. Failure and rollback**

- **Migration fails:** it runs in one transaction and rolls back; production is
  unchanged. Do not deploy. Investigate against the Neon branch.
- **Build fails:** Render keeps serving `109d295`. The new table is unused by
  that code and harmless. Fix forward.
- **Smoke tests fail:** roll back in the Render dashboard to the `109d295`
  deploy, or revert the commit on `main`. Leave the `intentions` table and its
  rows in place: `109d295` ignores them, and any reflection a user saved survives
  for the fix. Never drop or truncate it as a rollback step.
- After a rollback, the redirects were sent with `no-store`, so browsers should
  not reuse them; at worst a user reaches `/habits`, which in `109d295` is the
  working habit sheet.
- Restoring production from the Neon branch would discard every write since the
  migration, so it is reserved for data corruption and needs the Product Owner.

## Open, not fixed

- **Header title truncation at phone width**, deferred by the Product Owner.
- **The matrix card says "Today's priorities" on past days**; wording inside the
  unedited component.
- **Rich Habits leaves an empty rail column below My Progress** on tall desktop
  pages.
- **`db/schema.sql` lacks the legacy `day_priorities` table** that an earlier
  migration step creates. Production has it. Pre-existing.
- **The `inspect-prod-readonly` baseline failure** in the working directory, from
  pre-existing edits excluded from the release.

## Notes

- `.env.local` points `npm run dev` at the local database; start it with
  `npm run db:dev` first.
- PGlite serves one connection at a time. Do not run builds or test suites while
  a browser suite is using it.
- In zsh, never name a shell variable `path`: it is tied to `PATH`.
- The headless browser used for verification is outside the project; no
  dependency was added.
