import { describe, expect, it } from "vitest";
import {
  DEFAULT_POINTS, buildReport, byGroup, contextOf, contributionsOf, effectivePoints, filterParam, granularityFor, openNow,
  resolvePeriod, standing, totalsOf, trendOf, trendSpan, type Period, type ProgressTask,
} from "../src/lib/together/progress";

/**
 * Project Progress & Contributions, the rules on plain data: what counts as
 * committed and completed, how a period selects tasks, the 1-point default,
 * counting a shared task once in totals and in full for each person, and
 * trends across years. The database and the screen are tested elsewhere; every
 * number they show comes from these functions.
 */

const ALL: Period = { kind: "all", from: null, to: null };
const OCT: Period = { kind: "month", from: "2026-10-01", to: "2026-10-31" };
let seq = 0;
const task = (over: Partial<ProgressTask> = {}): ProgressTask => ({
  id: `t${++seq}`, stage: "todo", groupId: null, effort: null, createdOn: "2026-10-01", completedOn: null,
  dueOn: null, assignees: [], inHistory: false, ...over,
});
const done = (completedOn: string, over: Partial<ProgressTask> = {}) =>
  task({ stage: "done", completedOn, createdOn: over.createdOn ?? completedOn, ...over });

describe("story points", () => {
  it("counts a task with no estimate as 1, and keeps every explicit value — 0.5 included — exactly", () => {
    expect(DEFAULT_POINTS).toBe(1);
    expect(effectivePoints(null)).toBe(1);
    expect(effectivePoints(undefined)).toBe(1);
    for (const n of [0.5, 1, 2, 3, 5, 8]) expect(effectivePoints(n)).toBe(n);
    // An explicit zero, were one ever allowed, stays zero: `??`, not `||`.
    expect(effectivePoints(0)).toBe(0);
  });

  it("sums halves exactly and says how many tasks were defaulted", () => {
    const t = totalsOf([task({ effort: 0.5 }), task({ effort: 0.5 }), task({ effort: 0.5 }), task(), done("2026-10-02", { effort: 8 })], ALL);
    expect(t.committed).toEqual({ tasks: 5, points: 0.5 * 3 + 1 + 8 });
    expect(t.committed.points).toBe(10.5);
    expect(t.defaulted).toBe(1);
    expect(t.completed).toEqual({ tasks: 1, points: 8 });
  });
});

describe("periods", () => {
  const today = "2026-10-20";
  it("resolves each choice to calendar days in the reader's zone", () => {
    expect(resolvePeriod("all", today)).toEqual(ALL);
    expect(resolvePeriod("month", today)).toEqual({ kind: "month", from: "2026-10-01", to: "2026-10-31" });
    expect(resolvePeriod("3m", today)).toEqual({ kind: "3m", from: "2026-07-21", to: "2026-10-20" });
    expect(resolvePeriod("quarter", today)).toEqual({ kind: "quarter", from: "2026-10-01", to: "2026-12-31" });
    expect(resolvePeriod("quarter", "2026-02-11")).toEqual({ kind: "quarter", from: "2026-01-01", to: "2026-03-31" });
    expect(resolvePeriod("year", today)).toEqual({ kind: "year", from: "2026-01-01", to: "2026-12-31" });
    // Three months back from the 31st lands on the shorter month's last day, then the day after.
    expect(resolvePeriod("3m", "2026-05-31")).toEqual({ kind: "3m", from: "2026-03-01", to: "2026-05-31" });
    expect(resolvePeriod("month", "2028-02-10")?.to).toBe("2028-02-29");
  });

  it("takes a custom range of two real dates, in either order, and refuses anything else", () => {
    expect(resolvePeriod("custom", today, "2025-01-01", "2025-03-31")).toEqual({ kind: "custom", from: "2025-01-01", to: "2025-03-31" });
    expect(resolvePeriod("custom", today, "2025-03-31", "2025-01-01")).toEqual({ kind: "custom", from: "2025-01-01", to: "2025-03-31" });
    for (const [f, t] of [["2025-02-30", "2025-03-01"], ["", "2025-03-01"], [null, null], ["1999-12-31", "2025-01-01"], ["2025-1-1", "2025-02-01"]]) {
      expect(resolvePeriod("custom", today, f, t), `${f}..${t}`).toBeNull();
    }
  });

  it("places a task by when it was created and when it was finished — the only dates there are", () => {
    // Created after the period: not in play.
    expect(standing(task({ createdOn: "2026-11-02" }), OCT)).toBeNull();
    // Finished before the period began: not in play.
    expect(standing(done("2026-09-30", { createdOn: "2026-09-01" }), OCT)).toBeNull();
    // Finished within it: completed — whether still on the Board or long in History.
    expect(standing(done("2026-10-05"), OCT)).toBe("completed");
    expect(standing(done("2026-10-31", { inHistory: true }), OCT)).toBe("completed");
    // Finished only after it ended: still open at the period's end.
    expect(standing(done("2026-11-03", { createdOn: "2026-10-04" }), OCT)).toBe("open");
    // Open now and created before the period ended: open.
    expect(standing(task({ createdOn: "2025-06-01", stage: "waiting" }), OCT)).toBe("open");
    // Backlog ideas stand apart.
    expect(standing(task({ stage: "backlog" }), OCT)).toBe("backlog");
    // A reopened task has left Done: it is open, and its earlier completion is not claimed anywhere.
    expect(standing(task({ stage: "doing", createdOn: "2026-01-04", completedOn: null }), ALL)).toBe("open");
  });

  it("makes the completion rate completed ÷ committed, with the Backlog left out — and no rate without commitments", () => {
    const t = totalsOf([done("2026-10-02"), done("2026-10-03"), task(), task({ stage: "doing" }), task({ stage: "backlog", effort: 5 })], ALL);
    expect(t.committed.tasks).toBe(4);
    expect(t.completed.tasks).toBe(2);
    expect(t.open.tasks).toBe(2);
    expect(t.rate).toBe(0.5);
    expect(t.backlog).toEqual({ tasks: 1, points: 5 });
    expect(totalsOf([task({ stage: "backlog" })], ALL).rate).toBeNull();
    expect(totalsOf([], ALL).rate).toBeNull();
  });
});

describe("filters", () => {
  it("reads group and member filters from an address, widening anything unreadable to all", () => {
    expect(filterParam("none")).toBe("none");
    expect(filterParam("2F1C8A6E-0C4B-4F7A-9B7E-6F0B1D2C3A4E")).toBe("2f1c8a6e-0c4b-4f7a-9b7e-6f0b1d2c3a4e");
    for (const raw of [null, undefined, "", "all", "design", "1; drop table", 42]) expect(filterParam(raw)).toBe("all");
  });

  it("splits work by group, ungrouped last; a group no longer listed is ungrouped work, not lost work", () => {
    const tasks = [
      done("2026-10-02", { groupId: "g1", effort: 3 }), task({ groupId: "g1" }), task({ groupId: "g2", stage: "backlog" }),
      task({ groupId: null, effort: 2 }), task({ groupId: "gone" }),
    ];
    const rows = byGroup(tasks, ALL, ["g1", "g2"]);
    expect(rows.map((r) => r.groupId)).toEqual(["g1", "g2", null]);
    expect(rows[0]).toMatchObject({ committed: { tasks: 2, points: 4 }, completed: { tasks: 1, points: 3 }, rate: 0.5 });
    expect(rows[1]).toMatchObject({ committed: { tasks: 0 }, backlog: { tasks: 1, points: 1 }, rate: null });
    expect(rows[2]).toMatchObject({ committed: { tasks: 2, points: 3 } });
    // Groups partition the tasks: the rows add up to the project's totals.
    const total = totalsOf(tasks, ALL);
    expect(rows.reduce((n, r) => n + r.committed.tasks, 0)).toBe(total.committed.tasks);
    expect(rows.reduce((n, r) => n + r.committed.points, 0)).toBe(total.committed.points);
  });

  it("combines group, member and period filters, and every number follows them", () => {
    const tasks = [
      done("2026-10-05", { groupId: "g1", assignees: ["ann"], effort: 2 }),
      done("2026-09-10", { groupId: "g1", assignees: ["ann"], effort: 5 }),     // before October
      task({ groupId: "g1", assignees: ["ann", "bo"], effort: 3 }),
      task({ groupId: "g2", assignees: ["ann"] }),
      task({ groupId: "g1", assignees: [] }),
      task({ groupId: "g1", assignees: ["bo"], createdOn: "2026-11-05" }),      // after October
    ];
    const r = buildReport(tasks, { period: OCT, group: "g1", member: "ann" }, "2026-10-20", ["ann", "bo"], ["g1", "g2"]);
    expect(r.totals.committed).toEqual({ tasks: 2, points: 5 });
    expect(r.totals.completed).toEqual({ tasks: 1, points: 2 });
    expect(r.contributions.map((c) => c.memberId)).toEqual(["ann"]);
    const nobody = buildReport(tasks, { period: ALL, group: "g1", member: "none" }, "2026-10-20", ["ann", "bo"], ["g1", "g2"]);
    expect(nobody.totals.committed.tasks).toBe(1);
    expect(nobody.contributions).toHaveLength(1);
    expect(nobody.contributions[0]).toMatchObject({ memberId: null, assigned: { tasks: 1 } });
    const ungrouped = buildReport([...tasks, task({ assignees: ["bo"] })], { period: ALL, group: "none", member: "all" }, "2026-10-20", ["ann", "bo"], ["g1", "g2"]);
    expect(ungrouped.totals.committed.tasks).toBe(1);
  });
});

describe("individual contributions", () => {
  const people = ["ann", "bo", "cy"];
  const tasks = [
    done("2026-10-02", { assignees: ["ann", "bo"], effort: 5 }),   // shared, finished
    task({ assignees: ["ann", "bo"], effort: 3 }),                 // shared, open
    done("2026-10-03", { assignees: ["ann"], effort: 2 }),
    task({ assignees: ["cy"] }),                                   // no estimate: 1
    done("2026-10-04"),                                            // nobody assigned
    task({ assignees: ["ann"], stage: "backlog", effort: 8 }),     // an idea, not a commitment
  ];

  it("credits every assignee with the whole task, marks it shared, and leaves the Backlog out", () => {
    const rows = contributionsOf(tasks, ALL, people);
    const ann = rows.find((r) => r.memberId === "ann")!;
    const bo = rows.find((r) => r.memberId === "bo")!;
    expect(ann).toMatchObject({ assigned: { tasks: 3, points: 10 }, completed: { tasks: 2, points: 7 }, shared: 2, sharedCompleted: 1 });
    expect(ann.rate).toBeCloseTo(2 / 3);
    expect(bo).toMatchObject({ assigned: { tasks: 2, points: 8 }, completed: { tasks: 1, points: 5 }, shared: 2, sharedCompleted: 1 });
    expect(rows.find((r) => r.memberId === "cy")).toMatchObject({ assigned: { tasks: 1, points: 1 }, completed: { tasks: 0 }, rate: 0, shared: 0 });
    expect(rows.find((r) => r.memberId === null)).toMatchObject({ assigned: { tasks: 1, points: 1 }, completed: { tasks: 1, points: 1 } });
  });

  it("never counts a shared task twice in the project's totals, though people's rows overlap", () => {
    const totals = totalsOf(tasks, ALL);
    expect(totals.committed).toEqual({ tasks: 5, points: 5 + 3 + 2 + 1 + 1 });
    const rows = contributionsOf(tasks, ALL, people);
    const summed = rows.reduce((n, r) => n + r.assigned.points, 0);
    expect(summed).toBe(10 + 8 + 1 + 1);
    expect(summed).toBeGreaterThan(totals.committed.points);   // which is why the screen never adds them up
  });

  it("lists members in the order given — never by how much they did", () => {
    expect(contributionsOf(tasks, ALL, ["cy", "ann", "bo"]).map((r) => r.memberId)).toEqual(["cy", "ann", "bo", null]);
  });
});

describe("right now", () => {
  it("counts open committed work by stage, and what is due within a week or overdue — never Done or the Backlog", () => {
    const now = openNow([
      task({ dueOn: "2026-10-19" }), task({ stage: "doing", dueOn: "2026-10-20" }), task({ stage: "waiting", dueOn: "2026-10-26" }),
      task({ dueOn: "2026-10-27" }), task({ stage: "backlog", dueOn: "2026-10-01" }), done("2026-10-02", { dueOn: "2026-10-01" }),
    ], "2026-10-20");
    expect(now.todo.tasks).toBe(2);
    expect(now.doing.tasks).toBe(1);
    expect(now.waiting.tasks).toBe(1);
    expect(now.overdue).toBe(1);
    expect(now.dueSoon).toBe(2);
  });
});

describe("trends", () => {
  it("is weekly for up to about three months and monthly beyond", () => {
    expect(granularityFor({ from: "2026-10-01", to: "2026-10-31" })).toBe("week");
    expect(granularityFor({ from: "2026-07-21", to: "2026-10-20" })).toBe("week");
    expect(granularityFor({ from: "2026-01-01", to: "2026-10-20" })).toBe("month");
  });

  it("counts completions per Sunday-to-Saturday week, clipped to the period, with running totals", () => {
    const tasks = [done("2026-10-01", { effort: 0.5 }), done("2026-10-03"), done("2026-10-04", { effort: 3 }), done("2026-10-20", { effort: 2 }), done("2026-09-30")];
    const span = trendSpan(OCT, "2026-10-20", null)!;
    expect(span).toEqual({ from: "2026-10-01", to: "2026-10-20" });  // never past today
    const weeks = trendOf(tasks, span, "week");
    expect(weeks.map((b) => [b.start, b.end, b.tasks, b.points])).toEqual([
      ["2026-10-01", "2026-10-03", 2, 1.5],
      ["2026-10-04", "2026-10-10", 1, 3],
      ["2026-10-11", "2026-10-17", 0, 0],
      ["2026-10-18", "2026-10-20", 1, 2],
    ]);
    expect(weeks.at(-1)).toMatchObject({ cumTasks: 4, cumPoints: 6.5 });
  });

  it("covers a multi-year project month by month, from its first task, with History in full", () => {
    const tasks: ProgressTask[] = [];
    for (let m = 0; m < 30; m++) {
      const y = 2024 + Math.floor(m / 12), mo = String((m % 12) + 1).padStart(2, "0");
      tasks.push(done(`${y}-${mo}-15`, { createdOn: `${y}-${mo}-01`, inHistory: true, effort: m % 2 ? null : 2 }));
    }
    tasks.push(task({ createdOn: "2026-07-01", stage: "doing" }));
    const r = buildReport(tasks, { period: ALL, group: "all", member: "all" }, "2026-10-20", [], []);
    expect(r.firstDay).toBe("2024-01-01");
    expect(r.trend.granularity).toBe("month");
    expect(r.trend.buckets).toHaveLength(34);   // Jan 2024 – Oct 2026
    expect(r.trend.buckets[0].start).toBe("2024-01-01");
    expect(r.trend.buckets.at(-1)).toMatchObject({ start: "2026-10-01", end: "2026-10-20", cumTasks: 30, cumPoints: 15 * 2 + 15 });
    expect(r.totals).toMatchObject({ completed: { tasks: 30, points: 45 }, committed: { tasks: 31 } });
  });

  it("has nothing to chart for a space with no work, or a period wholly in the future", () => {
    expect(trendSpan(ALL, "2026-10-20", null)).toBeNull();
    expect(trendSpan({ kind: "custom", from: "2027-01-01", to: "2027-02-01" }, "2026-10-20", "2026-01-01")).toBeNull();
    expect(buildReport([], { period: ALL, group: "all", member: "all" }, "2026-10-20", [], []).trend.buckets).toEqual([]);
  });
});

describe("long-run context", () => {
  it("states when the space's work began, the selection's last completion and this month's completions — nothing inferred", () => {
    const all = [task({ createdOn: "2024-01-05" }), done("2026-10-03", { createdOn: "2026-09-01" }), done("2026-09-28"),
      task({ stage: "doing", createdOn: "2025-02-01", completedOn: null })];   // reopened: no completion date to count
    expect(contextOf(all, all, "2026-10-20")).toEqual({ start: "2024-01-05", lastCompleted: "2026-10-03", completedThisMonth: 1 });
    // The start is the space's; the rest follow the selection.
    expect(contextOf(all, [all[2]], "2026-10-20")).toEqual({ start: "2024-01-05", lastCompleted: "2026-09-28", completedThisMonth: 0 });
    expect(contextOf([], [], "2026-10-20")).toEqual({ start: null, lastCompleted: null, completedThisMonth: 0 });
  });
});
