# RichHabit — Project Status

> Last updated: 2026-09-09
> Status: `a59b118` is deployed and CLOSED as production-validated. The
> quadrant-add iteration is built, verified locally, committed and NOT deployed.

## Deployed

- Commit: `a59b118` "Ask what matters before deciding where it goes"
- `origin/main` = `a59b118`; Render auto-deployed from `main`
- Stylesheet `75a0769dfb9c2c0f.css`, sha256 `7493a68d…` — byte-identical to the
  locally verified build
- Strings chunk `629-b2e077beed5763d0.js` — byte-identical, and carries every
  new string in both languages
- `GET /api/health` → `ok: true`, database up
- `/today` 307 and `/api/state` 401 when signed out; authorization intact

## Migration

Applied to production by the Product Owner on 2026-09-09:

    added priorities.planned_on
    priorities: already converted, left alone
    Done — 1 change(s).

Verified afterwards, read-only, with the session set `default_transaction_read_only`:

| Property | Value |
| --- | --- |
| `planned_on` | present, `date`, nullable, no default |
| rows | 30 |
| rows with a plan | 0 (no backfill) |
| fingerprint | `bd0756fbeb816a2d110a4f82de1fb417` |
| categories | `important_not_urgent`=11, `unsorted`=13, `urgent_important`=3, `not_important_not_urgent`=3 |

No category was rewritten and no row was backfilled. The thirteen `unsorted`
rows are untouched.

Honest limit: a true before-and-after fingerprint of the migration itself was
not possible, because the Product Owner ran it while this session had no
credential. What is verified is the schema and data as they stand now.

## What this release changed

- Quadrants reordered to Q1 top-left, Q2 top-right, Q3 bottom-left, Q4
  bottom-right. Presentational; no stored category changed.
- The automatic Q2 default is gone at every layer. `addPriority` takes the
  quadrant; `parseNewPriority` rejects a create without one rather than
  choosing. Two chips ask Important? and Urgent?, Add stays disabled until both
  are answered, and the derived quadrant is shown before it is committed.
- `planned_on`, offered on Q2 cards only, never set automatically. A passed day
  on an open line shows amber and nothing else; a completed line never does.
- One line under the heading, a nudge or an insight, never both. Every branch
  counts what is on screen now. The once-a-day rule lives in `localStorage`.
- Fixed the phone bottom sheet, which rendered far below the fold because
  `.fade-in` leaves a computed identity matrix and so became the containing
  block for `position: fixed`. Both card menus now portal to `<body>`, as
  `Sheet` in ui.tsx already did. The bug predated this release and affected the
  category control shipped in `c82913e`.

## Verification

Typecheck clean, lint clean, production build succeeds, 440 tests passing.
Locally, 31 of 31 browser checks passed across both languages, light and dark,
at 1440px and 390px. Across a round of classifying, planning, moving and
dragging, the fingerprint over id, text, `created_on` and `completed_on` did not
move.

## Production validation — COMPLETE

`a59b118` is production-validated and the release is CLOSED.

Verified by this session, read-only: byte-exact parity on the stylesheet
(`75a0769dfb9c2c0f.css`, sha256 `7493a68d…`) and on the strings chunk
(`629-b2e077beed5763d0.js`), every new string present in both languages, health
green, authorization intact, and the `planned_on` column present, nullable, with
no row carrying a plan.

Verified by the Product Owner in the signed-in UI on 2026-09-09:

- setting a planned date on a Q2 line succeeded
- a reload preserved it
- Clear removed it
- a reload restored `+ Plan`

That exercises set, persist and clear on `planned_on` and returns the row to the
state the migration left it in. No production priority content was changed.

## Quadrant-add iteration — BUILT, awaiting review

**Direct creation inside each quadrant**, complementary to the global Add row,
which stays exactly as it is.

- A quiet `+ Add here` / `+ 添加到这里` at the bottom of each box. Resting state
  is that line alone — no permanent input, and certainly not four of them.
- Clicking it reveals a compact inline input inside that quadrant: text field
  plus Add. Enter submits. Escape closes. Clicking away closes it when empty.
- No Important?/Urgent? questions: choosing the box IS the classification.
  Q1 → `urgent_important`, Q2 → `important_not_urgent`,
  Q3 → `urgent_not_important`, Q4 → `not_important_not_urgent`.
- Collapses and clears after a successful create.
- Must be easy to find from an empty quadrant; the current empty state should
  carry the affordance rather than sitting beside it.
- On a phone the input stays inside the quadrant. No modal, no bottom sheet.
- No schema change. Reuses the category-aware `addPriority` path built in
  `a59b118`, so a line created this way is identical to one created globally
  except that the quadrant was already known.
- A line added directly to Q2 gets NO `planned_on`. The existing `+ Plan`
  action remains the only way a date is ever set.

Tests to cover: each of the four boxes creating in its own category; Enter
submits; an empty value cannot; the global flow still demands both answers; Q2
direct creation leaves `planned_on` null; the quadrant survives a reload; and no
horizontal overflow on a phone.

Decisions (settled 2026-09-09, all four questions answered):

1. New lines land at the BOTTOM of their box, keeping today's `addPriority`
   numbering. A fresh line must not displace something deliberately ranked top.
2. Text is never silently discarded. Empty input: clicking away or Escape
   collapses it. Input with text: clicking away keeps it open, and Escape does
   not discard either. After a successful Add, clear and collapse.
3. An empty quadrant shows ONE piece of UI, not two: a centred, actionable
   `＋ Add a priority here` / `＋ 在这里添加优先事项`, in the same quiet treatment
   the current empty state uses. Clicking it opens the inline input.
4. The empty quadrant stays a drop target. While a drag is in progress it
   swaps to the existing `Drop here` / `拖到这里` and the Add affordance is
   withdrawn, so a button never competes with the drop. It returns when the
   drag ends.
5. A non-empty quadrant puts the quiet `+ Add here` after the last card, so the
   interaction reads the same in both states.
6. The two creation models stay distinct and both remain. Global Add means "help
   me classify this" and therefore asks both questions. Quadrant Add means "I
   know where this belongs" and therefore asks neither.

7. Escape closes while preserving the draft. No visible Cancel button; the UI
   stays quiet. The full table:

   | State | Click away | Escape |
   | --- | --- | --- |
   | Empty | close | close |
   | Has text | KEEP OPEN | close, draft preserved |

   Drafts are per quadrant and independent: typing in Q2, closing it, working
   in Q1, then reopening Q2 restores the Q2 draft exactly. A successful Add
   clears that quadrant's draft and collapses the input. Drafts are in-memory
   only and need not survive a reload or navigation.

8. When a quadrant holds a preserved draft and its input is collapsed, the
   affordance changes from `+ Add here` to a `Continue adding…` variant, so
   unfinished text is visible as a state without showing the text itself.

9. The collapsed wording, complete. No part of a draft is ever shown while
   collapsed.

   | Quadrant | No draft | Preserved draft |
   | --- | --- | --- |
   | Has cards | `+ Add here` / `+ 添加到这里` | `Continue adding…` / `继续添加…` |
   | Empty | `＋ Add a priority here` / `＋ 在这里添加优先事项` | `Continue adding…` / `继续添加…` |

   While a drag is in progress an empty quadrant replaces EITHER version with
   `Drop here` / `拖到这里`, and on drag end restores whichever of the two is
   correct for that quadrant's draft state.

   Three new strings per language: the two add affordances and the continue one.

UX specification is complete. No further design decisions are outstanding.

## Next follow-up — recorded, NOT implemented

Legacy `unsorted` priorities should present as **Unclassified / 未分类** rather
than resolving implicitly to Not Urgent & Important.

Why: this release removed the automatic Q2 default because the app must not
decide what matters to someone. Thirteen production rows are still *displayed*
as though the user had chosen Q2, which is the same guess wearing the clothes of
a decision. A row that has since been dragged or re-filed is no longer legacy,
because the move wrote a real category — so the population is specifically rows
nobody has ever classified.

Do not implement without an explicit decision on how an unclassified line should
behave in a four-box grid.

## Notes
- `.env.local` holds only the local `127.0.0.1` URL and `PG_POOL_MAX`. No Neon
  string, no `-pooler`, no `RH_PROD_MIGRATE_URL`. Gitignored and untracked.
- `npm run inspect:prod` is unusable: its read-only credential is gone, and the
  script has uncommitted edits that also break its own test
  (`tests/inspect-prod-readonly.test.ts`, expecting an `INSPECTION_START` log
  line the edited script no longer prints). Both files are deliberately
  untouched, as are `docs/RichHabit_Solution_Architecture.md` and
  `docs/RichHabit_User_Manual.md`.
- PGlite serves one connection at a time; stop the dev server before running any
  script against the local database.
