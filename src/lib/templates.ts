import { dictionaries } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n";
import { ROTATION_TEMPLATE, isRotation, rotationItemOn } from "@/lib/rotation";
import type { Frequency, Goal, Habit } from "@/lib/types";

/**
 * Resolving what a habit or goal is *called*.
 *
 * Seeded content is stored as a `template_key`, not as text, so it follows the
 * language the reader chose. Anything the user typed is stored as text and is
 * never translated — a habit called "Practice violin" stays "Practice violin"
 * in every language.
 *
 * The rule is one line: **a key means ours, no key means theirs.**
 */

export const habitName = (h: Pick<Habit, "templateKey" | "name">, t: Dict): string =>
  (h.templateKey && t.templates.habits[h.templateKey]) || h.name;

export const goalName = (g: Pick<Goal, "templateKey" | "name">, t: Dict): string =>
  (g.templateKey && t.templates.goals[g.templateKey]) || g.name;

/**
 * What a habit is called on a particular day. A rotating habit is named by
 * that day's item ("Virtue of the week: Order"); everything else by
 * `habitName`. Use it wherever a habit is shown against a date.
 */
export function habitNameOn(h: Pick<Habit, "templateKey" | "name" | "rotation" | "rotationStart">,
  t: Dict, date: string): string {
  if (h.rotation && h.rotationStart) {
    return t.habits.virtueOfWeek(rotationItemOn(h.rotation, h.rotationStart, date).key);
  }
  return habitName(h, t);
}

/** "This week: Order · week 3 of 13", for a rotating habit; null otherwise. */
export function rotationLabel(h: Pick<Habit, "rotation" | "rotationStart">, t: Dict, date: string): string | null {
  if (!h.rotation || !h.rotationStart) return null;
  const { key, index, length } = rotationItemOn(h.rotation, h.rotationStart, date);
  return t.habits.rotationThisWeek(key, index + 1, length);
}

/** This day's item's own words (Franklin's precept), for a rotating habit; null otherwise. */
export function rotationPrecept(h: Pick<Habit, "rotation" | "rotationStart">, t: Dict, date: string): string | null {
  if (!h.rotation || !h.rotationStart) return null;
  return t.templates.descriptions[rotationItemOn(h.rotation, h.rotationStart, date).key] ?? null;
}

/** How a habit repeats, in a few words: "Every day", "M W F", "Every 3 days"… */
export function frequencyLabel(f: Frequency, t: Dict): string {
  switch (f.mode) {
    case "daily": return t.habits.freqDaily;
    case "days": return f.days.map((d) => t.days.initial[d]).join(" ");
    case "every_n_days": return t.habits.everyNDays(f.intervalDays ?? 2);
    case "month_times": return t.habits.timesAMonth(f.timesPerMonth ?? 1);
    case "month_days": return t.habits.onMonthDays(f.daysOfMonth ?? []);
    default: return t.habits.timesAWeek(f.timesPerWeek);
  }
}

/**
 * Wording a template used to have. A copy adopted under the old wording is
 * still the template's own — it keeps its key and keeps following the reader's
 * language — so correcting a template's text never strands anyone's copy in
 * the language it was added in. Add the old text here whenever a template's
 * name or description changes.
 */
const RETIRED_WORDING: { habits: Record<string, string[]>; descriptions: Record<string, string[]> } = {
  habits: {
    // Chinese virtue names before the Template Library (2026-10).
    franklin_silence: ["慎言"], franklin_resolution: ["决断"], franklin_industry: ["勤勉"],
    franklin_justice: ["正直"], franklin_cleanliness: ["清洁"], franklin_chastity: ["自律"],
  },
  descriptions: {
    // "Opened each day at five" overstated his plan as a daily habit.
    franklin_morning_question: [
      "Franklin opened each day with this question at five in the morning, then planned the day's business.",
      "富兰克林每天清晨五点以这个问题开始一天，然后规划当日事务。",
    ],
    // Paraphrased away Franklin's meaning; the precept itself is quoted now.
    franklin_chastity: [
      "Self-discipline and respect in intimate life — kept private, like the rest of this sheet.",
      "亲密关系中的自律与尊重——与这份清单的其他内容一样，完全私密。",
    ],
    // Punctuation of the Pine edition; the text now follows the cited Harvard Classics one.
    franklin_sincerity: [
      "“Use no hurtful deceit; think innocently and justly; and, if you speak, speak accordingly.” — Franklin's precept",
    ],
    // His words begin "And for me" — the quote now shows where it starts.
    bezos_sleep_eight: [
      "“For me, I need eight hours of sleep” — planned for, not left to chance.",
      "“对我来说，我需要八小时睡眠”——提前安排，而不是碰运气。",
    ],
  },
};

/**
 * Units on a seeded habit are ours too ("min" → 分钟). A unit the user typed is
 * left alone, which is why this only translates when a template key is present.
 */
export const habitUnit = (h: Pick<Habit, "templateKey" | "unit">, t: Dict): string =>
  (h.templateKey && h.unit && t.templates.units[h.unit]) || h.unit;

/**
 * Descriptions follow the same one-line rule as names: ours while untouched,
 * theirs the moment they edit it. A template's description is stored in
 * English (like the name); while the stored text is still the template's own
 * wording in some language, the reader sees it in their language.
 */
export const habitDescription = (
  h: Pick<Habit, "templateKey" | "description">, t: Dict,
): string => {
  if (!h.templateKey || !h.description) return h.description;
  const own = t.templates.descriptions[h.templateKey];
  if (!own) return h.description;
  const aliases = [
    ...Object.values(dictionaries).map((d) => d.templates.descriptions[h.templateKey!]).filter(Boolean),
    ...(RETIRED_WORDING.descriptions[h.templateKey] ?? []),
  ];
  return aliases.includes(h.description.trim()) ? own : h.description;
};

/** A historical template's citation, or empty for everything else. */
export const habitSource = (key: string | null, t: Dict): string =>
  (key && t.templates.sources[key]) || "";

/** The canonical (English) description stored when a template is adopted. */
export const canonicalDescription = (key: string): string =>
  dictionaries.en.templates.descriptions[key] ?? "";

/**
 * Every name a template has ever had, in every language.
 *
 * Two uses. The editor needs to know whether the name it is about to save is
 * still the template's own wording or something the user typed over it; and the
 * migration needs to recognise rows seeded before keys existed, which may hold
 * English, Chinese, or the bilingual "Read for learning · 阅读学习" form.
 */
export function templateAliases(kind: "habits" | "goals", key: string): string[] {
  const out = new Set<string>();
  for (const dict of Object.values(dictionaries)) {
    const value = dict.templates[kind][key];
    if (value) out.add(value);
  }
  if (kind === "habits") for (const old of RETIRED_WORDING.habits[key] ?? []) out.add(old);
  return [...out];
}

/** True when `name` is still the template's wording in some language. */
export const isTemplateWording = (kind: "habits" | "goals", key: string, name: string): boolean =>
  templateAliases(kind, key).includes(name.trim());

/**
 * A rotating habit's template link, when its row has lost it but its name is
 * still that template's own wording (in any language).
 *
 * A build that does not know the template — the one before HT-2c, after a
 * rollback — drops the key on its next save of the habit. Its rotation
 * survives (that build never touches those columns), so the link is derived
 * back from the rotation on load: nothing is written on read, and the next
 * ordinary save stores it again. A habit the person renamed keeps their name,
 * by the same rule as every template.
 */
export function linkedRotationTemplate(rotation: unknown, name: string): string | null {
  if (!isRotation(rotation)) return null;
  const key = ROTATION_TEMPLATE[rotation];
  return isTemplateWording("habits", key, name) ? key : null;
}

/**
 * The canonical stored value for a template — English, so a row is readable in
 * `psql` and so anything that bypasses this module degrades to English rather
 * than to a key like `read_for_learning`.
 */
export const canonical = (kind: "habits" | "goals", key: string): string =>
  dictionaries.en.templates[kind][key] ?? key;
