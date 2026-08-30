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
  /**
   * Where it sits inside its section. The user's own arrangement, so it is
   * stored rather than derived — there is no rule that would reproduce it.
   */
  sortOrder: number;
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

/**
 * §26. A date the user personally considers important: a trip, a customer
 * visit, a deadline, a family occasion.
 *
 * Whole days, never times — this is a calendar you glance at beside today's
 * habits, not a diary. A single-day event has `startDate === endDate`, so
 * everything that reads it can treat one shape; which days it occupies is
 * derived by comparison rather than stored, exactly as with a `Priority`, so a
 * range crossing a month or a year needs no special case.
 *
 * Private user content. It is never shown to another user, never scored, never
 * part of Community Progress, and never read by an admin screen.
 */
export interface ImportantDate {
  id: string;
  /** The user's own words. Never translated, never rewritten. */
  title: string;
  startDate: string;       // YYYY-MM-DD
  /** Inclusive. Equal to startDate for a single-day event. */
  endDate: string;         // YYYY-MM-DD
  note: string;
  /** A palette key, or a '#rrggbb' the user picked. See lib/importantDates. */
  color: string;
  /** An optional English key, translated on render. "none" when unset. */
  kind: string;
}

export interface Prefs {
  theme: "light" | "dark";
  weighted: boolean;
  goalWeight: number | null;
  locale: Locale;
  /**
   * §19/§20. Whether this account appears to other people on the Community
   * board. Opting out hides the username, the percentage and the rank from
   * everyone else and removes them from the participant count; it changes
   * nothing about their own habits, history, analytics or My Progress, and
   * opting back in restores their place with nothing lost — the board is
   * recomputed from completions every time, so there is no stored ranking to
   * rebuild. Enforced on the server, in `scoreMember`.
   */
  communityVisible: boolean;
}

/**
 * A day's journal entry. Gratitude items are a list because people write one
 * some days and four on others — the product asks for "1–3 things" without
 * requiring three.
 */
export interface DayJournal {
  gratitude: string[];
  /** 今天的感想 — optional, and what the old day note became. */
  reflection: string;
}

/**
 * One line on the post-it.
 *
 * A record with an identity, not a string in a day's list, because it can
 * outlive the day it was written on. That identity is the whole of the
 * rollover: an unfinished priority appears again the next morning as *the
 * same* priority — one row, one creation date, one completion date when it
 * finally arrives. The alternative, copying the text forward into each new
 * day, is what produces the note that says "call the bank" three times and
 * then disagrees with itself about whether you called them.
 */
export interface Priority {
  id: string;
  text: string;
  /** The day it was first written. Never changes, however far it rolls. */
  createdOn: string;
  /**
   * The day it was actually ticked, not the day it was written and not the day
   * it stopped rolling — those are the same thing here, which is the point.
   * Null while it is still open.
   */
  completedOn: string | null;
}

/*
 * There is deliberately no cap on how many priorities a day may hold.
 *
 * There was one — five — from when a priority belonged to the day it was
 * written on. Rolling them forward made it incoherent: an unfinished line
 * arrives on its own, so a day could already hold six before anybody typed
 * anything, and the form would then refuse a seventh while showing all six.
 * A limit that history can walk straight past is not a limit, it is a
 * confusing message.
 *
 * Focus is still the point, and the screen still says so — as guidance, in
 * `t.priorities.focusHint`, rather than as a refusal.
 */

export interface AppState {
  habits: Habit[];
  goals: Goal[];
  completions: Completions;
  /**
   * The gratitude journal, by local date. Private user content: it is never
   * read by the admin screens and never leaves this account.
   */
  journal: Record<string, DayJournal>;
  /** A reflection on a whole month, keyed 'YYYY-MM'. */
  monthlyReflections: Record<string, string>;
  /**
   * The post-it. A flat list, not a map by day: an open priority belongs to no
   * single day, and which day it shows on is derived rather than stored — see
   * `prioritiesOn` in lib/priorities. Ordered as the user arranged it.
   * Private user content.
   */
  priorities: Priority[];
  /**
   * The user's own calendar of important dates. Private, like the journal and
   * the post-it: nothing here reaches Community Progress or an admin screen.
   */
  importantDates: ImportantDate[];
  awareness: AwarenessEntry[];
  stacks: Stack[];
  metrics: Record<string, DayMetrics>;
  reviews: WeeklyReview[];
  spending: SpendingRecord[];
  prefs: Prefs;
  /**
   * Modules the database could not answer for, by key.
   *
   * The app has already learned once what an empty array means when it is not
   * true: a table that was missing in production rendered as an account with
   * nothing in it. So a read that is allowed to survive a missing table (see
   * `loadState`) must say so, and the screen that would have shown the data
   * says "not available yet" instead of "you have none". Empty in every normal
   * case, including a brand-new account.
   */
  unavailable: string[];
}

/** §27. The suggested set. Stored as these keys; translated on render. */
export const SPENDING_CATEGORIES = [
  "housing", "food", "shopping", "transport", "travel",
  "entertainment", "personal_care", "education", "gifts", "other",
] as const;

export const emptyState = (): AppState => ({
  habits: [], goals: [], completions: {}, journal: {}, monthlyReflections: {},
  priorities: [], importantDates: [],
  awareness: [], stacks: [], metrics: {}, reviews: [], spending: [], unavailable: [],
  prefs: { theme: "light", weighted: true, goalWeight: null, locale: "en", communityVisible: true },
});
