import { countRepliesSince } from "@/lib/aiWorkspace/queries";
import { aiWorkspace } from "@/lib/env";

/**
 * Spend guardrails for the AI Workspace.
 *
 * Hourly and daily limits are counted from the stored replies, so a restart or
 * a deploy does not reset them. Every reply the model is asked for counts —
 * replies, continuations and retries alike, and whether or not it finished —
 * because each one is a request that costs.
 *
 * One reply at a time per admin is held twice: in the database (Phase 1 refuses
 * a new reply while one is streaming) and here, synchronously, before any
 * database work starts. The second closes the gap where two requests for the
 * same admin check the database at the same moment. RichHabit runs as a single
 * instance, which is what makes an in-process reservation sufficient.
 */

const HOUR_MS = 60 * 60 * 1000;

export type AllowanceRefusal = "busy" | "hour" | "day";

export interface ReplySlot {
  readonly userId: string;
  messageId: string | null;
  readonly controller: AbortController;
}

declare global {
  // eslint-disable-next-line no-var
  var __aiWorkspaceSlots: Map<string, ReplySlot> | undefined;
}

const slots = (): Map<string, ReplySlot> => (globalThis.__aiWorkspaceSlots ??= new Map());

/** Claims the admin's single reply slot, or null when a reply is already running. */
export function reserveReply(userId: string): ReplySlot | null {
  if (slots().has(userId)) return null;
  const slot: ReplySlot = { userId, messageId: null, controller: new AbortController() };
  slots().set(userId, slot);
  return slot;
}

export function releaseReply(slot: ReplySlot) {
  if (slots().get(slot.userId) === slot) slots().delete(slot.userId);
}

/** Whether this process is writing the given reply right now. */
export function isReplyRunning(userId: string, messageId: string): boolean {
  return slots().get(userId)?.messageId === messageId;
}

/** Stops the admin's running reply if it is this one. */
export function stopRunningReply(userId: string, messageId: string): boolean {
  const slot = slots().get(userId);
  if (!slot || slot.messageId !== messageId) return false;
  slot.controller.abort();
  return true;
}

/** Test seam. */
export function resetReplySlots() {
  slots().clear();
}

export async function hourlyAndDailyAllowance(userId: string, now = Date.now()): Promise<"hour" | "day" | null> {
  if (await countRepliesSince(userId, new Date(now - HOUR_MS)) >= aiWorkspace.hourlyLimit) return "hour";
  if (await countRepliesSince(userId, new Date(now - 24 * HOUR_MS)) >= aiWorkspace.dailyLimit) return "day";
  return null;
}
