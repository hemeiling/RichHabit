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
export const rangeBack = (endISO: string, n: number) =>
  Array.from({ length: n }, (_, i) => addDays(endISO, -(n - 1 - i)));
