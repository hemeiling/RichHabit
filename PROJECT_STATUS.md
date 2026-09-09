# RichHabit — Project Status

> Last updated: 2026-09-09
> Status: the `priorities.category` migration is applied to production. The
> Priority Matrix drag-and-drop fix and the quick category control are built,
> verified locally in a real browser, and deployed.

## 1. The production save failure — fixed

Adding a priority failed with "Something went wrong saving that." The deployed
code wrote `priorities.category`; the production database had no such column,
so the INSERT raised Postgres `42703`. The read path tolerates `42703` through
`optionalRead`, which is why the list looked empty rather than broken.

Migration applied 2026-09-09 against the DIRECT Neon endpoint (no `-pooler` in
the hostname), using the existing repository migration, unmodified:

    RH_ALLOW_REMOTE=1 DATABASE_URL="$RH_PROD_MIGRATE_URL" npm run db:migrate
    → added priorities.category
    → priorities: already converted, left alone
    Done — 1 change(s).   exit 0

Verified afterwards, read-only: the column is `text not null default 'unsorted'`
with its CHECK constraint. All 32 production rows preserved, fingerprint over
`id | body | created_on | completed_on | sort_order` identical before and after.
No backfill was written: `normalizePriorityCategory` resolves `unsorted` to
`important_not_urgent` at read time, so legacy lines appear under Important &
Not Urgent without a stored value being rewritten.

## 2. The Priority Matrix — drag fixed, and a second way to file

### Why drag was dead

`setDraggedId` was never called. `onDragStart` wrote to `dataTransfer` and
nothing else, so `draggedId` stayed null, `handleDrop` returned at its first
line, and `moveWithinCategory` was always called with `dragId === targetId`.
Nothing could ever move. The whole card was also `draggable`, which put the
drag in competition with the checkbox and the delete control.

### What changed

- [src/lib/priorities.ts](src/lib/priorities.ts): `QUADRANTS` and
  `layoutAfterMove(visible, id, toCategory, beforeId)` — one pure function that
  answers "where does everything sit now" for every kind of move. Returns only
  `{ id, category, sortOrder }`, densely numbered per quadrant, never `unsorted`.
- [src/components/Priorities.tsx](src/components/Priorities.tsx): rewritten.
  Drag lives on a grip that appears on hover on pointer devices only, matching
  the habit rows; the card is carried as the drag image. Every card also has a
  quiet category control that opens a menu — an anchored popover on a pointer
  device, a bottom sheet on a phone, one component with the shape decided in
  CSS. Arrow keys, Home/End, Escape, `aria-checked`, and a polite live region
  announcing moves. The popover flips above the card when it would otherwise
  open below the fold.
- [src/app/globals.css](src/app/globals.css): matrix styles. Four muted quadrant
  tokens, two of them the existing `--accent` and `--warn`. Colour appears only
  as a 5px dot, once per card and once per box header. Drop states are a border
  and an inset line, so nothing changes size while dragging.
- [src/lib/db/queries.ts](src/lib/db/queries.ts): `savePriorityLayout` is now a
  single `unnest` statement instead of one UPDATE per row. A drag on a 30-line
  account was 30 round trips to Neon; it is now one. Only `category` and
  `sort_order` are named in the statement.
- [src/lib/i18n/en.ts](src/lib/i18n/en.ts), [src/lib/i18n/zh.ts](src/lib/i18n/zh.ts):
  a `short` label per quadrant for the card, plus menu, empty and announcement
  strings. Both languages.

## 3. Verification

Gates: typecheck clean; 419 tests passing across 25 files (11 new ones cover
`layoutAfterMove`); lint clean; production build succeeds.

Browser, driven against the local database with legacy `unsorted` rows, long
English and long Chinese text, a carried-over line and a completed one:

- four quadrants, no Unsorted box, legacy lines under Important & Not Urgent
- drag between quadrants, and reorder within one — both persist across reload
- the category control moves a card, and persists across reload
- operable from the keyboard; sheet on a phone; a tap-only move persists
- English and Chinese, light and dark, 1440px and 390px, no sideways scrolling
- no console or page errors

Data preservation, proved at the column level: after dozens of drags, reorders,
menu picks, keyboard moves and taps, the fingerprint over
`id | body | created_on | completed_on` was byte-identical
(`677a94741019c8d226c0ae2f8500e8b8`), while the arrangement fingerprint changed.
Rearranging cannot touch a line's text, its id, or either of its dates.

Note on the harness: Playwright's `dragTo` helper does not engage Chromium's
native HTML5 drag machinery. A real press-move-move-release does. The first
"drag is broken" readings were the helper, not the app.

## 4. State progression
- Committed: yes
- Pushed: yes
- Migration applied to production: yes (2026-09-09)
- Deployed: yes (Render auto-deploy from `main`)
- Production verified after this release: NOT YET — see below

## 5. The one outstanding step

Open production once Render has finished building, then:

1. confirm the four quadrants render and the 32 lines appear
2. add one priority and confirm it saves
3. move one with the category control, and one by dragging
4. reload and confirm both stayed

## 6. Notes for whoever is next

- `.env.local` holds only the local database URL. Both Neon strings were deleted
  on 2026-09-09, per the file's own header rule. `npm run inspect:prod` will
  therefore fail closed until a credential is supplied on the command line.
- Uncommitted and NOT mine: `scripts/inspect-prod-readonly.mjs` and
  `tests/inspect-prod-readonly.test.ts` have working-tree edits that break
  `tests/inspect-prod-readonly.test.ts` (it expects an `INSPECTION_START` log
  line that the edited script no longer prints). Also untracked:
  `docs/RichHabit_Solution_Architecture.md`, `docs/RichHabit_User_Manual.md`.
  None of these were committed or deployed.
- PGlite serves one connection at a time, so the dev server must be stopped
  before any script can read the local database.
