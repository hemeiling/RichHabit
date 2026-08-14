import { en, type Dict } from "./en";
import { zh } from "./zh";

/**
 * The bilingual dictionary, derived rather than written.
 *
 * Every label carries both languages at once, so a household that reads
 * different ones can share a screen without anybody switching a setting. It is
 * built by walking `en` and `zh` together, which means it can never fall behind
 * them: a new key appears in both halves automatically.
 */

/**
 * How the two halves are joined depends on what they are:
 *
 *   - identical in both (numbers, "—")   → shown once
 *   - both very short (day initials)     → "S/日", because a middot and spaces
 *                                          do not fit a 34px column header
 *   - a finished sentence                → a space, since a middot reads as
 *                                          punctuation mid-paragraph
 *   - everything else (labels, buttons)  → " · ", the separator the rest of the
 *                                          interface already uses
 */
export function joinPair(a: string, b: string): string {
  if (a === b) return a;
  if (a.length <= 2 && b.length <= 2) return `${a}/${b}`;
  if (/[.!?。！？…]$/.test(a.trim())) return `${a} ${b}`;
  return `${a} · ${b}`;
}

function merge(a: unknown, b: unknown): unknown {
  if (typeof a === "string") return joinPair(a, typeof b === "string" ? b : a);

  if (typeof a === "function") {
    const fb = typeof b === "function" ? b : a;
    return (...args: unknown[]) =>
      joinPair(String((a as Function)(...args)), String((fb as Function)(...args)));
  }

  if (Array.isArray(a)) {
    const arrB = Array.isArray(b) ? b : [];
    return a.map((item, i) => merge(item, arrB[i] ?? item));
  }

  if (a && typeof a === "object") {
    const objB = (b ?? {}) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(a as Record<string, unknown>).map(([k, v]) => [k, merge(v, objB[k])]),
    );
  }

  return a;
}

export const both = merge(en, zh) as Dict;
