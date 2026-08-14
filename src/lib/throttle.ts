/**
 * Failed sign-ins per email+IP, in memory. Enough to make online password
 * guessing impractical on a single instance. It resets on deploy and is not
 * shared between instances, so a serious deployment wants this in Postgres or
 * Redis — noted rather than pretended otherwise.
 */

import { auth } from "@/lib/env";

const attempts = new Map<string, { count: number; first: number }>();

export const WINDOW_MS = auth.attemptWindowMinutes * 60 * 1000;
export const MAX_ATTEMPTS = auth.maxAttempts;

/** True while the key is still under its limit. */
export function throttle(key: string, now = Date.now()): boolean {
  const seen = attempts.get(key);
  if (!seen || now - seen.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return true;
  }
  seen.count += 1;
  // Opportunistic sweep so the map cannot grow without bound.
  if (attempts.size > 5_000) {
    for (const [k, v] of attempts) if (now - v.first > WINDOW_MS) attempts.delete(k);
  }
  return seen.count <= MAX_ATTEMPTS;
}

export function clearThrottle(key: string) {
  attempts.delete(key);
}

/** Test seam. */
export function resetThrottle() {
  attempts.clear();
}
