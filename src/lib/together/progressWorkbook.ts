import { dict, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import {
  buildReport, contributionsOf, effectivePoints, matchesGroup, matchesMember, standing, trendOf, trendSpan,
  type ContributionRow, type GroupRow, type ReportFilters, type Standing,
} from "@/lib/together/progress";
import type { ExportScope, ExportTask, Snapshot } from "@/lib/together/progressRead";
import { BOARD_STAGES, type Stage } from "@/lib/together/stages";
import { instantToZoned } from "@/lib/zonedTime";
import { buildXlsx, type Cell, type SheetSpec } from "@/lib/xlsx";

/**
 * The Excel workbook for a space's progress — five sheets, built from exactly
 * the numbers the dashboard shows (`buildReport` and its parts), so a filtered
 * export matches the screen it came from:
 *
 *   1. Project Summary      — what was exported, and the key totals, with the definitions
 *   2. Group Summary        — the same totals per group, ungrouped work last, then the total
 *   3. Member Contributions — completed assigned work per member, overall and per group
 *   4. Monthly Trends       — completions per month, with running totals
 *   5. Task Details         — one row per task the view counts, History included
 *
 * Labels are bilingual ("Story points / 故事点") so a file passed between people
 * who read different languages is readable by both; values — stages, Yes/No,
 * the definitions — are in the exporter's own language. Members appear by
 * display name only. Points are numbers, so 0.5 keeps its precision and sums
 * work in Excel; dates are real dates in the reader's time zone.
 */

type Text = Dict["together"]["progress"]["xlsx"];
const EN = dict("en"), ZH = dict("zh");
type Key = { [K in keyof Text]: Text[K] extends string ? K : never }[keyof Text];
/** A label in both languages. */
const label = (key: Key) => `${EN.together.progress.xlsx[key]} / ${ZH.together.progress.xlsx[key]}`;
const sheetName = (key: Key) => `${EN.together.progress.xlsx[key]} · ${ZH.together.progress.xlsx[key]}`;

const date = (value: string | null): Cell => (value ? { value, format: "date" } : null);
const percent = (rate: number | null): Cell => (rate === null ? null : { value: rate, format: "percent" });
const bold = (value: string): Cell => ({ value, bold: true });

const STAGE_ORDER: Stage[] = [...BOARD_STAGES, "backlog"];

/**
 * A file name from the space's own name: no characters a file system refuses,
 * no lone half of a surrogate pair (which URI-encoding the header would choke
 * on), and at most 60 characters — counted whole, so an emoji is never cut in two.
 */
export const safeName = (name: string) =>
  Array.from(name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]|[\uD800-\uDFFF]/gu, "").replace(/\s+/g, " ").trim())
    .slice(0, 60).join("").trim() || "Together";

export function progressWorkbook(snap: Snapshot, filters: ReportFilters, scope: ExportScope, locale: Locale) {
  const d = dict(locale);
  const v = d.together.progress.xlsx;
  const stages = d.together.work.stages;
  const memberIds = snap.members.map((m) => m.id);
  const groupIds = snap.groups.map((g) => g.id);
  const nameOf = new Map(snap.members.map((m) => [m.id, m.name]));
  const groupName = (id: string | null) => (id === null ? v.ungrouped : snap.groups.find((g) => g.id === id)?.name ?? v.ungrouped);

  const report = buildReport(snap.tasks, filters, snap.today, memberIds, groupIds);
  const selected = snap.tasks.filter((x) => matchesGroup(x, filters.group) && matchesMember(x, filters.member));
  const { totals, now } = report;

  const periodText = filters.period.from === null || filters.period.to === null
    ? v.allTime : v.range(filters.period.from, filters.period.to);
  const groupText = filters.group === "all" ? v.allGroups : groupName(filters.group === "none" ? null : filters.group);
  const memberText = filters.member === "all" ? v.everyone : filters.member === "none" ? v.unassigned : nameOf.get(filters.member) ?? v.everyone;
  const generated = instantToZoned(snap.nowMs, snap.timeZone);

  /* 1 — Project Summary */
  const summary: Cell[][] = [
    [label("item"), label("value")],
    [label("space"), snap.space.name],
    [label("spaceStatus"), snap.space.archived ? v.archived : v.active],
    [label("scope"), scope === "all" ? v.scopeAll : v.scopeView],
    [label("period"), periodText],
    [label("groupFilter"), groupText],
    [label("memberFilter"), memberText],
    [label("timeZone"), snap.timeZone],
    [label("generated"), `${generated.date} ${generated.time}`],
    [],
    [label("committed"), totals.committed.tasks],
    [label("completed"), totals.completed.tasks],
    [label("rate"), percent(totals.rate)],
    [label("committedPoints"), totals.committed.points],
    [label("completedPoints"), totals.completed.points],
    [label("defaulted"), totals.defaulted],
    [label("backlog"), totals.backlog.tasks],
    [label("backlogPoints"), totals.backlog.points],
    ...(["todo", "doing", "waiting"] as const).map((s): Cell[] =>
      [`${EN.together.progress.xlsx.nowStage(EN.together.work.stages[s])} / ${ZH.together.progress.xlsx.nowStage(ZH.together.work.stages[s])}`, now[s].tasks]),
    [label("dueSoon"), now.dueSoon],
    [label("overdue"), now.overdue],
    [],
    [bold(d.together.progress.howTitle)],
    ...d.together.progress.how.map((line): Cell[] => [{ value: line, wrap: true }]),
  ];

  /* 2 — Group Summary: the rows the filter selects; the total only when they are all there. */
  const groupRow = (name: string, r: Pick<GroupRow, "committed" | "completed" | "backlog" | "rate">): Cell[] =>
    [name, r.committed.tasks, r.completed.tasks, percent(r.rate), r.committed.points, r.completed.points, r.backlog.tasks, r.backlog.points];
  const shownGroups = report.groups.filter((r) => filters.group === "all"
    || (filters.group === "none" ? r.groupId === null : r.groupId === filters.group));
  const groups: Cell[][] = [
    [label("group"), label("committedTasks"), label("completedTasks"), label("completionRate"),
      label("committedPts"), label("completedPts"), label("backlogTasks"), label("backlogPts")],
    ...shownGroups.map((r) => groupRow(groupName(r.groupId), r)),
    ...(filters.group === "all" ? [groupRow(v.total, totals).map((c, i) => (i === 0 ? bold(c as string) : c))] : []),
  ];

  /* 3 — Member Contributions: each person overall, then per group they have assigned work in. */
  const memberRow = (who: string, group: string, r: ContributionRow): Cell[] =>
    [who, group, r.assigned.tasks, r.completed.tasks, percent(r.rate), r.assigned.points, r.completed.points, r.shared, r.sharedCompleted];
  const overall = report.contributions;
  const perGroup = filters.group === "all"
    ? [...groupIds, null].map((g) => ({ g, rows: contributionsOf(selected.filter((x) => (g === null ? x.groupId === null : x.groupId === g)), filters.period, memberIds) }))
    : [];
  const members: Cell[][] = [
    [{ value: v.membersNote, wrap: true }],
    [],
    [label("member"), label("group"), label("assignedTasks"), label("completedAssigned"), label("completionRate"),
      label("assignedPoints"), label("completedAssignedPoints"), label("sharedTasks"), label("sharedCompleted")],
  ];
  for (const row of overall) {
    const who = row.memberId === null ? v.unassigned : nameOf.get(row.memberId) ?? v.unassigned;
    members.push(memberRow(who, filters.group === "all" ? v.allGroups : groupText, row));
    for (const { g, rows } of perGroup) {
      const mine = rows.find((r) => r.memberId === row.memberId);
      if (mine && mine.assigned.tasks > 0) members.push(memberRow(who, groupName(g), mine));
    }
  }

  /* 4 — Monthly Trends, whatever the dashboard's own granularity. */
  const span = trendSpan(filters.period, snap.today, report.firstDay);
  const trends: Cell[][] = [
    [label("month"), label("completedTasks"), label("completedPts"), label("cumTasks"), label("cumPoints")],
    ...(span ? trendOf(selected, span, "month") : []).map((b): Cell[] =>
      [{ value: b.start.slice(0, 7), format: "text" }, b.tasks, b.points, b.cumTasks, b.cumPoints]),
  ];

  /* 5 — Task Details: every task the view counts, Backlog included, in board order. */
  const standingText: Record<Standing, string> = { completed: v.standingCompleted, open: v.standingOpen, backlog: v.standingBacklog };
  const listed = selected
    .map((task) => ({ task, s: standing(task, filters.period) }))
    .filter((x): x is { task: ExportTask; s: Standing } => x.s !== null)
    .sort((a, b) => STAGE_ORDER.indexOf(a.task.stage) - STAGE_ORDER.indexOf(b.task.stage)
      || (a.task.completedOn && b.task.completedOn ? (a.task.completedOn < b.task.completedOn ? 1 : a.task.completedOn > b.task.completedOn ? -1 : 0) : 0)
      || (a.task.createdOn < b.task.createdOn ? -1 : a.task.createdOn > b.task.createdOn ? 1 : 0));
  const tasks: Cell[][] = [
    [label("task"), label("type"), label("group"), label("status"), label("where"), label("standing"),
      label("assignees"), label("shared"), label("points"), label("defaultedCol"), label("created"), label("completedOn"), label("due")],
    ...listed.map(({ task, s }): Cell[] => {
      const people = task.assignees.map((id) => nameOf.get(id)).filter((n): n is string => !!n);
      return [
        task.title, v.typeTask, groupName(task.groupId), stages[task.stage],
        task.inHistory ? v.inHistory : task.stage === "backlog" ? v.inBacklog : v.onBoard,
        standingText[s], people.join("; "), people.length > 1 ? v.yes : v.no,
        effectivePoints(task.effort), task.effort === null ? v.yes : v.no,
        date(task.createdOn), date(task.completedOn), date(task.dueOn),
      ];
    }),
  ];

  const sheets: SheetSpec[] = [
    { name: sheetName("sheetSummary"), rows: summary, widths: [58, 44], boldRows: [0], freezeRows: 1 },
    { name: sheetName("sheetGroups"), rows: groups, widths: [28, 14, 14, 14, 16, 16, 14, 14], boldRows: [0], freezeRows: 1 },
    { name: sheetName("sheetMembers"), rows: members, widths: [26, 22, 14, 18, 14, 16, 20, 12, 16], boldRows: [2], freezeRows: 3 },
    { name: sheetName("sheetTrends"), rows: trends, widths: [12, 16, 18, 20, 22], boldRows: [0], freezeRows: 1 },
    { name: sheetName("sheetTasks"), rows: tasks, widths: [46, 10, 18, 14, 16, 22, 30, 10, 12, 16, 12, 12, 12], boldRows: [0], freezeRows: 1 },
  ];
  const day = snap.today;
  return {
    body: buildXlsx(sheets, { title: `${snap.space.name} — ${EN.together.progress.title}`, creator: "RichHabit", created: new Date(snap.nowMs) }),
    filename: `${safeName(snap.space.name)} - ${v.file} - ${day}.xlsx`,
    asciiName: `together-progress-${day}.xlsx`,
    tasks: listed.length,
  };
}
