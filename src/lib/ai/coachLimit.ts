import { query, transaction } from "@/lib/db/pool";
import { coach as coachEnv } from "@/lib/env";

/**
 * The AI coach's safety limit.
 *
 * **This is a platform cost guard, not a plan entitlement.** It applies to
 * everyone — Free, Pro and admin alike — because its job is to stop one account
 * from running up an unbounded provider bill, not to sell anything. The Free/Pro
 * AI allowance is a separate, later decision that will sit in front of this
 * rather than replace it.
 *
 * Three properties the previous in-memory limiter did not have.
 *
 * **Durable.** The count lives in `coach_requests`, so a deploy does not hand
 * everybody a fresh allowance. `lib/ai/limits.ts` keeps its Map for intention
 * suggestions; this deliberately does not reuse it.
 *
 * **Shared between instances.** Two instances counting the same rows agree;
 * two instances holding their own Maps do not.
 *
 * **Charged before the model runs.** The row is written *before* the provider
 * call, so a timeout, a provider error or an abandoned request still consumes
 * allowance. Failing closed is the point: those requests cost money too, which
 * is also why the existing `coach_question_asked` analytics event — written
 * only on success, and best-effort — cannot be the counter.
 *
 * Serialised per account with an advisory lock, so a burst of parallel requests
 * cannot all read "under the limit" at once and pass together. Different
 * accounts hash to different keys and never wait on each other.
 */

/** Namespace for the per-user advisory lock. Arbitrary, and constant. */
const COACH_LOCK = 8_243_121;

/** How long a request stays on file. Far past any window it is counted in. */
const RETAIN_DAYS = 30;

export type CoachRefusal = "hour" | "day";
export type CoachAllowance =
  | { ok: true; hour: number; day: number }
  | { ok: false; reason: CoachRefusal; hour: number; day: number };

/**
 * Records one coach request and says whether it was within the allowance.
 *
 * Counting and recording happen in one transaction holding this account's lock,
 * so the answer cannot be stale by the time the row is written. A refusal
 * writes nothing: a request that never reached the provider costs nothing and
 * should not consume the allowance that protects the provider.
 */
export async function takeCoachRequest(
  userId: string,
  limits: { hourly: number; daily: number } = {
    hourly: coachEnv.hourlyLimit, daily: coachEnv.dailyLimit,
  },
): Promise<CoachAllowance> {
  return transaction(async (q) => {
    await q("select pg_advisory_xact_lock($1, hashtext($2))", [COACH_LOCK, userId]);

    const rows = await q<{ hour: number; day: number }>(
      `select
         count(*) filter (where occurred_at > now() - interval '1 hour')::int  as hour,
         count(*) filter (where occurred_at > now() - interval '24 hours')::int as day
         from coach_requests
        where user_id = $1 and occurred_at > now() - interval '24 hours'`,
      [userId],
    );
    const { hour, day } = rows[0] ?? { hour: 0, day: 0 };

    if (limits.hourly > 0 && hour >= limits.hourly) return { ok: false, reason: "hour", hour, day };
    if (limits.daily > 0 && day >= limits.daily) return { ok: false, reason: "day", hour, day };

    await q("insert into coach_requests (user_id) values ($1)", [userId]);

    /* Kept to this account and bounded by its own index, so the table cannot
       grow without limit and no global sweep is ever needed. */
    await q(
      `delete from coach_requests
        where user_id = $1 and occurred_at < now() - ($2 || ' days')::interval`,
      [userId, String(RETAIN_DAYS)],
    );

    return { ok: true, hour: hour + 1, day: day + 1 };
  });
}

/** What this account has used, for tests and for a future admin view. */
export async function coachUsage(userId: string): Promise<{ hour: number; day: number }> {
  const rows = await query<{ hour: number; day: number }>(
    `select
       count(*) filter (where occurred_at > now() - interval '1 hour')::int  as hour,
       count(*) filter (where occurred_at > now() - interval '24 hours')::int as day
       from coach_requests
      where user_id = $1 and occurred_at > now() - interval '24 hours'`,
    [userId],
  );
  return rows[0] ?? { hour: 0, day: 0 };
}
