import { uid } from "@/lib/habits";
import type { Intention, IntentionOwnership } from "@/lib/types";

/**
 * Clarify Your Intention — every rule about the session, in one place and free
 * of React, so the screen is a rendering of these decisions rather than the
 * place they are made.
 *
 * The shape of the session is five steps: what you want, why it matters,
 * whether it is really yours, what it would look like, and what you will
 * actually do. Nothing here interprets, scores or grades an answer. The
 * functions only ever say how far the session has been taken and what may be
 * revealed next; what the person wrote is carried through untouched.
 */

export const INTENTION_STEPS = ["what", "why", "truth", "vision", "action"] as const;
export type IntentionStep = (typeof INTENTION_STEPS)[number];
export const STEP_COUNT = INTENTION_STEPS.length;

/**
 * How deep the Why may go.
 *
 * Three, not five. The first answer is usually the goal restated, the second is
 * usually the real reason, and the third is where it either becomes a value or
 * starts going in circles. A fourth box is an interrogation, and the point is
 * to help someone notice their own motive rather than to extract one.
 */
export const MAX_WHY = 3;

/** §8. The Vision prompts, revealed one at a time and each skippable. */
export const VISION_PROMPTS = ["different", "doing", "day", "feeling"] as const;
export type VisionPrompt = (typeof VISION_PROMPTS)[number];

/** How many habits one intention may start. The product's number, not a limit
 *  of the habit system: three is what somebody can actually begin at once. */
export const MAX_INTENTION_HABITS = 3;

export const OWNERSHIP_CHOICES: IntentionOwnership[] = ["mine", "outside", "unsure"];

/** Lengths, so the field, the validator and the column agree on one number. */
export const MAX_WANT = 2000;
export const MAX_WHY_TEXT = 2000;
export const MAX_NOTE = 2000;
export const MAX_VISION_TEXT = 2000;

export const blankIntention = (): Intention => ({
  id: uid(),
  want: "",
  // One rung, open and empty. The ladder always has a first question.
  whyChain: [""],
  ownership: null,
  ownershipNote: "",
  vision: [""],
  habitIds: [],
  priorityId: null,
  step: 1,
  complete: false,
});

const filled = (s: string | undefined) => (s ?? "").trim().length > 0;

/** How many rungs of the ladder have something written on them. */
export const whyDepth = (i: Intention): number =>
  i.whyChain.filter(filled).length;

/**
 * The deepest thing they said, which is what the card shows as "why it
 * matters". The last rung with words on it rather than the last rung, so
 * opening a level and leaving it blank does not empty the card.
 */
export function deepestWhy(i: Intention): string {
  for (let at = i.whyChain.length - 1; at >= 0; at -= 1) {
    if (filled(i.whyChain[at])) return i.whyChain[at].trim();
  }
  return "";
}

/**
 * Whether another Why may be opened: the current deepest rung has to have been
 * answered, and the ladder has to be short of its limit. Going deeper is
 * offered, never imposed — `canContinue` does not require it.
 */
export function canGoDeeper(i: Intention): boolean {
  if (i.whyChain.length >= MAX_WHY) return false;
  return filled(i.whyChain[i.whyChain.length - 1]);
}

/** Opens the next rung. A no-op when the step above says it is not available. */
export function goDeeper(i: Intention): Intention {
  return canGoDeeper(i) ? { ...i, whyChain: [...i.whyChain, ""] } : i;
}

/** Writes one rung, leaving every other rung and every other field alone. */
export function setWhy(i: Intention, at: number, text: string): Intention {
  if (at < 0 || at >= i.whyChain.length) return i;
  const whyChain = [...i.whyChain];
  whyChain[at] = text;
  return { ...i, whyChain };
}

/** Which Vision prompt a given answer slot belongs to. */
export const visionPromptAt = (at: number): VisionPrompt =>
  VISION_PROMPTS[Math.min(at, VISION_PROMPTS.length - 1)];

export function canRevealVision(i: Intention): boolean {
  if (i.vision.length >= VISION_PROMPTS.length) return false;
  return filled(i.vision[i.vision.length - 1]);
}

export function revealVision(i: Intention): Intention {
  return canRevealVision(i) ? { ...i, vision: [...i.vision, ""] } : i;
}

export function setVision(i: Intention, at: number, text: string): Intention {
  if (at < 0 || at >= i.vision.length) return i;
  const vision = [...i.vision];
  vision[at] = text;
  return { ...i, vision };
}

/**
 * Whether the session may move on from a step.
 *
 * Deliberately generous. Only the two steps that the rest of the session is
 * built from are required: something wanted, and one reason it matters. Truth
 * asks for a choice because the step is the choice. Vision is entirely optional
 * — somebody who cannot picture it yet is exactly the person this step is for,
 * and refusing to let them past would be the app telling them they reflected
 * wrongly. Action has nothing to require: creating a habit or a priority is an
 * offer, and finishing without taking it is a legitimate outcome.
 */
export function canContinue(i: Intention, step: number): boolean {
  switch (step) {
    case 1: return filled(i.want);
    case 2: return filled(i.whyChain[0]);
    case 3: return i.ownership !== null;
    default: return true;
  }
}

/**
 * Where resuming lands: the furthest step reached, pulled back to the first
 * step that is not yet satisfied.
 *
 * The pull-back is what makes a half-finished session honest. Somebody who got
 * to Vision and then cleared what they wanted should not be looking at Vision;
 * the session cannot be about an intention that is no longer there.
 */
export function resumeStep(i: Intention): number {
  const furthest = Math.min(Math.max(Math.round(i.step) || 1, 1), STEP_COUNT);
  for (let step = 1; step < furthest; step += 1) {
    if (!canContinue(i, step)) return step;
  }
  return furthest;
}

/** Advancing. `step` only ever records the furthest point, so going back and
 *  forward again does not lose where the session had got to. */
export function advance(i: Intention, to: number): Intention {
  const next = Math.min(Math.max(to, 1), STEP_COUNT);
  return { ...i, step: Math.max(i.step, next) };
}

/** Recording that the session was finished. Nothing is cleared or locked. */
export const finish = (i: Intention): Intention =>
  ({ ...i, step: STEP_COUNT, complete: true });

/**
 * What is worth writing: trailing rungs and prompts nobody answered are
 * dropped, so reopening the session offers one empty box rather than however
 * many were revealed and abandoned. An entirely empty ladder keeps one rung,
 * because the ladder always has a first question.
 */
function trimTrailing(list: string[]): string[] {
  const out = [...list];
  while (out.length > 1 && !filled(out[out.length - 1])) out.pop();
  return out;
}

export function trimIntention(i: Intention): Intention {
  return {
    ...i,
    whyChain: trimTrailing(i.whyChain),
    vision: trimTrailing(i.vision),
  };
}

/**
 * Whether anything has been written at all. A session opened and abandoned
 * without a word is not worth a row, which is what keeps a stray visit to the
 * page from creating an intention nobody meant to start.
 */
export function isBlank(i: Intention): boolean {
  return !filled(i.want)
    && !i.whyChain.some(filled)
    && !i.vision.some(filled)
    && i.ownership === null
    && !filled(i.ownershipNote)
    && i.habitIds.length === 0
    && i.priorityId === null;
}

/**
 * The habits this intention started, as they are now.
 *
 * Resolved against whatever habits the account currently has, in the order the
 * intention recorded them. A habit that has since been deleted is simply not
 * found and not shown: the id is a reference, never a claim that the record
 * still exists, and nothing here writes anything back.
 */
export function linkedHabits<T extends { id: string }>(i: Intention, habits: T[]): T[] {
  const byId = new Map(habits.map((h) => [h.id, h]));
  return i.habitIds.map((id) => byId.get(id)).filter((h): h is T => Boolean(h));
}

export function linkedPriority<T extends { id: string }>(
  i: Intention, priorities: T[],
): T | null {
  if (!i.priorityId) return null;
  return priorities.find((p) => p.id === i.priorityId) ?? null;
}

/** Whether another habit may be started from this intention. */
export const canAddHabit = (i: Intention): boolean =>
  i.habitIds.length < MAX_INTENTION_HABITS;
