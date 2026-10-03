import { describe, expect, it } from "vitest";
import {
  MAX_OCCURRENCES, addMonthsClamped, isOccurrenceStart, nextOccurrence, occurrencesBetween,
} from "../src/lib/recurrence";
import {
  instantToZoned, inViewerZone, isTimeZone, zonedToInstant,
} from "../src/lib/zonedTime";
import {
  EVENT_KINDS, KIND_EMOJI, ONE_OFF_ALL_DAY, eventProblem, layoutWeek, repeatPreset, ruleFor,
  seriesAfterEdit, suggestedStartTime, withAllDay, withEndTime, withKind, withStartTime,
} from "../src/lib/importantDates";
import { dayAgenda, importantDateItems, upcomingItems } from "../src/lib/calendar";
import { isExtendedWrite, parseImportantDate } from "../src/lib/validate";
import { LOCALES, clockTimeFor, dict, zoneLabelFor } from "../src/lib/i18n";
import type { ImportantDate, RepeatRule } from "../src/lib/types";

/**
 * Important Dates V2: optional times, repeating events, the Day Agenda, and the
 * source-neutral CalendarItem the panel draws.
 *
 * Everything here is a pure function, so a leap year, a daylight-saving night
 * and a traveller in another zone are all testable without a database, a
 * browser or a clock.
 */

const ID = "22222222-2222-4222-8222-222222222222";
let n = 0;
const ev = (over: Partial<ImportantDate> = {}): ImportantDate => ({
  id: `id-${++n}`, title: `event ${n}`, startDate: "2026-10-12", endDate: "2026-10-12",
  note: "", color: "blue", kind: "none", ...ONE_OFF_ALL_DAY, ...over,
});
const rule = (unit: RepeatRule["unit"], interval = 1, until: string | null = null): RepeatRule =>
  ({ unit, interval, until });
const starts = (e: ImportantDate, from: string, to: string) =>
  occurrencesBetween(e, from, to).map((o) => o.startDate);

/* -------------------------------- recurrence ------------------------------ */

describe("a yearly event", () => {
  const mom = ev({ title: "Mom's Birthday", kind: "birthday", repeat: rule("year") });

  it("appears on the same date every year, entered once", () => {
    expect(starts(mom, "2026-01-01", "2028-12-31")).toEqual(["2026-10-12", "2027-10-12", "2028-10-12"]);
  });

  it("does not appear before it was first entered", () => {
    expect(starts(mom, "2025-01-01", "2025-12-31")).toEqual([]);
  });

  it("is found decades later without walking every year in between", () => {
    const old = ev({ startDate: "1958-10-12", endDate: "1958-10-12", repeat: rule("year") });
    expect(starts(old, "2026-10-01", "2026-10-31")).toEqual(["2026-10-12"]);
    expect(starts(old, "2060-10-01", "2060-10-31")).toEqual(["2060-10-12"]);
  });
});

describe("Feb 29", () => {
  const leap = ev({ startDate: "2028-02-29", endDate: "2028-02-29", repeat: rule("year") });

  it("is on Feb 28 in an ordinary year, and back on the 29th in a leap year", () => {
    expect(starts(leap, "2028-01-01", "2033-01-01")).toEqual([
      "2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29",
    ]);
  });

  it("is never pushed into March", () => {
    expect(starts(leap, "2029-03-01", "2029-03-31")).toEqual([]);
  });
});

describe("a monthly event on the 31st", () => {
  const rent = ev({ startDate: "2026-01-31", endDate: "2026-01-31", repeat: rule("month") });

  it("clamps to the last day of each shorter month", () => {
    expect(starts(rent, "2026-01-01", "2026-05-31")).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31",
    ]);
  });

  it("never drifts: every occurrence is computed from the anchor", () => {
    // Chaining from Feb 28 would give Mar 28; the anchor gives Mar 31.
    expect(starts(rent, "2026-03-01", "2026-03-31")).toEqual(["2026-03-31"]);
    expect(starts(rent, "2027-12-01", "2027-12-31")).toEqual(["2027-12-31"]);
  });

  it("clamps across a leap February too", () => {
    expect(starts(rent, "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
  });

  it("does the same arithmetic in addMonthsClamped", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsClamped("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonthsClamped("2026-03-15", -3)).toBe("2025-12-15");
  });
});

describe("a weekly event", () => {
  it("keeps its weekday", () => {
    const thu = ev({ startDate: "2026-10-08", endDate: "2026-10-08", repeat: rule("week") });
    const all = starts(thu, "2026-10-01", "2026-11-30");
    expect(all).toEqual(["2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29",
      "2026-11-05", "2026-11-12", "2026-11-19", "2026-11-26"]);
    for (const d of all) expect(new Date(`${d}T12:00:00Z`).getUTCDay()).toBe(4);
  });

  it("is computed in calendar days, so a daylight-saving change cannot move it", () => {
    // US clocks change on 2026-11-01; the weekly series is untouched by it.
    const sun = ev({ startDate: "2026-10-25", endDate: "2026-10-25", repeat: rule("week") });
    expect(starts(sun, "2026-10-25", "2026-11-08")).toEqual(["2026-10-25", "2026-11-01", "2026-11-08"]);
  });
});

describe("custom repeats", () => {
  it("every N units", () => {
    const fortnight = ev({ startDate: "2026-10-01", endDate: "2026-10-01", repeat: rule("week", 2) });
    expect(starts(fortnight, "2026-10-01", "2026-11-01")).toEqual(["2026-10-01", "2026-10-15", "2026-10-29"]);
    const quarterly = ev({ startDate: "2026-01-15", endDate: "2026-01-15", repeat: rule("month", 3) });
    expect(starts(quarterly, "2026-01-01", "2026-12-31"))
      .toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);
    const olympics = ev({ startDate: "2028-07-14", endDate: "2028-07-14", repeat: rule("year", 4) });
    expect(starts(olympics, "2028-01-01", "2040-12-31")).toEqual(["2028-07-14", "2032-07-14", "2036-07-14", "2040-07-14"]);
  });

  it("ends on the last date, inclusive", () => {
    const course = ev({ startDate: "2026-10-01", endDate: "2026-10-01", repeat: rule("week", 1, "2026-10-22") });
    expect(starts(course, "2026-09-01", "2026-12-31")).toEqual(["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"]);
    expect(nextOccurrence(course, "2026-10-23")).toBeNull();
  });
});

describe("deleted occurrences", () => {
  const weekly = ev({ startDate: "2026-10-01", endDate: "2026-10-01", repeat: rule("week"),
    excludedOn: ["2026-10-08"] });

  it("skip only that date; the series carries on", () => {
    expect(starts(weekly, "2026-10-01", "2026-10-22")).toEqual(["2026-10-01", "2026-10-15", "2026-10-22"]);
  });

  it("are skipped by Upcoming too", () => {
    expect(nextOccurrence(weekly, "2026-10-02")?.startDate).toBe("2026-10-15");
  });

  it("still count as occurrences when deciding what may be deleted", () => {
    expect(isOccurrenceStart(weekly, "2026-10-08")).toBe(true);
    expect(isOccurrenceStart(weekly, "2026-10-09")).toBe(false);
    expect(isOccurrenceStart(weekly, "2026-09-24")).toBe(false);   // before the series
  });

  it("is a one-off's own date and nothing else", () => {
    const once = ev({ startDate: "2026-10-12", endDate: "2026-10-14" });
    expect(isOccurrenceStart(once, "2026-10-12")).toBe(true);
    expect(isOccurrenceStart(once, "2026-10-13")).toBe(false);
  });
});

describe("multi-day repeating events", () => {
  const trip = ev({ startDate: "2026-12-30", endDate: "2027-01-02", repeat: rule("year") });

  it("keep their length on every occurrence", () => {
    expect(occurrencesBetween(trip, "2027-12-01", "2028-01-31"))
      .toEqual([{ startDate: "2027-12-30", endDate: "2028-01-02" }]);
  });

  it("are found from a window that starts after the occurrence did", () => {
    // Looking at January 2028 alone still shows the trip that began in December.
    expect(occurrencesBetween(trip, "2028-01-01", "2028-01-31"))
      .toEqual([{ startDate: "2027-12-30", endDate: "2028-01-02" }]);
  });
});

describe("a one-off event goes through unchanged", () => {
  it("is itself when it touches the window, and nothing otherwise", () => {
    const once = ev({ startDate: "2026-09-09", endDate: "2026-09-11" });
    expect(occurrencesBetween(once, "2026-09-01", "2026-09-30"))
      .toEqual([{ startDate: "2026-09-09", endDate: "2026-09-11" }]);
    expect(occurrencesBetween(once, "2026-10-01", "2026-10-31")).toEqual([]);
    expect(nextOccurrence(once, "2026-09-10")).toEqual({ startDate: "2026-09-09", endDate: "2026-09-11" });
    expect(nextOccurrence(once, "2026-09-12")).toBeNull();
  });
});

describe("the guard", () => {
  it("never returns more than MAX_OCCURRENCES", () => {
    const daily = ev({ startDate: "2000-01-01", endDate: "2000-01-01", repeat: rule("week") });
    expect(occurrencesBetween(daily, "2000-01-01", "2099-12-31").length).toBe(MAX_OCCURRENCES);
  });
});

/* ------------------------------- time zones ------------------------------- */

describe("clock times in a zone", () => {
  it("knows a real zone from a made-up one", () => {
    expect(isTimeZone("America/Chicago")).toBe(true);
    expect(isTimeZone("Asia/Shanghai")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    for (const bad of ["Mars/Olympus", "", "x".repeat(65), "America/Chicago; drop table", 42, null]) {
      expect(isTimeZone(bad), String(bad)).toBe(false);
    }
  });

  it("round-trips an ordinary time", () => {
    const at = zonedToInstant("2026-10-12", "19:00", "America/Chicago");
    expect(new Date(at).toISOString()).toBe("2026-10-13T00:00:00.000Z");   // CDT, UTC-5
    expect(instantToZoned(at, "America/Chicago")).toEqual({ date: "2026-10-12", time: "19:00" });
  });

  it("shows a Houston 7 PM as 8 PM to somebody in New York", () => {
    expect(inViewerZone("2026-10-12", "19:00", "America/Chicago", "America/New_York"))
      .toEqual({ date: "2026-10-12", time: "20:00" });
  });

  it("moves to the next day for a reader far enough east", () => {
    expect(inViewerZone("2026-10-12", "23:00", "America/Chicago", "Asia/Tokyo"))
      .toEqual({ date: "2026-10-13", time: "13:00" });
  });

  it("leaves a floating time, or a reader in the same zone, exactly as written", () => {
    expect(inViewerZone("2026-10-12", "19:00", null, "Asia/Tokyo")).toEqual({ date: "2026-10-12", time: "19:00" });
    expect(inViewerZone("2026-10-12", "19:00", "America/Chicago", "America/Chicago"))
      .toEqual({ date: "2026-10-12", time: "19:00" });
    expect(inViewerZone("2026-10-12", "19:00", "America/Chicago", null))
      .toEqual({ date: "2026-10-12", time: "19:00" });
  });

  it("keeps a weekly 7 PM at 7 PM local across the daylight-saving change", () => {
    for (const date of ["2026-10-25", "2026-11-01", "2026-11-08"]) {
      const at = zonedToInstant(date, "19:00", "America/Chicago");
      expect(instantToZoned(at, "America/Chicago")).toEqual({ date, time: "19:00" });
    }
    // …which is a different UTC hour before and after: that is the point.
    expect(new Date(zonedToInstant("2026-10-25", "19:00", "America/Chicago")).getUTCHours()).toBe(0);
    expect(new Date(zonedToInstant("2026-11-08", "19:00", "America/Chicago")).getUTCHours()).toBe(1);
  });

  it("moves a time that does not exist forward by the gap (spring forward)", () => {
    // 2027-03-14, Chicago: 02:00 → 03:00. 02:30 does not happen; it means 03:30.
    expect(instantToZoned(zonedToInstant("2027-03-14", "02:30", "America/Chicago"), "America/Chicago"))
      .toEqual({ date: "2027-03-14", time: "03:30" });
    // Europe/London, 2027-03-28: 01:00 → 02:00.
    expect(instantToZoned(zonedToInstant("2027-03-28", "01:30", "Europe/London"), "Europe/London"))
      .toEqual({ date: "2027-03-28", time: "02:30" });
  });

  it("takes the first of a time that happens twice (fall back)", () => {
    // 2026-11-01, Chicago: 01:30 happens in CDT and again in CST. The first is CDT (UTC-5).
    const at = zonedToInstant("2026-11-01", "01:30", "America/Chicago");
    expect(new Date(at).toISOString()).toBe("2026-11-01T06:30:00.000Z");
    const london = zonedToInstant("2026-10-25", "01:30", "Europe/London");
    expect(new Date(london).toISOString()).toBe("2026-10-25T00:30:00.000Z");   // BST, the first
  });

  it("names a zone as a region, never as the city in its id", () => {
    // A Houston event is stored as America/Chicago; nobody in Houston typed "Chicago".
    const october = Date.UTC(2026, 9, 12, 12);
    const january = Date.UTC(2027, 0, 12, 12);
    expect(zoneLabelFor("America/Chicago", "en", october)).toBe("Central Time");
    expect(zoneLabelFor("America/Chicago", "en", january)).toBe("Central Time");   // no daylight/standard flip
    expect(zoneLabelFor("America/Chicago", "zh", october)).toBe("北美中部时间");
    expect(zoneLabelFor("America/New_York", "en", october)).toBe("Eastern Time");
    expect(zoneLabelFor("Asia/Shanghai", "zh", october)).toBe("中国标准时间");
    expect(zoneLabelFor("America/Chicago", "both", october)).toBe("Central Time");
    for (const locale of ["en", "zh", "both"] as const) {
      expect(zoneLabelFor("America/Chicago", locale, october)).not.toMatch(/Chicago|芝加哥/);
    }
  });
});

/* ------------------------------- calendar items --------------------------- */

describe("CalendarItem, from Important Dates", () => {
  it("makes one item per occurrence, keyed by source, id and occurrence", () => {
    const mom = ev({ id: "mom", title: "Mom's Birthday", kind: "birthday", repeat: rule("year") });
    const items = importantDateItems([mom], "2026-01-01", "2027-12-31", "America/Chicago");
    expect(items.map((i) => i.id)).toEqual(["richhabit:mom@2026-10-12", "richhabit:mom@2027-10-12"]);
    expect(items.every((i) => i.source === "richhabit" && i.sourceId === "mom" && i.editable)).toBe(true);
    expect(items[1]).toMatchObject({ occurrenceDate: "2027-10-12", allDay: true, startTime: null, title: "Mom's Birthday" });
  });

  it("never converts an all-day event, wherever it is read", () => {
    const bday = ev({ startDate: "2026-10-12", endDate: "2026-10-12" });
    for (const zone of ["Asia/Tokyo", "Pacific/Honolulu", null]) {
      const [item] = importantDateItems([bday], "2026-10-01", "2026-10-31", zone);
      expect(item).toMatchObject({ startDate: "2026-10-12", endDate: "2026-10-12", allDay: true });
    }
  });

  it("places a timed event in the reader's clock, and remembers how it was written", () => {
    const zoom = ev({ title: "Zoom", startTime: "19:00", endTime: "20:00", timeZone: "America/Chicago" });
    const [ny] = importantDateItems([zoom], "2026-10-12", "2026-10-12", "America/New_York");
    expect(ny).toMatchObject({ startDate: "2026-10-12", startTime: "20:00", endTime: "21:00",
      original: { startTime: "19:00", timeZone: "America/Chicago" } });
    const [home] = importantDateItems([zoom], "2026-10-12", "2026-10-12", "America/Chicago");
    expect(home).toMatchObject({ startTime: "19:00", original: null });
  });

  it("finds a timed occurrence that crosses into the window from another zone", () => {
    const late = ev({ startDate: "2026-10-12", endDate: "2026-10-12", startTime: "23:00", timeZone: "America/Chicago" });
    expect(importantDateItems([late], "2026-10-13", "2026-10-13", "Asia/Tokyo").map((i) => i.startDate))
      .toEqual(["2026-10-13"]);
    expect(importantDateItems([late], "2026-10-12", "2026-10-12", "Asia/Tokyo")).toEqual([]);
  });

  it("lays occurrences out in lanes exactly as it did one-off events", () => {
    const week = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
    const items = importantDateItems([
      ev({ title: "A", repeat: rule("year") }),
      ev({ title: "B", startDate: "2026-10-12", endDate: "2026-10-14" }),
    ], week[0], week[6], null);
    const bars = layoutWeek(items, week);
    expect(bars.map((b) => [b.event.title, b.lane, b.startIndex, b.endIndex]))
      .toEqual([["B", 0, 1, 3], ["A", 1, 1, 1]]);
  });
});

describe("Upcoming", () => {
  it("shows one row per series — the next one — not every occurrence", () => {
    const weekly = ev({ title: "Class", startDate: "2026-09-03", endDate: "2026-09-03", repeat: rule("week") });
    const once = ev({ title: "Trip", startDate: "2026-10-20", endDate: "2026-10-22" });
    const items = upcomingItems([weekly, once], "2026-10-03", null);
    expect(items.map((i) => [i.title, i.startDate])).toEqual([["Class", "2026-10-08"], ["Trip", "2026-10-20"]]);
  });

  it("keeps an occurrence that is on now", () => {
    const yearly = ev({ title: "Retreat", startDate: "2025-10-02", endDate: "2025-10-04", repeat: rule("year") });
    expect(upcomingItems([yearly], "2026-10-03", null)[0]).toMatchObject({ startDate: "2026-10-02", endDate: "2026-10-04" });
  });

  it("keeps a repeating overnight event listed the day after an occurrence ends", () => {
    // Weekly, Monday 10 PM – Tuesday 1 AM. On Wednesday the next one is the 12th.
    const late = ev({ title: "Night shift", startDate: "2026-10-05", endDate: "2026-10-06",
      startTime: "22:00", endTime: "01:00", timeZone: "America/Chicago", repeat: rule("week") });
    for (const [today, next] of [["2026-10-06", "2026-10-05"], ["2026-10-07", "2026-10-12"],
      ["2026-10-08", "2026-10-12"]]) {
      expect(upcomingItems([late], today, "America/Chicago").map((i) => i.startDate), today).toEqual([next]);
    }
    // And a three-day timed monthly event, the day after one occurrence ends.
    const retreat = ev({ startDate: "2026-10-05", endDate: "2026-10-07", startTime: "09:00",
      endTime: "17:00", timeZone: "America/Chicago", repeat: rule("month") });
    expect(upcomingItems([retreat], "2026-10-08", "America/Chicago")[0].startDate).toBe("2026-11-05");
  });

  it("drops a series that has ended, and a one-off in the past", () => {
    const ended = ev({ startDate: "2026-01-01", endDate: "2026-01-01", repeat: rule("month", 1, "2026-06-01") });
    const past = ev({ startDate: "2026-09-01", endDate: "2026-09-01" });
    expect(upcomingItems([ended, past], "2026-10-03", null)).toEqual([]);
  });
});

/* ------------------------------- Day Agenda ------------------------------- */

describe("the Day Agenda", () => {
  const day = "2026-10-08";
  const items = importantDateItems([
    ev({ title: "Anniversary dinner", startDate: day, endDate: day, startTime: "18:30", endTime: "20:00",
      timeZone: "America/Chicago", kind: "anniversary" }),
    ev({ title: "Workout", startDate: day, endDate: day, startTime: "08:00", timeZone: "America/Chicago" }),
    ev({ title: "Doctor", startDate: day, endDate: day, startTime: "10:30", endTime: "11:15", timeZone: "America/Chicago" }),
    ev({ title: "Lunch with Sarah", startDate: day, endDate: day, startTime: "13:00", timeZone: "America/Chicago" }),
    ev({ title: "Dad's Birthday", startDate: "2020-10-08", endDate: "2020-10-08", kind: "birthday", repeat: rule("year") }),
    ev({ title: "Chicago trip", startDate: "2026-10-07", endDate: "2026-10-10" }),
  ], day, day, "America/Chicago");
  const agenda = dayAgenda(items, day);

  it("puts all-day things first, as context", () => {
    expect(agenda.allDay.map((r) => r.item.title)).toEqual(["Chicago trip", "Dad's Birthday"]);
    expect(agenda.allDay[0]).toMatchObject({ day: 2, days: 4 });
  });

  it("orders timed things by start time, whatever order they were added in", () => {
    expect(agenda.timed.map((r) => [r.time, r.item.title])).toEqual([
      ["08:00", "Workout"], ["10:30", "Doctor"], ["13:00", "Lunch with Sarah"], ["18:30", "Anniversary dinner"],
    ]);
  });

  it("lists overlapping events one after another, each with its own range", () => {
    const both = dayAgenda(importantDateItems([
      ev({ title: "Call", startDate: day, endDate: day, startTime: "10:00", endTime: "11:00" }),
      ev({ title: "Review", startDate: day, endDate: day, startTime: "10:00", endTime: "10:30" }),
    ], day, day, null), day);
    // Same start: the one that ends first comes first.
    expect(both.timed.map((r) => r.item.title)).toEqual(["Review", "Call"]);
  });

  it("splits an overnight event across its days", () => {
    const party = ev({ title: "Party", startDate: day, endDate: "2026-10-09", startTime: "22:00", endTime: "01:00" });
    const first = dayAgenda(importantDateItems([party], day, day, null), day);
    const second = dayAgenda(importantDateItems([party], "2026-10-09", "2026-10-09", null), "2026-10-09");
    expect(first.timed[0]).toMatchObject({ part: "start", time: "22:00" });
    expect(second.timed[0]).toMatchObject({ part: "end", time: "00:00" });
  });

  it("shows the middle days of a long timed event in the all-day band", () => {
    const conf = ev({ title: "Conference", startDate: "2026-10-07", endDate: "2026-10-09",
      startTime: "09:00", endTime: "17:00" });
    const middle = dayAgenda(importantDateItems([conf], day, day, null), day);
    expect(middle.allDay[0]).toMatchObject({ part: "allDay", day: 2, days: 3 });
    expect(middle.timed).toEqual([]);
  });

  it("treats an end at midnight as the end of the day it started", () => {
    const party = ev({ title: "Party", startDate: day, endDate: "2026-10-09", startTime: "22:00", endTime: "00:00" });
    const [item] = importantDateItems([party], day, "2026-10-09", null);
    expect(item).toMatchObject({ startDate: day, endDate: day, endTime: "00:00" });
    expect(dayAgenda([item], day).timed[0]).toMatchObject({ part: "single" });
    expect(dayAgenda(importantDateItems([party], "2026-10-09", "2026-10-09", null), "2026-10-09"))
      .toEqual({ allDay: [], timed: [] });
  });

  it("finds an occurrence two days away across the furthest-apart zones", () => {
    // 00:30 on the 12th at UTC+14 is 23:30 on the 10th at UTC−11.
    const far = ev({ startDate: "2026-10-12", endDate: "2026-10-12", startTime: "00:30",
      timeZone: "Pacific/Kiritimati" });
    expect(importantDateItems([far], "2026-10-10", "2026-10-10", "Pacific/Pago_Pago")
      .map((i) => [i.startDate, i.startTime])).toEqual([["2026-10-10", "23:30"]]);
  });

  it("is empty for an empty day", () => {
    expect(dayAgenda([], day)).toEqual({ allDay: [], timed: [] });
  });
});

/* --------------------------- editing and validation ----------------------- */

describe("the editor's rules", () => {
  it("makes Birthday and Anniversary yearly — unless a repeat was already chosen", () => {
    expect(withKind(ev(), "birthday", false).repeat).toEqual(rule("year"));
    expect(withKind(ev(), "anniversary", false).repeat).toEqual(rule("year"));
    expect(withKind(ev(), "holiday", false).repeat).toBeNull();
    expect(withKind(ev(), "birthday", true).repeat).toBeNull();
    expect(withKind(ev({ repeat: rule("month") }), "birthday", false).repeat).toEqual(rule("month"));
  });

  it("never writes the emoji into the title", () => {
    const e = withKind(ev({ title: "Mom" }), "birthday", false);
    expect(e.title).toBe("Mom");
    expect(KIND_EMOJI.birthday).toBe("🎂");
    expect(EVENT_KINDS).toEqual(expect.arrayContaining(["birthday", "anniversary", "holiday"]));
  });

  it("moves the end to the next day for an evening past midnight", () => {
    const e = withEndTime(ev({ startTime: "22:00" }), "01:00");
    expect(e).toMatchObject({ endDate: "2026-10-13", endTime: "01:00" });
    expect(eventProblem(e)).toBeNull();
  });

  it("never turns an overnight event into a 24-hour one when its start moves past the end", () => {
    const overnight = withEndTime(ev({ startTime: "22:00" }), "01:00");   // Oct 12 22:00 – Oct 13 01:00
    expect(withStartTime(overnight, "00:30")).toMatchObject({ startDate: "2026-10-12", endDate: "2026-10-12",
      startTime: "00:30", endTime: "01:00" });
    expect(withStartTime(overnight, "23:00")).toMatchObject({ endDate: "2026-10-13" });   // still overnight
    // A genuinely long event is never shortened by a start-time edit.
    const conf = ev({ startDate: "2026-10-12", endDate: "2026-10-13", startTime: "09:00", endTime: "17:00" });
    expect(withStartTime(conf, "10:00")).toMatchObject({ endDate: "2026-10-13" });
    // On one day, a start after the end is shown as a problem, not silently moved.
    const sameDay = ev({ title: "x", startTime: "10:00", endTime: "11:00" });
    expect(eventProblem(withStartTime(sameDay, "12:00"))).toBe("endTimeBeforeStart");
  });

  it("refuses a same-day end that is not after the start", () => {
    expect(eventProblem(ev({ title: "x", startTime: "10:00", endTime: "10:00" }))).toBe("endTimeBeforeStart");
    expect(eventProblem(ev({ title: "x", startTime: "10:00", endTime: "11:00" }))).toBeNull();
  });

  it("toggles All day without losing what it can restore", () => {
    const timed = withAllDay(ev(), false, "09:00", null, "America/Chicago");
    expect(timed).toMatchObject({ startTime: "09:00", endTime: null, timeZone: "America/Chicago" });
    expect(withAllDay(timed, true, "", null, null)).toMatchObject({ startTime: null, endTime: null, timeZone: null });
    // An event keeps the zone it was set in; a later edit from elsewhere does not move it.
    expect(withAllDay(ev({ timeZone: "Asia/Shanghai" }), false, "09:00", null, "America/Chicago").timeZone)
      .toBe("Asia/Shanghai");
  });

  it("suggests the next hour today and 9 AM otherwise", () => {
    expect(suggestedStartTime("2026-10-03", "2026-10-03", new Date(2026, 9, 3, 14, 20))).toBe("15:00");
    expect(suggestedStartTime("2026-10-03", "2026-10-03", new Date(2026, 9, 3, 23, 20))).toBe("23:00");
    expect(suggestedStartTime("2026-10-04", "2026-10-03")).toBe("09:00");
  });

  it("maps rules to the Repeat chips and back", () => {
    expect(repeatPreset(null)).toBe("none");
    expect(repeatPreset(rule("year"))).toBe("year");
    expect(repeatPreset(rule("week", 2))).toBe("custom");
    expect(repeatPreset(rule("month", 1, "2027-01-01"))).toBe("custom");
    expect(ruleFor("none", rule("week"))).toBeNull();
    expect(ruleFor("month", null)).toEqual(rule("month"));
    expect(ruleFor("custom", rule("week", 3))).toEqual(rule("week", 3));
  });

  it("refuses a repeat the series could not keep", () => {
    const base = { title: "x", startDate: "2026-10-01", endDate: "2026-10-01" };
    expect(eventProblem({ ...base, endDate: "2026-10-09", repeat: rule("week") })).toBe("repeatTooShort");
    expect(eventProblem({ ...base, endDate: "2026-10-07", repeat: rule("week") })).toBeNull();
    expect(eventProblem({ ...base, repeat: rule("week", 0) })).toBe("intervalRange");
    expect(eventProblem({ ...base, repeat: rule("week", 100) })).toBe("intervalRange");
    expect(eventProblem({ ...base, repeat: rule("week", 1, "2026-09-30") })).toBe("untilBeforeStart");
  });

  it("forgets deleted occurrences only when the series moves", () => {
    const before = ev({ repeat: rule("week"), excludedOn: ["2026-10-19"] });
    expect(seriesAfterEdit(before, { ...before, title: "Renamed", startTime: "09:00" }).excludedOn).toEqual(["2026-10-19"]);
    expect(seriesAfterEdit(before, { ...before, repeat: rule("week", 1, "2027-01-01") }).excludedOn).toEqual(["2026-10-19"]);
    expect(seriesAfterEdit(before, { ...before, startDate: "2026-10-13", endDate: "2026-10-13" }).excludedOn).toEqual([]);
    expect(seriesAfterEdit(before, { ...before, repeat: rule("week", 2) }).excludedOn).toEqual([]);
    expect(seriesAfterEdit(before, { ...before, repeat: rule("month") }).excludedOn).toEqual([]);
    expect(seriesAfterEdit(before, { ...before, repeat: null }).excludedOn).toEqual([]);
  });
});

/* --------------------------------- parser --------------------------------- */

describe("the request parser, V2", () => {
  const v2 = {
    v: 2, id: ID, title: "Doctor", startDate: "2026-10-12", endDate: "2026-10-12",
    note: "", color: "blue", kind: "none",
    startTime: "14:30", endTime: "15:15", timeZone: "America/Chicago",
    repeat: null,
  };

  it("reads times and a repeat only from a client that says it knows them", () => {
    expect(isExtendedWrite(v2)).toBe(true);
    expect(isExtendedWrite({ ...v2, v: undefined })).toBe(false);
    expect(isExtendedWrite({ ...v2, v: "2" })).toBe(false);
    const legacy = parseImportantDate({ ...v2, v: undefined, repeat: rule("year") });
    expect(legacy).toMatchObject({ startTime: null, endTime: null, timeZone: null, repeat: null });
  });

  it("takes a timed event", () => {
    expect(parseImportantDate(v2)).toMatchObject({ startTime: "14:30", endTime: "15:15", timeZone: "America/Chicago" });
  });

  it("takes a repeat, and never deleted occurrences", () => {
    const e = parseImportantDate({ ...v2, repeat: { unit: "year", interval: 1, until: null },
      excludedOn: ["2027-10-12"] });
    expect(e.repeat).toEqual(rule("year"));
    expect(e.excludedOn).toEqual([]);
  });

  it("drops a zone that has no time to belong to", () => {
    expect(parseImportantDate({ ...v2, startTime: null, endTime: null }).timeZone).toBeNull();
  });

  it("keeps a time with no zone as floating", () => {
    expect(parseImportantDate({ ...v2, timeZone: null }).timeZone).toBeNull();
  });

  it("rejects what the editor would not have sent", () => {
    expect(() => parseImportantDate({ ...v2, startTime: "2:30 PM" })).toThrow(/HH:MM/);
    expect(() => parseImportantDate({ ...v2, startTime: "24:00" })).toThrow(/HH:MM/);
    expect(() => parseImportantDate({ ...v2, startTime: null })).toThrow(/start time/);
    expect(() => parseImportantDate({ ...v2, timeZone: "Mars/Olympus" })).toThrow(/time zone/);
    expect(() => parseImportantDate({ ...v2, endTime: "14:00" })).toThrow(/end time/);
    expect(() => parseImportantDate({ ...v2, repeat: { unit: "day" } })).toThrow(/repeat.unit/);
    expect(() => parseImportantDate({ ...v2, repeat: { unit: "week", interval: 0 } })).toThrow(/interval/);
    expect(() => parseImportantDate({ ...v2, repeat: { unit: "week", interval: 2.5 } })).toThrow(/interval/);
    expect(() => parseImportantDate({ ...v2, repeat: { unit: "week", until: "2026-01-01" } })).toThrow(/before/);
    expect(() => parseImportantDate({ ...v2, endDate: "2026-10-20", endTime: null,
      repeat: { unit: "week" } })).toThrow(/next one/);
  });

  it("keeps a Chinese title exactly as typed", () => {
    expect(parseImportantDate({ ...v2, title: "妈妈的生日" }).title).toBe("妈妈的生日");
  });
});

/* --------------------------------- wording -------------------------------- */

describe("wording, V2", () => {
  it("has every new label in every language", () => {
    for (const locale of LOCALES) {
      const t = dict(locale).importantDates;
      for (const k of EVENT_KINDS) expect(t.kinds[k], `${locale}/${k}`).toBeTruthy();
      for (const p of ["none", "year", "month", "week", "custom"] as const) {
        expect(t.repeatOptions[p], `${locale}/${p}`).toBeTruthy();
      }
      for (const p of ["endTimeBeforeStart", "repeatTooShort", "untilBeforeStart", "intervalRange"] as const) {
        expect(t.problems[p], `${locale}/${p}`).toBeTruthy();
      }
      expect(t.repeatSummary.week(2)).toContain("2");
      expect(t.dayOf(2, 4)).toContain("4");
      expect(t.allDay && t.nothingPlanned && t.timesUnavailable && t.reloadToEdit).toBeTruthy();
    }
  });

  it("says the approved words", () => {
    const en = dict("en").importantDates;
    const zh = dict("zh").importantDates;
    expect([en.repeat, zh.repeat]).toEqual(["Repeat", "重复"]);
    expect([en.repeatOptions.none, zh.repeatOptions.none]).toEqual(["Does not repeat", "不重复"]);
    expect([en.repeatOptions.year, zh.repeatOptions.year]).toEqual(["Every year", "每年"]);
    expect([en.repeatOptions.month, zh.repeatOptions.month]).toEqual(["Every month", "每月"]);
    expect([en.repeatOptions.week, zh.repeatOptions.week]).toEqual(["Every week", "每周"]);
    expect([en.repeatOptions.custom, zh.repeatOptions.custom]).toEqual(["Custom", "自定义"]);
    expect([en.kinds.birthday, zh.kinds.birthday]).toEqual(["Birthday", "生日"]);
    expect([en.kinds.anniversary, zh.kinds.anniversary]).toEqual(["Anniversary", "纪念日"]);
    expect(dict("both").importantDates.repeatOptions.year).toBe("Every year · 每年");
  });

  it("writes a time the way each language reads one", () => {
    expect(clockTimeFor("19:00", "en")).toBe("7:00 PM");
    expect(clockTimeFor("19:00", "zh")).toBe("19:00");
    expect(clockTimeFor("08:05", "en")).toBe("8:05 AM");
    expect(clockTimeFor("00:00", "en")).toBe("12:00 AM");
    expect(clockTimeFor("19:00", "both")).toBe("7:00 PM");
  });
});
