import { describe, expect, it } from "vitest";
import {
  addMonths, daysInMonth, monthGrid, monthOf, monthsBetween,
} from "../src/lib/dates";
import {
  DEFAULT_EVENT_COLOR, EVENT_COLORS, MAX_EVENT_DAYS,
  colorHex, compareEvents, covers, eventLength, eventProblem, eventsOn, isEventColor,
  layoutWeek, layoutWeekCapped, overlaps, pastEvents, upcomingEvents, withEnd, withStart,
} from "../src/lib/importantDates";
import { parseImportantDate } from "../src/lib/validate";
import { isSchemaBehind } from "../src/lib/db/diagnose";
import { LOCALES, dateRangeFor, dict, monthTitleFor } from "../src/lib/i18n";
import { emptyState } from "../src/lib/types";
import type { ImportantDate } from "../src/lib/types";

/**
 * §26. Important Dates.
 *
 * The interesting cases are all about a range being one thing: it has to stay
 * one thing across a week boundary, across a month boundary, across a year, and
 * when it is edited. Everything below is a pure function, so a range crossing
 * December is testable without a database or a browser.
 */

const ID = "11111111-1111-4111-8111-111111111111";
let n = 0;
const ev = (
  startDate: string, endDate = startDate, title = `event ${++n}`, extra: Partial<ImportantDate> = {},
): ImportantDate => ({
  id: `id-${title}`, title, startDate, endDate, note: "", color: "blue", kind: "none", ...extra,
});

describe("months", () => {
  it("moves by the calendar, not by 30 days", () => {
    expect(addMonths("2026-08", 1)).toBe("2026-09");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-03", -14)).toBe("2025-01");
    expect(addMonths("2026-08", 0)).toBe("2026-08");
  });

  it("counts the distance between two months in both directions", () => {
    expect(monthsBetween("2026-08", "2026-09")).toBe(1);
    expect(monthsBetween("2026-09", "2026-08")).toBe(-1);
    expect(monthsBetween("2025-12", "2026-01")).toBe(1);
  });

  it("knows the length of a month, February included", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);   // leap
    expect(daysInMonth("2026-08")).toBe(31);
    expect(daysInMonth("2026-09")).toBe(30);
  });

  it("builds whole Sunday-to-Saturday weeks", () => {
    for (const month of ["2026-08", "2026-09", "2028-02", "2026-01", "2026-12"]) {
      const weeks = monthGrid(month);
      for (const week of weeks) expect(week).toHaveLength(7);
      // Every day of the month is present exactly once.
      const flat = weeks.flat();
      for (let d = 1; d <= daysInMonth(month); d++) {
        const day = `${month}-${String(d).padStart(2, "0")}`;
        expect(flat.filter((x) => x === day)).toHaveLength(1);
      }
      // Consecutive, with no gaps and no repeats anywhere in the grid.
      expect(new Set(flat).size).toBe(flat.length);
    }
  });

  /* The days from the neighbouring months are real dates, which is what lets a
     range that crosses the boundary be drawn in both grids. */
  it("fills the edges with the neighbouring months' real days", () => {
    const weeks = monthGrid("2026-08");          // 1 Aug 2026 is a Saturday
    expect(weeks[0][0]).toBe("2026-07-26");
    expect(weeks[weeks.length - 1][6]).toBe("2026-09-05");
    expect(monthOf(weeks[0][0])).toBe("2026-07");
  });

  it("crosses the new year without losing a month", () => {
    const weeks = monthGrid("2025-12");
    expect(weeks.flat()).toContain("2025-12-31");
    expect(weeks.flat()).toContain("2026-01-01");
  });
});

describe("which days an event occupies", () => {
  const trip = ev("2026-09-08", "2026-09-12", "Battery Show");

  it("covers every day of the range, both ends included", () => {
    for (const d of ["09-08", "09-09", "09-10", "09-11", "09-12"]) {
      expect(covers(trip, `2026-${d}`)).toBe(true);
    }
    expect(covers(trip, "2026-09-07")).toBe(false);
    expect(covers(trip, "2026-09-13")).toBe(false);
  });

  it("treats a single day as a range of one", () => {
    const visit = ev("2026-08-28");
    expect(eventLength(visit)).toBe(1);
    expect(covers(visit, "2026-08-28")).toBe(true);
    expect(covers(visit, "2026-08-27")).toBe(false);
  });

  it("counts the length of a range inclusively", () => {
    expect(eventLength(trip)).toBe(5);
  });

  it("crosses a month boundary with no special case", () => {
    const cross = ev("2026-08-29", "2026-09-02");
    expect(covers(cross, "2026-08-31")).toBe(true);
    expect(covers(cross, "2026-09-01")).toBe(true);
    expect(eventLength(cross)).toBe(5);
  });

  it("crosses a year boundary too", () => {
    const cross = ev("2026-12-28", "2027-01-03");
    expect(covers(cross, "2026-12-31")).toBe(true);
    expect(covers(cross, "2027-01-01")).toBe(true);
    expect(eventLength(cross)).toBe(7);
  });

  it("knows whether it touches a window at all", () => {
    expect(overlaps(trip, "2026-09-01", "2026-09-07")).toBe(false);
    expect(overlaps(trip, "2026-09-01", "2026-09-08")).toBe(true);
    expect(overlaps(trip, "2026-09-12", "2026-09-30")).toBe(true);
    expect(overlaps(trip, "2026-01-01", "2027-01-01")).toBe(true);
  });

  it("lists several events on one date in a stable order", () => {
    const all = [
      ev("2026-09-09", "2026-09-09", "Zebra"),
      ev("2026-09-08", "2026-09-12", "Battery Show"),
      ev("2026-09-09", "2026-09-09", "Alpha"),
    ];
    const on = eventsOn(all, "2026-09-09").map((e) => e.title);
    expect(on).toEqual(["Battery Show", "Alpha", "Zebra"]);
    // Same answer whatever order the rows arrived in.
    expect(eventsOn([...all].reverse(), "2026-09-09").map((e) => e.title)).toEqual(on);
  });
});

describe("the upcoming list", () => {
  const today = "2026-08-25";
  const all = [
    ev("2026-08-01", "2026-08-03", "Finished trip"),
    ev("2026-08-24", "2026-08-27", "In progress"),
    ev("2026-08-28", "2026-08-28", "Customer visit"),
    ev("2026-09-09", "2026-09-11", "Battery Show"),
    ev("2026-08-25", "2026-08-25", "Today only"),
  ];

  it("is ordered soonest first", () => {
    expect(upcomingEvents(all, today).map((e) => e.title))
      .toEqual(["In progress", "Today only", "Customer visit", "Battery Show"]);
  });

  it("keeps something that has already started but has not finished", () => {
    expect(upcomingEvents(all, today).map((e) => e.title)).toContain("In progress");
  });

  it("drops what is entirely past from the list, but not from the data", () => {
    expect(upcomingEvents(all, today).map((e) => e.title)).not.toContain("Finished trip");
    expect(pastEvents(all, today).map((e) => e.title)).toEqual(["Finished trip"]);
    // Still there to be drawn in August's grid: nothing is deleted or hidden.
    expect(eventsOn(all, "2026-08-02")).toHaveLength(1);
  });

  it("shows only as many as the panel asked for", () => {
    expect(upcomingEvents(all, today, 2)).toHaveLength(2);
    expect(upcomingEvents(all, today, 0)).toHaveLength(0);
  });

  it("says nothing is coming up when everything is behind us", () => {
    expect(upcomingEvents(all, "2027-01-01")).toEqual([]);
  });
});

describe("laying a week out in lanes", () => {
  // Sun 6 Sep 2026 → Sat 12 Sep 2026.
  const week = ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09",
    "2026-09-10", "2026-09-11", "2026-09-12"];

  it("draws a range as one bar spanning its columns", () => {
    const [bar] = layoutWeek([ev("2026-09-08", "2026-09-11", "Trip")], week);
    expect(bar.startIndex).toBe(2);
    expect(bar.endIndex).toBe(5);
    expect(bar.lane).toBe(0);
    expect(bar.continuesBefore).toBe(false);
    expect(bar.continuesAfter).toBe(false);
  });

  it("clips a range at the row's edges and says it carries on", () => {
    const [bar] = layoutWeek([ev("2026-09-03", "2026-09-20", "Long")], week);
    expect(bar.startIndex).toBe(0);
    expect(bar.endIndex).toBe(6);
    expect(bar.continuesBefore).toBe(true);
    expect(bar.continuesAfter).toBe(true);
  });

  it("puts overlapping events on separate lanes, and reuses a free one", () => {
    const bars = layoutWeek([
      ev("2026-09-06", "2026-09-09", "A"),
      ev("2026-09-07", "2026-09-08", "B"),
      ev("2026-09-11", "2026-09-12", "C"),   // after A ends: lane 0 is free again
    ], week);
    const lane = (title: string) => bars.find((b) => b.event.title === title)!.lane;
    expect(lane("A")).toBe(0);
    expect(lane("B")).toBe(1);
    expect(lane("C")).toBe(0);
  });

  it("gives the same event the same lane however the rows are ordered", () => {
    const all = [
      ev("2026-09-06", "2026-09-09", "A"),
      ev("2026-09-07", "2026-09-08", "B"),
    ];
    const lanes = (list: ImportantDate[]) =>
      Object.fromEntries(layoutWeek(list, week).map((b) => [b.event.title, b.lane]));
    expect(lanes(all)).toEqual(lanes([...all].reverse()));
  });

  it("keeps a cross-month event on both sides of the boundary", () => {
    const cross = ev("2026-08-29", "2026-09-02", "Handover");

    /** Every day a month's grid actually paints a bar on. */
    const painted = (month: string) => {
      const days = new Set<string>();
      for (const week of monthGrid(month)) {
        for (const bar of layoutWeek([cross], week)) {
          for (let i = bar.startIndex; i <= bar.endIndex; i++) days.add(week[i]);
        }
      }
      return days;
    };

    const august = painted("2026-08");
    const september = painted("2026-09");
    // Each grid draws the part of the range it can see...
    expect(august.has("2026-08-31")).toBe(true);
    expect(september.has("2026-09-01")).toBe(true);
    // ...and between them nothing is dropped at the boundary.
    for (const d of ["2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]) {
      expect(august.has(d) || september.has(d), d).toBe(true);
    }
  });

  it("caps the lanes it draws and counts what each day had to leave out", () => {
    const many = ["A", "B", "C", "D", "E"].map((title) =>
      ev("2026-09-09", "2026-09-09", title));
    const { bars, hidden } = layoutWeekCapped(many, week, 3);
    expect(bars).toHaveLength(3);
    expect(hidden["2026-09-09"]).toBe(2);
    expect(hidden["2026-09-10"]).toBeUndefined();
  });

  it("counts the overflow on every day a hidden range covers", () => {
    const many = ["A", "B", "C"].map((title) => ev("2026-09-08", "2026-09-10", title));
    const { hidden } = layoutWeekCapped(many, week, 2);
    expect(hidden["2026-09-08"]).toBe(1);
    expect(hidden["2026-09-09"]).toBe(1);
    expect(hidden["2026-09-10"]).toBe(1);
  });

  it("draws nothing for a week with nothing in it", () => {
    expect(layoutWeek([ev("2026-10-01")], week)).toEqual([]);
  });
});

describe("editing dates", () => {
  const trip = ev("2026-09-09", "2026-09-11", "Battery Show");

  it("moves the whole range when the start moves", () => {
    const moved = withStart(trip, "2026-09-10");
    expect(moved.startDate).toBe("2026-09-10");
    expect(moved.endDate).toBe("2026-09-12");
    expect(eventLength(moved)).toBe(eventLength(trip));
  });

  it("keeps the same event rather than making a second one", () => {
    expect(withStart(trip, "2026-10-01").id).toBe(trip.id);
    expect(withEnd(trip, "2026-09-20").id).toBe(trip.id);
  });

  it("extends the range when the end moves out", () => {
    expect(withEnd(trip, "2026-09-20").endDate).toBe("2026-09-20");
    expect(withEnd(trip, "2026-09-20").startDate).toBe("2026-09-09");
  });

  it("collapses to a single day rather than inverting", () => {
    const back = withEnd(trip, "2026-09-01");
    expect(back.startDate).toBe("2026-09-01");
    expect(back.endDate).toBe("2026-09-01");
    expect(eventProblem(back)).toBeNull();
  });
});

describe("what counts as a usable event", () => {
  it("wants a title", () => {
    expect(eventProblem({ title: "  ", startDate: "2026-09-09", endDate: "2026-09-09" }))
      .toBe("titleRequired");
  });

  it("refuses a range that ends before it starts", () => {
    expect(eventProblem({ title: "x", startDate: "2026-09-09", endDate: "2026-09-08" }))
      .toBe("endBeforeStart");
  });

  it("refuses a range longer than a year", () => {
    expect(eventProblem({ title: "x", startDate: "2026-01-01", endDate: "2027-01-01" }))
      .toBeNull();
    expect(eventProblem({ title: "x", startDate: "2026-01-01", endDate: "2030-01-01" }))
      .toBe("tooLong");
  });

  it("accepts a plain single day", () => {
    expect(eventProblem({ title: "Customer visit", startDate: "2026-08-28", endDate: "2026-08-28" }))
      .toBeNull();
  });
});

describe("colour", () => {
  it("accepts a palette key or a hex, and nothing else", () => {
    expect(isEventColor("blue")).toBe(true);
    expect(isEventColor("#3E76C4")).toBe(true);
    expect(isEventColor("#3e76c4")).toBe(true);
    expect(isEventColor("javascript:alert(1)")).toBe(false);
    expect(isEventColor("red; background: url(x)")).toBe(false);
    expect(isEventColor("#GGGGGG")).toBe(false);
    expect(isEventColor(42)).toBe(false);
  });

  it("resolves a key to its hex and passes a custom colour through", () => {
    expect(colorHex("blue")).toBe("#3E76C4");
    expect(colorHex("#123456")).toBe("#123456");
  });

  it("falls back rather than painting nothing", () => {
    expect(colorHex("chartreuse")).toBe(colorHex(DEFAULT_EVENT_COLOR));
  });

  it("offers a small palette, all distinct", () => {
    expect(EVENT_COLORS.length).toBeLessThanOrEqual(8);
    expect(new Set(EVENT_COLORS.map((c) => c.hex)).size).toBe(EVENT_COLORS.length);
    expect(new Set(EVENT_COLORS.map((c) => c.key)).size).toBe(EVENT_COLORS.length);
  });
});

describe("the request parser", () => {
  const good = {
    id: ID, title: "Battery Show — Detroit", startDate: "2026-09-09", endDate: "2026-09-11",
    note: "Booth 412", color: "teal", kind: "travel",
  };

  it("takes a well-formed event", () => {
    expect(parseImportantDate(good)).toEqual({
      id: ID, title: "Battery Show — Detroit", startDate: "2026-09-09", endDate: "2026-09-11",
      note: "Booth 412", color: "teal", kind: "travel",
    });
  });

  it("treats a missing end date as a single day", () => {
    const one = parseImportantDate({ ...good, endDate: undefined });
    expect(one.endDate).toBe(one.startDate);
  });

  it("keeps the user's words exactly as typed", () => {
    const zh = parseImportantDate({ ...good, title: "  客户拜访 · 芝加哥  ", note: " 早班机 " });
    expect(zh.title).toBe("客户拜访 · 芝加哥");   // trimmed, never translated
    expect(zh.note).toBe(" 早班机 ");
  });

  it("rejects what the editor would not have offered", () => {
    expect(() => parseImportantDate({ ...good, title: "" })).toThrow(/title/i);
    expect(() => parseImportantDate({ ...good, endDate: "2026-09-01" })).toThrow(/end date/i);
    expect(() => parseImportantDate({ ...good, endDate: "2030-09-01" })).toThrow(/days/i);
    expect(() => parseImportantDate({ ...good, id: "nope" })).toThrow(/uuid/i);
    expect(() => parseImportantDate({ ...good, startDate: "9 Sep" })).toThrow(/YYYY-MM-DD/);
    expect(() => parseImportantDate({ ...good, kind: "wedding" })).toThrow(/kind/i);
  });

  it("falls back on a colour it does not recognise instead of failing the save", () => {
    expect(parseImportantDate({ ...good, color: "neon" }).color).toBe(DEFAULT_EVENT_COLOR);
    expect(parseImportantDate({ ...good, color: "#ABCDEF" }).color).toBe("#ABCDEF");
  });

  it("bounds the title and the note", () => {
    expect(() => parseImportantDate({ ...good, title: "x".repeat(200) })).toThrow(/too long/i);
    expect(() => parseImportantDate({ ...good, note: "x".repeat(600) })).toThrow(/too long/i);
  });

  it("takes exactly one day short of the cap", () => {
    const long = parseImportantDate({ ...good, startDate: "2026-01-01", endDate: "2026-12-31" });
    expect(eventLength(long)).toBeLessThanOrEqual(MAX_EVENT_DAYS);
  });
});

/**
 * The deployment rule, pinned. The panel is allowed to report itself
 * unavailable when the schema is older than the code; it is not allowed to
 * swallow anything else, because everything else means something is wrong.
 */
describe("a schema older than the code", () => {
  it("recognises a table that is not there yet", () => {
    expect(isSchemaBehind({ code: "42P01" })).toBe(true);
  });

  it("recognises a column that is not there yet", () => {
    expect(isSchemaBehind({ code: "42703" })).toBe(true);
  });

  it("is not an excuse for any other failure", () => {
    for (const code of ["28P01", "53300", "3D000", "23505", "ECONNREFUSED", "", undefined]) {
      expect(isSchemaBehind({ code }), String(code)).toBe(false);
    }
    expect(isSchemaBehind(null)).toBe(false);
    expect(isSchemaBehind(new Error("boom"))).toBe(false);
  });
});

describe("the account", () => {
  it("starts with an empty calendar and nothing unavailable", () => {
    expect(emptyState().importantDates).toEqual([]);
    expect(emptyState().unavailable).toEqual([]);
  });
});

describe("wording", () => {
  it("has every label in every language", () => {
    for (const locale of LOCALES) {
      const t = dict(locale);
      expect(t.importantDates.title).toBeTruthy();
      expect(t.importantDates.empty).toBeTruthy();
      expect(t.importantDates.unavailable).toBeTruthy();
      for (const problem of ["titleRequired", "endBeforeStart", "tooLong"] as const) {
        expect(t.importantDates.problems[problem], `${locale}/${problem}`).toBeTruthy();
      }
      for (const c of EVENT_COLORS) {
        expect(t.importantDates.colours[c.key], `${locale}/${c.key}`).toBeTruthy();
      }
      expect(t.importantDates.dayLabel("August 9", 2)).toContain("2");
      expect(t.importantDates.length(5)).toContain("5");
      expect(t.importantDates.showMore(3)).toContain("3");
    }
  });

  it("writes a single day, a span inside one month, and one across two", () => {
    expect(dateRangeFor("2026-08-28", "2026-08-28", "en")).toBe("Aug 28");
    expect(dateRangeFor("2026-09-09", "2026-09-11", "en")).toBe("Sep 9–11");
    expect(dateRangeFor("2026-08-29", "2026-09-02", "en")).toBe("Aug 29 – Sep 2");
  });

  it("writes the same span in Chinese", () => {
    expect(dateRangeFor("2026-09-09", "2026-09-11", "zh")).toBe("9月9日–11日");
    expect(dateRangeFor("2026-08-28", "2026-08-28", "zh")).toBe("8月28日");
  });

  it("carries both languages at once in bilingual mode", () => {
    const both = dateRangeFor("2026-09-09", "2026-09-11", "both");
    expect(both).toContain("Sep 9–11");
    expect(both).toContain("9月9日–11日");
  });

  it("names the month with its year, so a window rolling into January is clear", () => {
    expect(monthTitleFor("2026-12", "en")).toMatch(/Dec.*2026/);
    expect(monthTitleFor("2027-01", "en")).toMatch(/Jan.*2027/);
    expect(monthTitleFor("2026-08", "zh")).toContain("2026");
  });
});

describe("ordering is total", () => {
  it("never returns 0 for two different events", () => {
    const a = ev("2026-09-09", "2026-09-09", "Same");
    const b = { ...a, id: "other" };
    expect(compareEvents(a, b)).not.toBe(0);
    expect(compareEvents(a, a)).toBe(0);
  });
});
