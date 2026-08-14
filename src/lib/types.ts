export type Locale = "both" | "en" | "zh";
export type Category = "morning" | "daytime" | "nighttime";
export type HabitKind = "good" | "avoid";
export type FreqMode = "daily" | "days" | "times";
export type Grade = "good" | "bad" | "neutral";
/** §19. How a habit is measured. Only `boolean` is wired into tracking today;
 *  the rest are carried by the library so habit design can use them next. */
export type TrackingType =
  | "boolean" | "count" | "duration" | "quantity"
  | "frequency" | "interval" | "time" | "maximum" | "avoidance";

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
  target: number | null;
  unit: string;
  startDate: string;     // YYYY-MM-DD
  status: HabitStatus;
  /** Convenience for the engine and the screens: status === "active". */
  active: boolean;
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
  prefs: Prefs;
}

export const emptyState = (): AppState => ({
  habits: [], goals: [], completions: {}, dayNotes: {},
  awareness: [], stacks: [], metrics: {}, reviews: [],
  prefs: { theme: "light", weighted: true, goalWeight: null, locale: "en" },
});
