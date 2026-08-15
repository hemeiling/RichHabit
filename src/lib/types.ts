export type Locale = "both" | "en" | "zh";
export type Category = "morning" | "daytime" | "nighttime";
export type HabitKind = "good" | "avoid";
export type FreqMode = "daily" | "days" | "times";
export type Grade = "good" | "bad" | "neutral";
/**
 * §12. How a habit is measured.
 *
 * `boolean` and `avoidance` are a yes/no. The rest carry a number, which Today
 * collects inline: `maximum` succeeds by staying *under* its target, the others
 * by reaching theirs.
 */
export type TrackingType =
  | "boolean" | "count" | "duration" | "quantity"
  | "interval" | "maximum" | "avoidance";

/** True when the type is measured by a number rather than a yes/no. */
export const isNumericTracking = (t: TrackingType): boolean =>
  t === "count" || t === "duration" || t === "quantity" || t === "interval" || t === "maximum";

/** §14. `active` is the only status that reaches Today and the score. */
export type HabitStatus =
  | "candidate" | "recommended" | "planned"
  | "active" | "paused" | "established" | "retired";

export interface Frequency {
  mode: FreqMode;
  days: number[];        // 0 = Sunday
  timesPerWeek: number;
}

export interface Habit {
  id: string;
  /** Stored text. For a seeded habit this is the English wording; the display
   *  name comes from `templateKey` via src/lib/templates.ts. */
  name: string;
  /** Set only on habits this app seeded. Null once the user renames it. */
  templateKey: string | null;
  description: string;
  category: Category;
  type: HabitKind;
  frequency: Frequency;
  tracking: TrackingType;
  /** §20. What still counts on a bad day. Null means the target is the only bar. */
  minimum: number | null;
  target: number | null;
  unit: string;
  /** §11. "After I [anchor], I will…" */
  anchor: string;
  environment: string;
  friction: string;
  startDate: string;     // YYYY-MM-DD
  status: HabitStatus;
  /** Convenience for the engine and the screens: status === "active". */
  active: boolean;
  /** §10. The behaviour this is meant to replace, kept rather than deleted. */
  replacesHabitId: string | null;
  /** §18. Why the coach proposed it. Null on anything the user made. */
  rationale: string | null;
  weight: 1 | 2 | 3;
  goalId: string | null;
  createdAt: number;
}

export interface Goal {
  id: string;
  name: string;
  templateKey: string | null;
  area: string;
  why: string;
}

export interface Completion {
  done: boolean;
  value?: number | null;
  note?: string;
}

/** completions[date][habitId] — a row exists only when the habit was done. */
export type Completions = Record<string, Record<string, Completion>>;

export interface AwarenessEntry {
  id: string;
  time: string;
  activity: string;
  duration: string;
  context: string;
  notes: string;
  grade: Grade;
}

export interface Stack {
  id: string;
  triggerHabitId: string;
  triggerText: string;
  newHabitId: string;
  newText: string;
  time: string;
  location: string;
}

export interface DayMetrics {
  weight?: number | string | null;
  calories?: number | string | null;
  sleep?: number | string | null;
  water?: number | string | null;
  cardioMin?: number | string | null;
  cardio?: boolean;
  gym?: boolean;
}

export interface WeeklyReview {
  id: string;
  weekStart: string;
  wentWell: string;
  gotInWay: string;
  focus: string;
  modify: string;
  add: string;
  stats?: {
    pct: number | null;
    done: number;
    scheduled: number;
    perfect: number;
    best: string | null;
    worst: string | null;
    longest: number;
  };
}

/** §27. Awareness of where money goes — an outcome record, not a habit. */
export interface SpendingRecord {
  id: string;
  date: string;            // YYYY-MM-DD
  amount: number;
  description: string;
  /** An English key; the UI translates it on render. */
  category: string;
  needWant: "need" | "want";
  planned: boolean;
  notes: string;
}

export interface Prefs {
  theme: "light" | "dark";
  weighted: boolean;
  goalWeight: number | null;
  locale: Locale;
}

export interface AppState {
  habits: Habit[];
  goals: Goal[];
  completions: Completions;
  dayNotes: Record<string, string>;
  awareness: AwarenessEntry[];
  stacks: Stack[];
  metrics: Record<string, DayMetrics>;
  reviews: WeeklyReview[];
  spending: SpendingRecord[];
  prefs: Prefs;
}

/** §27. The suggested set. Stored as these keys; translated on render. */
export const SPENDING_CATEGORIES = [
  "housing", "food", "shopping", "transport", "travel",
  "entertainment", "personal_care", "education", "gifts", "other",
] as const;

export const emptyState = (): AppState => ({
  habits: [], goals: [], completions: {}, dayNotes: {},
  awareness: [], stacks: [], metrics: {}, reviews: [], spending: [],
  prefs: { theme: "light", weighted: true, goalWeight: null, locale: "en" },
});
