import { capacity } from "@/lib/env";
import { query, transaction } from "@/lib/db/pool";

/**
 * How many places are left in the free early-access programme.
 *
 * One definition of "counts towards the limit", used by the sign-up route, by
 * re-enabling an account, and by the admin dashboard — so the number the owner
 * reads and the number the door enforces cannot disagree.
 *
 * Admins are exempt, by decision: the cap is on people using RichHabit, and the
 * person running it should not have to spend one of the fifty to administer it.
 *
 * Verification is structured but inert. There is no mail provider in this
 * application, so `requireEmailVerification` is off and an account counts from
 * creation. Turning it on later makes a slot depend on `email_verified_at`
 * without any other part of the account model changing — and username-only
 * accounts, which have no address to verify, are exempt so they cannot be
 * stranded by a flag.
 */

/** The SQL predicate for "this account occupies a place". */
export const OCCUPIES_A_SLOT = `
  disabled_at is null
  and role <> 'admin'
  ${capacity.requireEmailVerification
    ? "and (email is null or email_verified_at is not null)" : ""}
`;

export interface Capacity {
  /** Active, non-admin accounts. */
  used: number;
  /** 0 means unlimited. */
  limit: number;
  remaining: number;
  full: boolean;
}

function summarise(used: number): Capacity {
  const limit = capacity.limit;
  if (limit <= 0) return { used, limit: 0, remaining: Infinity, full: false };
  return { used, limit, remaining: Math.max(0, limit - used), full: used >= limit };
}

export async function currentCapacity(): Promise<Capacity> {
  const rows = await query<{ n: string }>(
    `select count(*) as n from users where ${OCCUPIES_A_SLOT}`);
  return summarise(Number(rows[0].n));
}

/**
 * A key for `pg_advisory_xact_lock`, so every writer that could change the
 * count queues behind the same lock. Arbitrary, and constant.
 */
const CAPACITY_LOCK = 8_243_119;

/**
 * Runs `fn` with a place reserved, or returns null if the programme is full.
 *
 * The count and the write happen inside one transaction holding an advisory
 * lock, which is what makes two simultaneous sign-ups at 49 impossible to
 * resolve as 51: the second waits for the first to commit, then counts again
 * and sees 50.
 *
 * `pg_advisory_xact_lock` rather than the session-scoped variant on purpose —
 * it is released at commit, which is the only kind that survives a connection
 * pooler in transaction mode, and production connects through one.
 */
export async function withReservedSlot<T>(
  fn: (q: typeof query) => Promise<T>,
): Promise<T | null> {
  return transaction(async (q) => {
    if (capacity.limit > 0) {
      await q("select pg_advisory_xact_lock($1)", [CAPACITY_LOCK]);
      const rows = await q<{ n: string }>(
        `select count(*) as n from users where ${OCCUPIES_A_SLOT}`);
      if (Number(rows[0].n) >= capacity.limit) return null;
    }
    return fn(q);
  });
}

/**
 * Whether one more account may be turned back on. Same lock, so a re-enable
 * cannot race a sign-up into overshooting the limit either.
 */
export async function withCapacityFor<T>(
  count: number, fn: (q: typeof query) => Promise<T>,
): Promise<T | null> {
  return transaction(async (q) => {
    if (capacity.limit > 0 && count > 0) {
      await q("select pg_advisory_xact_lock($1)", [CAPACITY_LOCK]);
      const rows = await q<{ n: string }>(
        `select count(*) as n from users where ${OCCUPIES_A_SLOT}`);
      if (Number(rows[0].n) + count > capacity.limit) return null;
    }
    return fn(q);
  });
}
