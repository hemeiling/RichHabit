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
export const prettyDate = (s: string) =>
  parseISO(s).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
export const shortDate = (s: string) =>
  parseISO(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const rangeBack = (endISO: string, n: number) =>
  Array.from({ length: n }, (_, i) => addDays(endISO, -(n - 1 - i)));
