// Day names live in the dictionaries (`t.days`); these are the fallback for
// non-UI callers that have no locale to hand.
export const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_INITIAL = ["S", "M", "T", "W", "T", "F", "S"];

const pad = (n: number) => String(n).padStart(2, "0");

export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const todayISO = () => iso(new Date());
export const addDays = (s: string, n: number) => {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const dow = (s: string) => parseISO(s).getDay();
/** Weeks run Sunday to Saturday, matching the workbook's seven-day checklist. */
export const weekStart = (s: string) => addDays(s, -dow(s));
export const daysBetween = (a: string, b: string) =>
  Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
/**
 * Date formatting takes an explicit BCP-47 tag rather than reading the system
 * locale, so the page matches the language the user picked in the app — the two
 * are often not the same.
 */
export const prettyDate = (s: string, tag = "en-US") =>
  parseISO(s).toLocaleDateString(tag, { weekday: "long", month: "long", day: "numeric" });
export const shortDate = (s: string, tag = "en-US") =>
  parseISO(s).toLocaleDateString(tag, { month: "short", day: "numeric" });
/**
 * For an instant rather than a calendar day — when an account was created, say.
 * Takes a full ISO timestamp and renders it in the reader's own timezone, with
 * a year and no weekday: nobody needs to know it was a Tuesday, and a year that
 * is not this one matters.
 */
export const instantDate = (iso: string, tag = "en-US") =>
  new Date(iso).toLocaleDateString(tag, { year: "numeric", month: "long", day: "numeric" });
export const rangeBack = (endISO: string, n: number) =>
  Array.from({ length: n }, (_, i) => addDays(endISO, -(n - 1 - i)));

/* ------------------------------- months ------------------------------------
 * Calendar months as 'YYYY-MM' strings, for the same reason days are
 * 'YYYY-MM-DD': they compare, sort and key correctly as plain text, and no
 * Date object crosses a timezone boundary on the way.
 */
export const monthOf = (s: string) => s.slice(0, 7);
export const thisMonth = () => monthOf(todayISO());
/** First day of a month, as a date. */
export const monthFirst = (month: string) => `${month}-01`;
/** `n` months on (or back), clamped by the calendar rather than by 30-day maths. */
export const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${pad((total % 12) + 1)}`;
};
/** How many months from `a` to `b`; negative when `b` is earlier. */
export const monthsBetween = (a: string, b: string) => {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by * 12 + bm) - (ay * 12 + am);
};
export const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();   // day 0 of the next month
};

/**
 * A month as whole weeks, Sunday to Saturday — the same week the rest of the
 * app uses (`weekStart`). Always begins on or before the 1st and ends on or
 * after the last day, so the grid is rectangular and days from the neighbouring
 * months are real dates rather than blanks: an event that runs from the 29th of
 * one month into the 2nd of the next is then drawable in both grids.
 */
export const monthGrid = (month: string): string[][] => {
  const first = monthFirst(month);
  const start = addDays(first, -dow(first));
  const last = `${month}-${pad(daysInMonth(month))}`;
  const end = addDays(last, 6 - dow(last));
  const weeks: string[][] = [];
  for (let d = start; d <= end; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  }
  return weeks;
};
