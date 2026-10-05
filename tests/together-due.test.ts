import { describe, expect, it } from "vitest";
import { dueState, isDueDate, isWarm, quickDue } from "../src/lib/together/due";
import { dict } from "../src/lib/i18n";

/** A due date is a pure calendar date, read against the reader's own today — calmly. */
describe("due dates", () => {
  it("reads a date against today: overdue, today, tomorrow, this week, later", () => {
    const today = "2026-10-05";
    expect(dueState("2026-10-04", today)).toBe("overdue");
    expect(dueState("2025-12-31", today)).toBe("overdue");
    expect(dueState("2026-10-05", today)).toBe("today");
    expect(dueState("2026-10-06", today)).toBe("tomorrow");
    expect(dueState("2026-10-11", today)).toBe("soon");
    expect(dueState("2026-10-12", today)).toBe("later");
  });

  it("crosses month, year and daylight-saving boundaries by calendar day, not by hours", () => {
    expect(dueState("2027-01-01", "2026-12-31")).toBe("tomorrow");
    expect(dueState("2026-11-02", "2026-11-01")).toBe("tomorrow"); // US clocks change on Nov 1, 2026
    expect(dueState("2026-03-09", "2026-03-08")).toBe("tomorrow");
  });

  it("is warm — never alarming — only for today and overdue", () => {
    expect(["overdue", "today"].map((s) => isWarm(s as never))).toEqual([true, true]);
    expect(["tomorrow", "soon", "later"].map((s) => isWarm(s as never))).toEqual([false, false, false]);
  });

  it("offers Today, Tomorrow and the coming Monday", () => {
    expect(quickDue("2026-10-05")).toEqual({ today: "2026-10-05", tomorrow: "2026-10-06", nextWeek: "2026-10-12" }); // a Monday
    expect(quickDue("2026-10-09").nextWeek).toBe("2026-10-12"); // Friday → Monday
    expect(quickDue("2026-10-11").nextWeek).toBe("2026-10-12"); // Sunday → tomorrow's Monday
  });

  it("accepts only real calendar dates in range", () => {
    for (const ok of ["2026-10-09", "2028-02-29", "2000-01-01", "2100-12-31"]) expect(isDueDate(ok), ok).toBe(true);
    for (const bad of ["2026-02-29", "2026-13-01", "2026-00-10", "1999-12-31", "2101-01-01", "2026-1-9", "", null, 20261009]) {
      expect(isDueDate(bad), String(bad)).toBe(false);
    }
  });

  it("says it in each language, and in both", () => {
    expect(dict("en").together.work.due.overdue("2026-10-02")).toBe("Was due Oct 2");
    expect(dict("zh").together.work.due.overdue("2026-10-02")).toBe("原定10月2日");
    expect(dict("en").together.work.due.soon("2026-10-09")).toBe("Fri");
    expect(dict("both").together.work.due.today).toBe("Today · 今天");
  });
});

describe("terminology", () => {
  it("uses the approved words, and keeps 看板 for the board and 空间 for the space", () => {
    const en = dict("en").together.work;
    const zh = dict("zh").together.work;
    expect([en.board, en.backlog, en.stages.todo, en.stages.doing, en.stages.waiting, en.stages.done, en.group, en.effort, en.dueDate, en.moveTo, en.formerMember])
      .toEqual(["Board", "Backlog", "To do", "In progress", "Waiting", "Done", "Group", "Effort", "Due date", "Move to…", "Former member"]);
    expect([zh.board, zh.backlog, zh.stages.todo, zh.stages.doing, zh.stages.waiting, zh.stages.done, zh.group, zh.effort, zh.dueDate, zh.moveTo, zh.formerMember])
      .toEqual(["看板", "想法池", "待办", "进行中", "等待中", "已完成", "分组", "工作量", "截止日期", "移到…", "前成员"]);
  });

  it("names a stage once per language in bilingual sentences — never a bilingual label inside a bilingual sentence", () => {
    const both = dict("both").together.work;
    expect(both.addTo("todo")).toBe("Add to To do · 添加到「待办」");
    expect(both.movedTo("doing")).toBe("Moved to In progress · 已移到「进行中」");
    expect(both.stageTab("done", 3)).toBe("Done, 3 tasks · 已完成，3 项");
    const former = both.addedBy(null, "2026-10-04T12:00:00Z");
    expect(former.match(/former member/g)).toHaveLength(1);
    expect(former.match(/前成员/g)).toHaveLength(1);
    expect(dict("en").together.work.addedBy("Meiling", "2026-10-04T12:00:00Z", true)).toMatch(/^Added by Meiling \(you\) · Oct 4, 2026$/);
    expect(dict("zh").together.work.addedBy("Meiling", "2026-10-04T12:00:00Z", true)).toMatch(/^Meiling（你） 添加于 2026年10月4日$/);
  });

  it("calls the container a space in English, now that “Board” names the work board", () => {
    const strings: string[] = [];
    const walk = (v: unknown, at: string) => {
      if (typeof v === "string") strings.push(`${at}: ${v}`);
      else if (typeof v === "function") strings.push(`${at}: ${String((v as Function)("X", 2, true, false))}`);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
    };
    const { work, errors, ...rest } = dict("en").together;
    const { stageInvalid, ...otherErrors } = errors;
    walk(rest, "together");
    walk(otherErrors, "together.errors");
    expect(strings.filter((s) => /\bboards?\b/i.test(s.split(": ")[1]))).toEqual([]);
    // Inside the work strings, "board" is the work board itself.
    expect(work.backlogIntro).toMatch(/commit it to the board/);
    expect(stageInvalid).toMatch(/board/);
  });
});
