# Together: Project Progress & Accomplishments (technical assessment)

Status: assessment only, on local branch `feature/together-progress` from production `962b65b`. Nothing is built, pushed or migrated.

Scope requested by the PO on 2026-10-20: project progress, group filtering, individual accomplishments, story points, collapsible History, and Excel export.

## What already exists

- **Tasks** (`together_tasks`):
  - `stage` ∈ backlog/todo/doing/waiting/done
  - `moved_at`: when the task entered its current stage; reopening restarts it
  - `group_id`
  - `effort` ∈ {1, 2, 3, 5, 8}, already the classic story-point scale, labelled "Effort / 工作量"
  - `due_on`, `created_by`, `updated_by` (last editor)
  - `deleted_at`: soft delete, with Recently deleted
- **Assignments** (`together_task_assignees`, each assignee a member); **groups** (`together_groups`, at most 30 per space); **members**.
- **Reads:**
  - `loadWork` returns every live task except History (Board + Backlog + Done for 24 h), plus History's first page and total.
  - `historyPage` pages History by `moved_at`.
- **Patterns to reuse:**
  - `requireBoard` (members only; 404 for anyone else) and `togetherTransaction`
  - `trackEvent` with counts only
  - the `tg-*` UI (Menu, Dialog, Toast) and EN/中文 dictionaries
  - the space header's planned view switcher ("when Calendar arrives, a small view switcher joins here")
- **Not recorded today:** who moved a task to Done (`updated_by` is only the last editor), and a completion date that survives a later edit of the stage. `moved_at` is correct for "currently done".
- **Name clash:** "Accomplishments" already means completed Priority Compass items (`src/lib/accomplishments.ts`), and Community shows "Monthly Habit Accomplishments". The space-level feature needs a distinct name.

## Proposal

| Feature | Design | Migration |
|---|---|---|
| **Group filtering** | Chips (All + the space's groups) above the Board, applied to Board, Backlog, History and Progress; held in the URL (`?group=`) like `?stage=`. Board and Backlog filter in the browser (already loaded). History is paged, so `historyPage` and the History total take a `group` parameter server-side. | none |
| **Story points** | Reuse `effort` (1/2/3/5/8). Optionally relabel "Effort" → "Story points / 故事点". Show sums: each Board column header, Backlog, each History day, Progress. | none |
| **Collapsible History** | The History heading becomes a disclosure with its count ("History · 42"); the open/closed state is remembered per space in local storage. | none |
| **Project Progress** | A Progress view in the space, via the planned view switcher ("Board · Progress"). For a period (this week / this month / all time) and the group filter: tasks and points done; open work by stage; due soon and overdue; points done per week for the last 8–12 weeks (inline SVG bars with a text equivalent, no chart library); breakdown by group. One aggregation endpoint, `GET /api/together/boards/[id]/progress`, using SQL `group by`, members only. | none |
| **Individual accomplishments** | Per member: tasks and points completed in the period, credited to the task's assignees. A shared task counts for each assignee, with points shown in full and as a share. Unassigned finished work appears as "Unassigned". Exact "who finished it" needs a new column (Phase 3). Suggested name inside spaces: "Contributions / 贡献". Visible only to that space's members; never mixed with personal data or Community. | none |
| **Excel export** | `GET /api/together/boards/[id]/export`, members only (archived spaces too). A CSV with a UTF-8 BOM, which opens in Excel with Chinese intact: one row per task (title, stage, group, story points, assignees by display name, due, created, finished; descriptions optional). Cells starting with `= + - @` are escaped to prevent spreadsheet formula injection. No new dependency. A real multi-sheet `.xlsx` would add `exceljs`, server-side only. Audit: a `together_exported` event, counts only. | none |

## Data and migrations

- **Phases 1–2: none.** Everything comes from existing columns.
- **Optional Phase 3** (additive, needs PO approval):
  - `together_tasks.completed_by uuid null references users on delete set null`
  - `completed_at timestamptz null`

  Both are set on entering Done and cleared on reopen. They give exact credit and stable completion dates. Past tasks stay null and are credited by assignee.

## Security, privacy, performance

- Every new route goes through `requireBoard`. Exports and progress expose only that space's shared content and members' display names, never email addresses.
- Analytics stays counts-only.
- The CSV formula-injection guard is required.
- Aggregations run in SQL per request on existing indexes (`board_id, stage, moved_at`). Open work is capped at 1,000 per space, so this is fast enough without summary tables.

## Testing plan

- **Database tests:**
  - aggregation correctness: group filter; period boundaries in the reader's time zone; multi-assignee credit; deleted and reopened tasks excluded
  - export: BOM, quoting, injection escaping, Chinese text
  - permissions: a non-member gets 404
- **Browser tests:** filter, collapse, Progress and export, on desktop and phone, in EN and 中文.

## Suggested phasing

1. **Phase 1** (no migration): group filter, story points (label + sums), collapsible History, CSV export.
2. **Phase 2** (no migration): Progress view + per-member Contributions (assignee-based).
3. **Phase 3** (optional, migration): `completed_by` / `completed_at`, `.xlsx` with sheets, longer trends.

Phases 1 and 2 can ship as one release; neither needs a migration.

## Decisions for the PO (my recommendation first)

1. **Story points:** relabel "Effort / 工作量" → "Story points / 故事点" (yes), or keep "Effort".
2. **Credit for shared tasks:** full points to each assignee, with a "shared" note (recommended), or split evenly.
3. **"Who finished it":** assignee-based now, no migration (recommended), or exact via Phase 3's migration.
4. **Export format:** CSV that opens in Excel (recommended, no dependency), or a real `.xlsx` (adds `exceljs`).
5. **History:** expanded by default, remembering each person's choice per space (recommended), or collapsed by default.
6. **Name inside spaces:** "Contributions / 贡献" (recommended), or "Space accomplishments".
7. **Where Progress lives:** the header's view switcher "Board · Progress" (recommended), or a sheet from •••.
