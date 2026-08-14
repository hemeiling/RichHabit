import { dictionaries } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n";
import type { Goal, Habit } from "@/lib/types";

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
 * Units on a seeded habit are ours too ("min" → 分钟). A unit the user typed is
 * left alone, which is why this only translates when a template key is present.
 */
export const habitUnit = (h: Pick<Habit, "templateKey" | "unit">, t: Dict): string =>
  (h.templateKey && h.unit && t.templates.units[h.unit]) || h.unit;

export const habitDescription = (h: Pick<Habit, "description">): string => h.description;

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
  return [...out];
}

/** True when `name` is still the template's wording in some language. */
export const isTemplateWording = (kind: "habits" | "goals", key: string, name: string): boolean =>
  templateAliases(kind, key).includes(name.trim());

/**
 * The canonical stored value for a template — English, so a row is readable in
 * `psql` and so anything that bypasses this module degrades to English rather
 * than to a key like `read_for_learning`.
 */
export const canonical = (kind: "habits" | "goals", key: string): string =>
  dictionaries.en.templates[kind][key] ?? key;
