# Together: Project Progress & Contributions / 项目进展与贡献

**Status:** implemented locally on `feature/together-progress`, from production `962b65b`. Nothing is pushed, merged, deployed or migrated. No database change is needed for anything below except **0.5 story points**, which waits for Product Owner approval (see the end of this document).

The Product Owner approved the scope on 2026-10-20. This document records what was built and the exact definitions the dashboard and the Excel export share.

## What it is

- **Board · Progress switch** (看板 · 进展): sits in every space's header under the name, outside the ••• menu.
  - The switch is links (navigation), and it carries the group filter from one view to the other.
- **Story points** (故事点): the task field formerly called Effort (工作量).
  - Choices: 1, 2, 3, 5 and 8; 0.5 is pending a migration.
  - The task sheet says what each choice means (1 small … 8 very large). With no choice made, it shows "Not estimated — counts as 1 point".
  - Points are summed per Board column, on the Backlog, on History (per month), in Progress and in the export.
- **Group filter** (分组): All groups, each group, or Ungrouped.
  - On the work page it narrows the Board, the Backlog and History. On Progress it narrows every figure and the export.
  - It is kept in the address (`?group=`).
- **History**: collapsed by default. Each person's open/closed choice is remembered per space.
  - Collapsed, the heading still shows its count and points.
  - Open, it offers title search, month groups (each with its true total), completion dates and points, and "Show older" paging.
- **Progress page** (`/together/b/[id]/progress`), top to bottom:
  1. Group, period and member filters.
  2. Committed, completed and completion rate.
  3. The Backlog, shown apart.
  4. Right now: open work by stage, due within a week, overdue.
  5. Story points: overall, and by group.
  6. Individual contributions.
  7. Trend: weekly or monthly bars, with every value in a table.
  8. Export Excel.
  9. "How these numbers work".
- **Excel export**: a real `.xlsx`, either the current view or the entire project.

## Definitions (one module: `src/lib/together/progress.ts`)

The dashboard and the export both call these functions, so a filtered export always matches its dashboard.

- **Story points**:
  - `effective = effort ?? 1`. Nothing is written back, so "not estimated" stays empty in the database.
  - `??` rather than `||` means an explicit 0 would stay 0, if 0 is ever allowed (the schema forbids it today).
  - Every export marks which points were defaulted.
- **Committed** means any stage except the Backlog. **Completed** means in Done now, which includes History. The **completion rate** is completed ÷ committed. The Backlog is shown separately and never enters the rate.
- **A reopened task** is open. Its earlier completion is not recorded anywhere, so it is not claimed.
- **Deleted tasks** (Recently deleted) count nowhere.
- **Counting once**: project, group and trend totals count each task and its points once, however many people are assigned.
- **Periods**, in calendar days in the reader's time zone:
  - The options are All time (default), This month, Last 3 months (the three months up to today), This quarter, This year, and a custom range.
  - A task is *in play* when it was created on or before the period's last day and was not completed before its first day.
  - Tasks completed within the period count as **completed**.
  - **Backlog** tasks count as Backlog.
  - Everything else is **open at the period's end**, including tasks finished only after the period ended.
  - All time is simply every task.
- **Right now** (open work by stage, due within 7 days, overdue) always describes today, whatever the period. It covers committed work only, never the Backlog or Done.
- **Trends**:
  - They count completions by completion date: weekly (Sunday–Saturday, the app's week) for spans under 100 days, monthly otherwise.
  - Totals run from the period's start; All time starts at the first selected task.
  - The chart shows the latest 36 buckets. The table and the export contain every bucket.
- **Groups**:
  - A filter naming a group that no longer exists, or another space's group, is dropped and the person is told. The view widens; it never empties silently.
  - The Progress API and the History API both apply this rule on the server; History marks its answer `dropped`.
  - The Board judges a filter only against its own fresh read of the space, so a group created since its last read is never wrongly refused.
  - Deleting a group makes its tasks Ungrouped (`on delete set null`).
  - Groups are labels: every member sees every group.
  - A task added while the view is filtered to one group joins that group, so it stays in view. The server checks that the group belongs to the space.
- **Contributions** are *completed assigned work*, based on who is assigned now.
  - Each assignee is credited with the whole task and its full points, and tasks with more than one assignee are counted as **shared**.
  - So member rows overlap. They are never added up, and the screen and the export both say so. Project totals count each task once.
  - Backlog tasks are not counted.
  - Members are listed in the order they joined. There are no ranks.
  - Committed work with nobody assigned is listed as "Not assigned to anyone".

## Historical limitations (documented in the app and in every export)

- **Who marked a task Done is not recorded.** `updated_by` is only the last editor, so contributions describe assignment, not action.
- **The completion date** is when the task most recently entered Done (`moved_at` while in Done). Reopening clears it, and an earlier completion is lost.
- **Stage history is not recorded.** A task's commitment is read from its stage now. A task now in To do may have sat in the Backlog during a past period, and Progress cannot know that.
- **Assignment history is not recorded.**
  - Someone who left the space took their assignments with them (cascade).
  - Their finished work shows under any co-assignee, or as not assigned.
  - Past reassignments are invisible.
- **Months and weeks follow the reader's time zone.** Two members in different zones can see a task completed near midnight in different days or months.

An exact record would need a separately approved migration, for example `completed_at` and `completed_by` set on entering Done.

## Excel workbook (`src/lib/together/progressWorkbook.ts`, writer `src/lib/xlsx.ts`)

**Sheets.** Each sheet name is bilingual, for example "Task Details · 任务明细".

1. **Project Summary**:
   - What was exported: space, status, scope, period, group and member filters, time zone, generated at.
   - Committed and completed tasks, completion rate (as a %), committed and completed points, defaulted count.
   - Backlog tasks and points; right-now figures.
   - The definitions.
2. **Group Summary**: per group, then Ungrouped, then Total.
   - Committed, completed, rate, committed and completed points, Backlog tasks and points.
   - Groups partition the tasks, so the rows add up to the Total.
3. **Member Contributions**: each member overall ("All groups"), then per group with assigned work, then Not assigned.
   - Columns: assigned, completed assigned, rate, assigned points, completed assigned points, shared, completed shared.
   - A note on top says rows overlap and must not be added together.
4. **Monthly Trends**: month, completed tasks, completed points, cumulative tasks, cumulative points.
5. **Task Details**: one row per task the view counts, History and Backlog included.
   - Columns: title, type (Together has only tasks), group, current status, History status (On the Board / In History / In the Backlog), how it counts in this period, assignees (display names), shared, story points, points defaulted, created, completed, due.

**Labels and values.** Labels are in both languages ("Story points / 故事点"). Values are in the exporter's language. Points are numbers, so 0.5 keeps its precision. Dates are real Excel dates (`yyyy-mm-dd`) in the reader's zone.

**Safety.**
- No cell is ever a formula.
- Text starting with `= + - @`, a tab or a carriage return carries `quotePrefix`, so it stays text even after someone edits it.
- Text that XML cannot carry is dropped.

**Delivery.**
- `GET /api/together/boards/[id]/progress/export?scope=view|all&…`, members only. Anyone else gets the same 404 as a missing space.
- `Cache-Control: private, no-store`.
- The file name uses the space's name (RFC 5987), with an ASCII fallback.

**No new dependency.** The writer uses only `node:zlib`. It was validated with openpyxl, `unzip -t`, `zipinfo` and `xmllint`, and its 22 tests catch 21 injected faults.

## Security, privacy, analytics, performance

- **Access**: every route goes through `togetherRoute` and `requireBoard`. Filters are checked against the space, so another space's group or member ids are dropped.
- **What leaves**: the dashboard API returns numbers plus the space's group and member display names, never task titles. Titles leave only in an export a member asks for. No email addresses anywhere.
- **Analytics** carry no words:
  - `together_progress_viewed` records the period kind and whether a filter was on, once per page load.
  - `together_progress_exported` records the scope and the task count.
- **Performance**: one read per filter change. Two small queries fetch the space's live tasks and assignments, and the aggregation runs in TypeScript. It scales linearly; it is fine for thousands of tasks, though it is not tuned for hundreds of thousands. History search uses `strpos`, so there are no wildcards to escape. Open tasks are capped at 1,000 per space; History is unbounded and paged at 20.

## 0.5 story points: needs a migration (awaiting approval)

`together_tasks.effort` is `smallint check (effort between 1 and 99)`, so 0.5 cannot be stored. Proposed migration (additive and non-destructive; every stored value is kept exactly):

```sql
alter table together_tasks alter column effort type numeric(4,1);   -- 1 → 1.0 … 8 → 8.0; a table rewrite, brief exclusive lock
alter table together_tasks drop constraint together_tasks_effort_check;
alter table together_tasks add constraint together_tasks_effort_check
  check (effort is null or (effort > 0 and effort <= 99 and effort * 2 = trunc(effort * 2)));   -- halves allowed
```

After the migration:
- Read the column as `effort::float8`; node-postgres returns `numeric` as text.
- Add 0.5 to `EFFORT_CHOICES` and update the validation message.
- The code is already 0.5-ready: all sums, formatting ("0.5 pts") and the export keep halves exactly.

There is no rollback to `smallint` once halves are stored. Keeping `numeric` is harmless.
