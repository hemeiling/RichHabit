import { todayISO } from "@/lib/dates";
import { blankHabit, frequencyDefaults } from "@/lib/habits";
import type { Dict } from "@/lib/i18n";
import { FRANKLIN_VIRTUES, rotationStartFor } from "@/lib/rotation";
import type { Rotation } from "@/lib/rotation";
import { canonical, canonicalDescription } from "@/lib/templates";
import type { Category, FreqMode, Frequency, Habit, HabitKind, TrackingType } from "@/lib/types";

/**
 * The curated habit library (§10–11).
 *
 * Structure and suggested defaults only — every display string resolves through
 * `templates.*` in the dictionaries, so the library reads in the language the
 * browser is using and adding a language never means editing this file.
 *
 * Everything here is a *suggestion*. Adopting a library habit copies it into the
 * user's own `habits` row, and from that moment the copy is theirs: editing it
 * does not change the catalogue, and the catalogue changing does not rewrite
 * anyone's habit. That is also why the definitions live in code rather than in
 * a table: they are version-controlled, reviewed, and tested, and no request
 * from a browser can change them.
 */

/**
 * How directly a collection habit comes from its person — shown to the reader
 * in plain words, so an adaptation is never mistaken for a quotation.
 *
 *   documented  they did this themselves (their own words, or an eyewitness)
 *   principle   they recommend it, in their own words
 *   adaptation  RichHabit's habit, inspired by their ideas; the schedule is ours
 */
export type Attribution = "documented" | "principle" | "adaptation";

/** The named collections, in display order. The first five are featured. */
export const COLLECTIONS = ["franklin", "corley", "gates", "musk", "bezos", "history"] as const;
export type CollectionKey = (typeof COLLECTIONS)[number];

export interface LibraryHabit {
  key: string;
  category: Category;
  kind: HabitKind;
  /** §18 life domain, for browsing by area of life rather than time of day. */
  lifeDomain: "health" | "career" | "learning" | "money" | "relationships" | "home";
  tracking: TrackingType;
  weight: 1 | 2 | 3;
  /** §20. What still counts on a bad day, and what a good day looks like. */
  minimum: number | null;
  target: number | null;
  unit: string | null;
  /** The suggested way of repeating — any of HT-2b's modes. */
  frequency: FreqMode;
  /** Suggested weekdays when `frequency` is "days" (0 = Sunday). */
  days?: number[];
  /** Suggested count when `frequency` is "times" (a week). */
  timesPerWeek?: number;
  /** Suggested count when `frequency` is "month_times". */
  timesPerMonth?: number;
  /**
   * §10. Which shelf of the catalogue this sits on. The everyday set has no
   * tag; a collection can also show an everyday habit (`borrowed` below).
   */
  collection?: CollectionKey;
  /** Its place inside the collection: a Franklin virtue, a Corley theme. */
  group?: string;
  /** On every collection item. */
  attribution?: Attribution;
  /**
   * The source, as a link that was opened and checked (docs/TEMPLATE_SOURCES.md).
   * Required on the featured collections; the history shelf cites books.
   */
  url?: string;
  /**
   * HT-2c. The habit rotates through this list, one item a week. Never part of
   * a collection's Select all: the collection already offers each item.
   */
  rotation?: Rotation;
  /** An app screen this habit works with, linked from its menu on Today. */
  opens?: "spending" | "review";
}

/* ── Verified sources (checked 2026-10-20; see docs/TEMPLATE_SOURCES.md) ── */
const SRC = {
  franklin: "https://www.gutenberg.org/ebooks/148",
  franklinBio: "https://fi.edu/en/science-and-education/benjamin-franklin/faq",
  corleySite: "https://richhabits.net/",
  corleyAbout: "https://richhabits.net/about-tom/",
  corleyMorning2018: "https://www.cnbc.com/2018/06/11/tom-corley-how-to-use-your-morning-routine-to-get-ahead.html",
  corleyPriorities2018: "https://www.cnbc.com/2018/09/17/tom-corley-i-study-millionaires-this-is-the-secret-to-success.html",
  corleyRoutine2018: "https://www.cnbc.com/2018/10/03/author-who-studies-millionaires-adopt-this-morning-routine.html",
  corleyConsistency2018: "https://www.cnbc.com/2018/10/16/tom-corley-how-do-you-get-rich-heres-what-177-millionaires-told-me.html",
  corleyWealthy2017: "https://www.cnbc.com/2017/10/25/heres-the-trick-to-becoming-wealthy-says-tom-corley.html",
  corleyMoneyGoals2017: "https://www.cnbc.com/2017/01/26/3-financial-tricks-rich-people-use-to-save-according-to-a-man-who-studies-millionaires.html",
  corleyToDont: "https://richhabits.net/the-to-dont-list-is-more-important-than-the-to-do-list/",
  corleyAction: "https://richhabits.net/without-action-knowledge-is-worthless-to-be-successful-you-must-put-what-you-learn-to-immediate-use/",
  corleyDailyHabits: "https://richhabits.net/daily-habits-that-make-you-rich-or-poor/",
  corleyChecklist: "https://richhabits.net/checklist-millionaires",
  gatesReading1990: "https://archive.seattletimes.com/archive/19900731/1085429/bill-gates-seems-like-a-pretty-regular-guy---for-a-billionaire",
  gatesNotes2024: "https://www.linkedin.com/posts/williamhgates_why-writing-by-hand-beats-typing-for-thinking-activity-7203425524151377920-8d0J/",
  gatesThinkWeek: "https://www.nbcsandiego.com/news/business/money-report/bill-gates-if-i-grew-up-with-smartphones-i-mightve-lost-a-crucial-trait-that-made-me-a-billionaire/3691824/",
  gatesCourses2010: "https://www.eschoolnews.com/top-news/2010/01/24/what-bill-gates-is-learning-online/",
  gatesLearning2016: "https://cbcbooks.org/2016/01/07/bill-gates-on-the-value-of-reading/",
  gatesBio: "https://www.gatesfoundation.org/about/leadership/bill-gates",
  gatesReading2016: "https://www.openculture.com/2016/12/bill-gates-lists-his-favorite-books-of-2016.html",
  muskTed2013: "https://www.ted.com/talks/elon_musk_the_mind_behind_tesla_spacex_solarcity/transcript",
  muskStarbase2021: "https://everydayastronaut.com/starbase-tour-and-interview-with-elon-musk/",
  bezosLetter1997: "https://www.aboutamazon.com/news/company-news/amazons-original-1997-letter-to-shareholders",
  bezosLetter2015: "https://www.sec.gov/Archives/edgar/data/1018724/000119312516530910/d168744dex991.htm",
  bezosLetter2016: "https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders",
  bezosLetters: "https://www.aboutamazon.com/about-us/shareholder-letters",
  bezosEconClub2018: "https://www.economicclub.org/sites/default/files/transcripts/Jeff_Bezos_Edited_Transcript.pdf",
  bezosAchievement2001: "https://achievement.org/achiever/jeffrey-p-bezos/",
} as const;

/** One habit of a featured collection: a boolean habit unless it says otherwise. */
function featured(
  collection: CollectionKey, key: string, group: string | undefined, attribution: Attribution,
  url: string, category: Category, lifeDomain: LibraryHabit["lifeDomain"],
  rhythm: Pick<LibraryHabit, "frequency" | "timesPerWeek" | "timesPerMonth">,
  more: Partial<LibraryHabit> = {},
): LibraryHabit {
  return {
    key, category, kind: "good", lifeDomain, tracking: "boolean", weight: 2,
    minimum: null, target: null, unit: null, collection, group, attribution, url, ...rhythm, ...more,
  };
}
const DAILY = { frequency: "daily" } as const;
const WEEKLY = { frequency: "times", timesPerWeek: 1 } as const;
const MONTHLY = { frequency: "month_times", timesPerMonth: 1 } as const;
const weekly = (n: number) => ({ frequency: "times", timesPerWeek: n }) as const;

/**
 * Franklin's thirteen, each twice: the virtue itself, kept his way (an evening
 * check, as in his little book), and one practical habit that applies it today.
 * The practical habit is a RichHabit adaptation — except Humility's, which is
 * his own recorded rule.
 */
const FRANKLIN_PRACTICE: Record<(typeof FRANKLIN_VIRTUES)[number], {
  category: Category; lifeDomain: LibraryHabit["lifeDomain"];
  rhythm: Pick<LibraryHabit, "frequency" | "timesPerWeek" | "timesPerMonth">;
  attribution?: Attribution; opens?: "spending";
}> = {
  temperance: { category: "daytime", lifeDomain: "health", rhythm: DAILY },
  silence: { category: "daytime", lifeDomain: "relationships", rhythm: DAILY },
  order: { category: "nighttime", lifeDomain: "career", rhythm: DAILY },
  resolution: { category: "daytime", lifeDomain: "career", rhythm: DAILY },
  frugality: { category: "nighttime", lifeDomain: "money", rhythm: WEEKLY, opens: "spending" },
  industry: { category: "daytime", lifeDomain: "career", rhythm: DAILY },
  sincerity: { category: "daytime", lifeDomain: "relationships", rhythm: DAILY },
  justice: { category: "daytime", lifeDomain: "relationships", rhythm: WEEKLY },
  moderation: { category: "nighttime", lifeDomain: "home", rhythm: WEEKLY },
  cleanliness: { category: "nighttime", lifeDomain: "home", rhythm: DAILY },
  tranquility: { category: "nighttime", lifeDomain: "home", rhythm: WEEKLY },
  chastity: { category: "nighttime", lifeDomain: "relationships", rhythm: WEEKLY },
  humility: { category: "daytime", lifeDomain: "relationships", rhythm: DAILY, attribution: "documented" },
};

export const LIBRARY: LibraryHabit[] = [
  // ── morning ───────────────────────────────────────────────────────────────
  { key: "plan_priorities", category: "morning", kind: "good", lifeDomain: "career", tracking: "boolean", weight: 3, minimum: null, target: null, unit: null, frequency: "daily" },
  { key: "exercise", category: "morning", kind: "good", lifeDomain: "health", tracking: "duration", weight: 3, minimum: 5, target: 30, unit: "min", frequency: "daily" },
  { key: "read_for_learning", category: "morning", kind: "good", lifeDomain: "learning", tracking: "duration", weight: 2, minimum: 2, target: 30, unit: "min", frequency: "daily" },
  { key: "begin_intentionally", category: "morning", kind: "good", lifeDomain: "health", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily" },
  { key: "skip_early_email", category: "morning", kind: "avoid", lifeDomain: "career", tracking: "avoidance", weight: 1, minimum: null, target: null, unit: null, frequency: "daily" },
  { key: "brush_morning_night", category: "morning", kind: "good", lifeDomain: "health", tracking: "count", weight: 1, minimum: 1, target: 2, unit: "times", frequency: "daily" },

  // ── daytime ───────────────────────────────────────────────────────────────
  { key: "important_goals", category: "daytime", kind: "good", lifeDomain: "career", tracking: "count", weight: 3, minimum: 1, target: 3, unit: "tasks", frequency: "daily" },
  { key: "top_three_priorities", category: "daytime", kind: "good", lifeDomain: "career", tracking: "boolean", weight: 3, minimum: null, target: null, unit: null, frequency: "daily" },
  { key: "drink_water", category: "daytime", kind: "good", lifeDomain: "health", tracking: "quantity", weight: 1, minimum: 4, target: 8, unit: "glasses", frequency: "daily" },
  { key: "movement_breaks", category: "daytime", kind: "good", lifeDomain: "health", tracking: "interval", weight: 2, minimum: 2, target: 6, unit: "times", frequency: "daily" },
  { key: "stand_every_hour", category: "daytime", kind: "good", lifeDomain: "health", tracking: "interval", weight: 2, minimum: 3, target: 8, unit: "times", frequency: "daily" },
  { key: "avoid_junk_food", category: "daytime", kind: "avoid", lifeDomain: "health", tracking: "avoidance", weight: 2, minimum: null, target: null, unit: null, frequency: "daily" },
  { key: "downtime_learning", category: "daytime", kind: "good", lifeDomain: "learning", tracking: "duration", weight: 1, minimum: 5, target: 20, unit: "min", frequency: "daily" },
  { key: "record_spending", category: "daytime", kind: "good", lifeDomain: "money", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily", opens: "spending" },

  // ── nighttime ─────────────────────────────────────────────────────────────
  { key: "read_for_learning_night", category: "nighttime", kind: "good", lifeDomain: "learning", tracking: "duration", weight: 2, minimum: 2, target: 30, unit: "min", frequency: "daily" },
  { key: "prepare_tomorrow", category: "nighttime", kind: "good", lifeDomain: "career", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily" },
  { key: "bedtime_routine", category: "nighttime", kind: "good", lifeDomain: "health", tracking: "boolean", weight: 3, minimum: null, target: null, unit: null, frequency: "daily" },
  { key: "limit_tv", category: "nighttime", kind: "avoid", lifeDomain: "home", tracking: "maximum", weight: 2, minimum: null, target: 1, unit: "hr", frequency: "daily" },
  { key: "limit_internet", category: "nighttime", kind: "avoid", lifeDomain: "home", tracking: "maximum", weight: 2, minimum: null, target: 1, unit: "hr", frequency: "daily" },
  { key: "review_spending", category: "nighttime", kind: "good", lifeDomain: "money", tracking: "boolean", weight: 1, minimum: null, target: null, unit: null, frequency: "times", timesPerWeek: 1, opens: "spending" },
  { key: "meaningful_goal_hour", category: "nighttime", kind: "good", lifeDomain: "career", tracking: "duration", weight: 3, minimum: 5, target: 60, unit: "min", frequency: "daily" },
  { key: "reach_out_to_someone", category: "nighttime", kind: "good", lifeDomain: "relationships", tracking: "boolean", weight: 1, minimum: null, target: null, unit: null, frequency: "times", timesPerWeek: 3 },

  /*
   * ── A. Franklin's thirteen virtues (Autobiography, Part Two) ─────────────
   * His own method first: one virtue a week in turn (HT-2c's rotation — the
   * one place that list's order lives), and the day's morning and evening
   * questions. Then each virtue: the virtue itself, marked each evening as he
   * did, and one practical habit. The virtue's name and precept are defined
   * once (templates.habits / templates.descriptions `franklin_<virtue>`) and
   * reused by the rotation and by its practice's "Why".
   */
  featured("franklin", "franklin_virtue_week", "method", "documented", SRC.franklin, "nighttime", "home", DAILY, { rotation: "franklin_virtues" }),
  featured("franklin", "franklin_morning_question", "method", "documented", SRC.franklin, "morning", "home", DAILY),
  featured("franklin", "franklin_evening_question", "method", "documented", SRC.franklin, "nighttime", "home", DAILY),
  ...FRANKLIN_VIRTUES.flatMap((v): LibraryHabit[] => {
    const p = FRANKLIN_PRACTICE[v];
    return [
      featured("franklin", `franklin_${v}`, v, "documented", SRC.franklin, "nighttime", "home", DAILY),
      featured("franklin", `franklin_${v}_practice`, v, p.attribution ?? "adaptation", SRC.franklin,
        p.category, p.lifeDomain, p.rhythm, p.opens ? { opens: p.opens } : {}),
    ];
  }),

  /*
   * ── B. Thomas C. Corley: Rich Habits ─────────────────────────────────────
   * Five themes, which are RichHabit's grouping (the theme names are ours, not
   * his). Four everyday templates appear here too — see COLLECTION_INFO — so
   * someone who already has them sees ✓ instead of a duplicate. None of his
   * study statistics is repeated anywhere: they disagree between his articles.
   */
  featured("corley", "corley_phone_free_morning", "corley_morning", "adaptation", SRC.corleyToDont, "morning", "career", DAILY, { kind: "avoid", tracking: "avoidance" }),
  featured("corley", "corley_say_no", "corley_attention", "adaptation", SRC.corleyToDont, "daytime", "career", WEEKLY),
  featured("corley", "corley_to_dont", "corley_attention", "principle", SRC.corleyToDont, "morning", "career", DAILY),
  featured("corley", "corley_time_block", "corley_attention", "principle", SRC.corleyRoutine2018, "daytime", "career", DAILY, { weight: 3 }),
  featured("corley", "corley_insight", "corley_learning", "adaptation", SRC.corleyMorning2018, "nighttime", "learning", weekly(3)),
  featured("corley", "corley_apply_idea", "corley_learning", "principle", SRC.corleyAction, "daytime", "learning", WEEKLY),
  featured("corley", "corley_learning_review", "corley_learning", "adaptation", SRC.corleyAction, "nighttime", "learning", MONTHLY),
  featured("corley", "corley_pay_yourself_first", "corley_money", "principle", SRC.corleyWealthy2017, "daytime", "money", MONTHLY, { weight: 3 }),
  featured("corley", "corley_card_in_full", "corley_money", "adaptation", SRC.corleyDailyHabits, "daytime", "money", MONTHLY),
  featured("corley", "corley_money_goals", "corley_money", "adaptation", SRC.corleyMoneyGoals2017, "nighttime", "money", MONTHLY),
  featured("corley", "corley_checkin", "corley_consistency", "principle", SRC.corleyChecklist, "nighttime", "home", DAILY),
  featured("corley", "corley_weekly_review", "corley_consistency", "adaptation", SRC.corleyChecklist, "nighttime", "home", WEEKLY, { opens: "review" }),
  featured("corley", "corley_monthly_growth", "corley_consistency", "adaptation", SRC.corleyConsistency2018, "nighttime", "home", MONTHLY),

  /*
   * ── C. Bill Gates: lifelong learning ─────────────────────────────────────
   * Only "Read before sleep" quotes a routine of his, and its 30 minutes is
   * RichHabit's suggestion (he said an hour, in 1990) — hence an adaptation.
   */
  featured("gates", "gates_reading_before_sleep", undefined, "adaptation", SRC.gatesReading1990, "nighttime", "learning", DAILY, { tracking: "duration", minimum: 10, target: 30, unit: "min" }),
  featured("gates", "gates_learning_note", undefined, "adaptation", SRC.gatesNotes2024, "nighttime", "learning", WEEKLY),
  featured("gates", "gates_think_time", undefined, "adaptation", SRC.gatesThinkWeek, "daytime", "learning", WEEKLY),
  featured("gates", "gates_new_field", undefined, "adaptation", SRC.gatesCourses2010, "daytime", "learning", MONTHLY),
  featured("gates", "gates_apply_learning", undefined, "adaptation", SRC.gatesLearning2016, "nighttime", "learning", WEEKLY),

  /*
   * ── D. Elon Musk: first-principles thinking ──────────────────────────────
   * The thinking method only. Nothing here is about hours or sleep.
   */
  featured("musk", "musk_challenge_assumption", undefined, "principle", SRC.muskTed2013, "daytime", "career", WEEKLY),
  featured("musk", "musk_first_principles", undefined, "principle", SRC.muskTed2013, "daytime", "career", WEEKLY),
  featured("musk", "musk_focus_session", undefined, "adaptation", SRC.muskTed2013, "daytime", "career", weekly(3)),
  featured("musk", "musk_delete_step", undefined, "principle", SRC.muskStarbase2021, "daytime", "career", WEEKLY),
  featured("musk", "musk_failure_review", undefined, "adaptation", SRC.muskStarbase2021, "nighttime", "learning", WEEKLY),

  /*
   * ── E. Jeff Bezos: long-term thinking ────────────────────────────────────
   * Two documented practices (2018, his own words) and habits built on his
   * shareholder letters.
   */
  featured("bezos", "bezos_sleep_eight", undefined, "documented", SRC.bezosEconClub2018, "nighttime", "health", DAILY),
  featured("bezos", "bezos_hard_before_lunch", undefined, "documented", SRC.bezosEconClub2018, "daytime", "career", DAILY),
  featured("bezos", "bezos_key_decision", undefined, "adaptation", SRC.bezosLetter2016, "morning", "career", DAILY),
  featured("bezos", "bezos_customer_view", undefined, "principle", SRC.bezosLetter2016, "daytime", "career", WEEKLY),
  featured("bezos", "bezos_door_check", undefined, "principle", SRC.bezosLetter2015, "daytime", "career", WEEKLY),
  featured("bezos", "bezos_simplify_process", undefined, "adaptation", SRC.bezosLetter2016, "daytime", "career", WEEKLY),
  featured("bezos", "bezos_long_term_review", undefined, "adaptation", SRC.bezosLetter1997, "nighttime", "home", MONTHLY),

  /*
   * ── From history ─────────────────────────────────────────────────────────
   * Only practices their own words or an eyewitness documented, each cited
   * in `templates.sources` (books, so no link). Stated frequencies only —
   * all daily; where a source gave no amount, the template suggests none.
   */
  { key: "marcus_morning_prep", category: "morning", kind: "good", lifeDomain: "home", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily", collection: "history", attribution: "principle" },
  { key: "darwin_morning_walk", category: "morning", kind: "good", lifeDomain: "health", tracking: "boolean", weight: 1, minimum: null, target: null, unit: null, frequency: "daily", collection: "history", attribution: "documented" },
  { key: "hemingway_morning_writing", category: "morning", kind: "good", lifeDomain: "career", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily", collection: "history", attribution: "documented" },
  { key: "darwin_daily_walk", category: "daytime", kind: "good", lifeDomain: "health", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily", collection: "history", attribution: "documented" },
  { key: "buffett_reading_block", category: "daytime", kind: "good", lifeDomain: "learning", tracking: "duration", weight: 2, minimum: null, target: null, unit: "min", frequency: "daily", collection: "history", attribution: "documented" },
  { key: "seneca_evening_review", category: "nighttime", kind: "good", lifeDomain: "home", tracking: "boolean", weight: 2, minimum: null, target: null, unit: null, frequency: "daily", collection: "history", attribution: "documented" },
];

export const libraryByKey = new Map(LIBRARY.map((h) => [h.key, h]));

/** An everyday template shown inside a collection, with that collection's source. */
interface Borrowed {
  key: string;
  group: string;
  attribution: Attribution;
  url: string;
  /** Where it lands from this collection, when that differs from the template's own. */
  category?: Category;
}

export interface CollectionInfo {
  /** Text-first card: initials, never a portrait. */
  initials: string;
  featured: boolean;
  /** Group order; a collection without groups lists its habits in order. */
  groups: readonly string[];
  borrowed?: readonly Borrowed[];
  /** "About this person" — checked links, labelled by `templates.collections[c].links`. */
  links: readonly string[];
}

export const COLLECTION_INFO: Record<CollectionKey, CollectionInfo> = {
  franklin: {
    initials: "BF", featured: true,
    groups: ["method", ...FRANKLIN_VIRTUES],
    links: [SRC.franklin, SRC.franklinBio],
  },
  corley: {
    initials: "TC", featured: true,
    groups: ["corley_morning", "corley_attention", "corley_learning", "corley_money", "corley_consistency"],
    borrowed: [
      { key: "exercise", group: "corley_morning", attribution: "principle", url: SRC.corleyMorning2018 },
      { key: "top_three_priorities", group: "corley_morning", attribution: "principle", url: SRC.corleyPriorities2018, category: "morning" },
      { key: "read_for_learning", group: "corley_morning", attribution: "principle", url: SRC.corleyRoutine2018 },
      { key: "review_spending", group: "corley_money", attribution: "principle", url: SRC.corleyWealthy2017 },
    ],
    links: [SRC.corleySite, SRC.corleyAbout],
  },
  gates: { initials: "BG", featured: true, groups: [], links: [SRC.gatesBio, SRC.gatesReading2016] },
  musk: { initials: "EM", featured: true, groups: [], links: [SRC.muskTed2013, SRC.muskStarbase2021] },
  bezos: {
    initials: "JB", featured: true, groups: [],
    links: [SRC.bezosLetters, SRC.bezosEconClub2018, SRC.bezosAchievement2001],
  },
  history: { initials: "H", featured: false, groups: [], links: [] },
};

/**
 * A template as offered in one place — the everyday shelf, or a collection.
 * The same template can be offered in two places (Corley's collection shows
 * four everyday habits) and is still one template: one key, one ✓.
 */
export interface LibraryEntry {
  item: LibraryHabit;
  collection: CollectionKey | null;
  group: string | null;
  attribution: Attribution | null;
  url: string | null;
  /** The time of day it lands in from here. */
  category: Category;
  /** Dictionary key for this entry's "Why" and source: `corley:exercise` for a borrowed one. */
  ref: string;
}

const homeEntry = (item: LibraryHabit): LibraryEntry => ({
  item, collection: item.collection ?? null, group: item.group ?? null,
  attribution: item.attribution ?? null, url: item.url ?? null, category: item.category, ref: item.key,
});

/** The everyday shelf. */
export const EVERYDAY: LibraryEntry[] = LIBRARY.filter((i) => !i.collection).map(homeEntry);

/** A collection's entries in display order: by group, borrowed habits first within one. */
export function collectionEntries(c: CollectionKey): LibraryEntry[] {
  const info = COLLECTION_INFO[c];
  const borrowed = (info.borrowed ?? []).map((b): LibraryEntry => {
    const item = libraryByKey.get(b.key)!;
    return {
      item, collection: c, group: b.group, attribution: b.attribution, url: b.url,
      category: b.category ?? item.category, ref: `${c}:${b.key}`,
    };
  });
  const own = LIBRARY.filter((i) => i.collection === c).map(homeEntry);
  if (!info.groups.length) return [...borrowed, ...own];
  return info.groups.flatMap((g) => [...borrowed, ...own].filter((e) => e.group === g));
}

/** Every template once, for searching and filtering — a collection's entry wins over the everyday one. */
export function allEntries(): LibraryEntry[] {
  const seen = new Set<string>();
  const out: LibraryEntry[] = [];
  for (const e of [...COLLECTIONS.flatMap(collectionEntries), ...EVERYDAY]) {
    if (seen.has(e.item.key)) continue;
    seen.add(e.item.key);
    out.push(e);
  }
  return out;
}

/** The goal filters (refinement 6): five plain areas, from each template's life domain. */
export const GOAL_FILTERS = ["learning", "finance", "health", "productivity", "growth"] as const;
export type GoalFilter = (typeof GOAL_FILTERS)[number];
const GOAL_OF: Record<LibraryHabit["lifeDomain"], GoalFilter> = {
  learning: "learning", money: "finance", health: "health", career: "productivity",
  home: "growth", relationships: "growth",
};
export const goalOf = (item: LibraryHabit): GoalFilter => GOAL_OF[item.lifeDomain];

/** Matching is on the words the reader sees — name, description, collection and person — so it works in either language. */
export function entryMatches(e: LibraryEntry, needle: string, t: Dict): boolean {
  if (!needle) return true;
  const text = t.templates.collections as Record<string, { title: string; person: string }>;
  const c = e.collection ? text[e.collection] : null;
  return [t.templates.habits[e.item.key], t.templates.descriptions[e.item.key], c?.title, c?.person]
    .some((s) => s?.toLowerCase().includes(needle));
}

/** "Why this habit?" for an entry, or empty. Franklin's virtues share one: his method. */
export function entryWhy(e: LibraryEntry, t: Dict): string {
  const why = t.templates.why[e.ref];
  if (why) return why;
  return e.collection === "franklin" && e.group && e.item.key === `franklin_${e.group}`
    ? t.templates.why.franklin_virtue ?? "" : "";
}

/** The citation for an entry: its own, or (borrowed) the collection's for it. */
export const entrySource = (e: LibraryEntry, t: Dict): string =>
  t.templates.sources[e.ref] ?? t.templates.sources[e.item.key] ?? "";

/** The schedule a template suggests, complete — HT-2b's defaults fill whatever it leaves out. */
export function suggestedFrequency(item: LibraryHabit, today = todayISO()): Frequency {
  const base: Frequency = {
    mode: item.frequency,
    days: [...(item.days ?? [0, 1, 2, 3, 4, 5, 6])],
    timesPerWeek: item.timesPerWeek ?? 3,
    ...(item.timesPerMonth ? { timesPerMonth: item.timesPerMonth } : {}),
  };
  return frequencyDefaults(base, item.frequency, today);
}

/**
 * A library entry as a habit this account owns — the one definition, used by
 * Add Habit and by Refine. The template's own suggestions all come across:
 * tracking, bounds, unit, weight, and the frequency *it* names (both callers
 * once rebuilt this by hand, each dropping or hard-coding the frequency).
 * `status` is the caller's: "active" from the sheet, "planned" into the
 * backlog — never anything the user did not ask for.
 */
export function habitFromLibrary(
  item: LibraryHabit,
  over: { category?: Category; sortOrder?: number; status?: "active" | "planned" } = {},
): Habit {
  const status = over.status ?? "active";
  return {
    ...blankHabit(),
    name: canonical("habits", item.key),
    description: canonicalDescription(item.key),
    templateKey: item.key,
    category: over.category ?? item.category,
    type: item.kind,
    tracking: item.tracking,
    minimum: item.minimum,
    target: item.target,
    unit: item.unit ?? "",
    weight: item.weight,
    frequency: suggestedFrequency(item),
    sortOrder: over.sortOrder ?? 0,
    status,
    active: status === "active",
    // This week is the first item unless the person chooses otherwise in the editor.
    ...(item.rotation ? { rotation: item.rotation, rotationStart: rotationStartFor(todayISO()) } : {}),
  };
}

/** The keys the starter sheet uses, so the library can mark what is already on it. */
export const libraryFor = (category: Category) =>
  LIBRARY.filter((h) => h.category === category).sort((a, b) => a.key.localeCompare(b.key));
