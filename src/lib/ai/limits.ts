/**
 * Per-user limits on AI suggestion requests: cost and abuse protection.
 *
 * Approved for V1: 10 requests an hour and 30 a day per user, and one request
 * in flight at a time. A request counts when it is accepted for processing,
 * whether or not the provider then succeeds, because that is when the cost is
 * incurred.
 *
 * In memory, like sign-in throttling: it resets on deploy and is not shared
 * between instances. That is noted rather than pretended otherwise; RichHabit
 * runs as a single instance today.
 *
 * These limit how often suggestions can be requested. They never limit how many
 * habits or priorities somebody may create or link.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const history = new Map<string, number[]>();
const inFlight = new Set<string>();

export type AiRefusal = "busy" | "hour" | "day";

export function takeAiRequest(
  userId: string, limits: { hourly: number; daily: number }, now = Date.now(),
): { ok: true } | { ok: false; reason: AiRefusal } {
  if (inFlight.has(userId)) return { ok: false, reason: "busy" };

  const recent = (history.get(userId) ?? []).filter((at) => now - at < DAY);
  if (recent.filter((at) => now - at < HOUR).length >= limits.hourly) {
    history.set(userId, recent);
    return { ok: false, reason: "hour" };
  }
  if (recent.length >= limits.daily) {
    history.set(userId, recent);
    return { ok: false, reason: "day" };
  }

  recent.push(now);
  history.set(userId, recent);
  inFlight.add(userId);

  // Opportunistic sweep so the map cannot grow without bound.
  if (history.size > 5_000) {
    for (const [key, times] of history) if (!times.some((at) => now - at < DAY)) history.delete(key);
  }
  return { ok: true };
}

export function finishAiRequest(userId: string) {
  inFlight.delete(userId);
}

/** Test seam. */
export function resetAiLimits() {
  history.clear();
  inFlight.clear();
}
