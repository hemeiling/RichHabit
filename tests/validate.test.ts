import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/http";
import {
  parseCompletion, parseGoal, parseHabit, parseMetrics, parsePrefs, parseStack,
} from "../src/lib/validate";

/**
 * These run in front of every write. The point is that a bad body becomes a 400
 * with a readable message, instead of reaching Postgres and coming back as a
 * constraint violation.
 */

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";

const habit = (over: Record<string, unknown> = {}) => ({
  id: ID, name: "Read", description: "", category: "morning", type: "good",
  frequency: { mode: "daily", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 },
  target: 30, unit: "min", startDate: "2026-08-01", active: true, weight: 2,
  goalId: null, createdAt: 1, ...over,
});

describe("parseHabit", () => {
  it("accepts a well-formed habit", () => {
    const h = parseHabit(habit());
    expect(h.id).toBe(ID);
    expect(h.frequency.mode).toBe("daily");
  });

  it("rejects a non-uuid id", () => {
    expect(() => parseHabit(habit({ id: "'; drop table habits; --" }))).toThrow(ApiError);
  });

  it("rejects a category outside the enum", () => {
    // Postgres would reject this too, but as a 500 naming the enum type.
    expect(() => parseHabit(habit({ category: "afternoon" }))).toThrow(/category must be one of/);
  });

  it("rejects a weight outside 1..3", () => {
    expect(() => parseHabit(habit({ weight: 9 }))).toThrow(/weight must be/);
  });

  it("rejects a malformed start date", () => {
    expect(() => parseHabit(habit({ startDate: "01/08/2026" }))).toThrow(/YYYY-MM-DD/);
  });

  it("requires at least one weekday in 'days' mode", () => {
    expect(() => parseHabit(habit({ frequency: { mode: "days", days: [], timesPerWeek: 3 } })))
      .toThrow(/at least one day/);
  });

  it("drops out-of-range weekdays and de-duplicates", () => {
    const h = parseHabit(habit({ frequency: { mode: "days", days: [1, 1, 9, -2, 5], timesPerWeek: 3 } }));
    expect(h.frequency.days).toEqual([1, 5]);
  });

  it("bounds timesPerWeek in 'times' mode", () => {
    expect(() => parseHabit(habit({ frequency: { mode: "times", days: [], timesPerWeek: 40 } })))
      .toThrow(/between 1 and 7/);
  });

  it("keeps a uuid goalId and nulls anything else", () => {
    expect(parseHabit(habit({ goalId: OTHER })).goalId).toBe(OTHER);
    expect(parseHabit(habit({ goalId: "nope" })).goalId).toBeNull();
  });

  it("rejects a name longer than the column allows", () => {
    expect(() => parseHabit(habit({ name: "x".repeat(500) }))).toThrow(/too long/);
  });
});

describe("parseCompletion", () => {
  it("treats anything but true as not done", () => {
    expect(parseCompletion({ habitId: ID, date: "2026-08-01", done: "yes" }).done).toBe(false);
  });

  it("rejects NaN values that Postgres would choke on", () => {
    expect(() => parseCompletion({ habitId: ID, date: "2026-08-01", done: true, value: "abc" }))
      .toThrow(/must be a number/);
  });
});

describe("parseStack", () => {
  const base = { id: ID, triggerText: "After coffee", newText: "Read 10 pages" };

  it("accepts a text-only stack", () => {
    expect(parseStack(base).triggerText).toBe("After coffee");
  });

  it("mirrors the stack_has_trigger constraint", () => {
    expect(() => parseStack({ ...base, triggerText: "" })).toThrow(/needs a trigger/);
  });

  it("mirrors the stack_has_target constraint", () => {
    expect(() => parseStack({ ...base, newText: "" })).toThrow(/needs something to attach/);
  });

  it("rejects a malformed time", () => {
    expect(() => parseStack({ ...base, time: "7am" })).toThrow(/HH:MM/);
  });
});

describe("parseMetrics", () => {
  it("coerces blanks to null rather than sending empty strings", () => {
    const { metrics } = parseMetrics({ date: "2026-08-01", metrics: { weight: "", sleep: "6.1" } });
    expect(metrics.weight).toBeNull();
    expect(metrics.sleep).toBe(6.1);
  });

  it("rejects Infinity", () => {
    expect(() => parseMetrics({ date: "2026-08-01", metrics: { water: Infinity } }))
      .toThrow(/must be a number/);
  });
});

describe("parseGoal / parsePrefs", () => {
  it("falls back to a placeholder name rather than writing an empty string", () => {
    expect(parseGoal({ id: ID, name: "   " }).name).toBe("Untitled");
  });

  it("rejects a theme outside the check constraint", () => {
    expect(() => parsePrefs({ theme: "solarized" })).toThrow(/theme must be one of/);
  });
});
