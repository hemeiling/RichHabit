import { capacity } from "@/lib/env";
import { query, transaction } from "@/lib/db/pool";

/**
 * How many places are left in the free early-access programme.
 *
 * One definition of "counts towards the limit", used by the sign-up route, by
 * email verification, by re-enabling an account, and by the admin dashboard —
 * so the number the owner reads and the number the door enforces cannot
 * disagree.
 *
 * Admins are exempt, by decision: the cap is on people using RichHabit, and the
 * person running it should not have to spend one of the fifty to administer it.
 *
 * An account that has not yet proved its address takes no place. It is a
 * reservation of a username and an email, nothing more. Verifying is what
 * consumes the place — see `withCapacityLock`, which is how a verification and
 * a registration racing for the last one cannot both win.
 */

/**
 * The SQL predicate for "this account occupies a place".
 *
 * Note what it does *not* read: the `REQUIRE_EMAIL_VERIFICATION` environment
 * variable. Whether an account had to verify is stamped on the account itself
 * at the moment it is created, so this string is a constant. That is what makes
 * grandfathering hold — every account that existed before verification was
 * introduced has `verification_required = false` and keeps its place — and it
 * means switching the flag off and on again cannot change who is counted.
 */
export const OCCUPIES_A_SLOT = `
  disabled_at is null
  and role <> 'admin'
  and (not verification_required or email_verified_at is not null)
`;

/** Registered, still unverified, taking no place. */
export const AWAITING_VERIFICATION = `
  disabled_at is null
  and role <> 'admin'
  and verification_required
  and email_verified_at is null
`;

export interface Capacity {
  /** Active, non-admin accounts. */
  used: number;
  /** Registered but unverified. These take no place until they verify. */
  pending: number;
  /** 0 means unlimited. */
  limit: number;
  remaining: number;
  full: boolean;
}

function summarise(used: number, pending: number): Capacity {
  const limit = capacity.limit;
  if (limit <= 0) return { used, pending, limit: 0, remaining: Infinity, full: false };
  return {
    used, pending, limit,
    remaining: Math.max(0, limit - used),
    full: used >= limit,
  };
}

export async function currentCapacity(): Promise<Capacity> {
  const rows = await query<{ used: string; pending: string }>(
    `select count(*) filter (where ${OCCUPIES_A_SLOT}) as used,
            count(*) filter (where ${AWAITING_VERIFICATION}) as pending
       from users`);
  return summarise(Number(rows[0].used), Number(rows[0].pending));
}

/**
 * A key for `pg_advisory_xact_lock`, so every writer that could change the
 * count queues behind the same lock. Arbitrary, and constant.
 */
const CAPACITY_LOCK = 8_243_119;

/**
 * Runs `fn` inside a transaction holding the capacity lock, taken up front
 * rather than lazily.
 *
 * Role changes need it for a reason ordinary capacity checks do not: demoting
 * an admin has to count the remaining admins and write the new role as one
 * indivisible step. Counting first and writing after is a race — two admins
 * demoted at the same moment each see "one other admin remains", both proceed,
 * and the system is left with none.
 *
 * It reuses the capacity lock rather than adding a second one. Demotion
 * genuinely touches both concerns, since an admin who becomes a user starts
 * occupying one of the fifty places, and two locks acquired in different
 * orders by different callers is how deadlocks are made. At this scale the
 * extra serialisation costs nothing.
 */
export async function withRoleLock<T>(
  fn: (q: typeof query, roomFor: (n: number) => Promise<boolean>) => Promise<T>,
): Promise<T> {
  return transaction(async (q) => {
    await q("select pg_advisory_xact_lock($1)", [CAPACITY_LOCK]);
    const roomFor = async (n: number) => {
      if (capacity.limit <= 0 || n <= 0) return true;
      const rows = await q<{ n: string }>(
        `select count(*) as n from users where ${OCCUPIES_A_SLOT}`);
      return Number(rows[0].n) + n <= capacity.limit;
    };
    return fn(q, roomFor);
  });
}

/**
 * Runs `fn` inside one transaction holding the capacity lock, handing it a way
 * to ask whether there is room for `n` more.
 *
 * This is the primitive the other two are built from, and the reason there is
 * only one: a sign-up, a verification and a re-enable all queue behind the same
 * lock, count with the same predicate, and commit before the next one counts.
 * Two of any of them arriving at the last free place is resolved by the
 * database, not by whichever handler happened to read first.
 *
 * `pg_advisory_xact_lock` rather than the session-scoped variant on purpose —
 * it is released at commit, which is the only kind that survives a connection
 * pooler in transaction mode, and production connects through one.
 */
export async function withCapacityLock<T>(
  fn: (q: typeof query, roomFor: (n: number) => Promise<boolean>) => Promise<T>,
): Promise<T> {
  return transaction(async (q) => {
    let locked = false;
    const roomFor = async (n: number) => {
      if (capacity.limit <= 0 || n <= 0) return true;
      // Taken lazily, and once: a caller that never asks about room never
      // serialises with anything.
      if (!locked) {
        await q("select pg_advisory_xact_lock($1)", [CAPACITY_LOCK]);
        locked = true;
      }
      const rows = await q<{ n: string }>(
        `select count(*) as n from users where ${OCCUPIES_A_SLOT}`);
      return Number(rows[0].n) + n <= capacity.limit;
    };
    return fn(q, roomFor);
  });
}

/**
 * Runs `fn` with a place reserved, or returns null if the programme is full.
 *
 * The count and the write happen inside one transaction holding the lock, which
 * is what makes two simultaneous sign-ups at 49 impossible to resolve as 51:
 * the second waits for the first to commit, then counts again and sees 50.
 */
export async function withReservedSlot<T>(
  fn: (q: typeof query) => Promise<T>,
): Promise<T | null> {
  return withCapacityLock(async (q, roomFor) =>
    (await roomFor(1)) ? fn(q) : null);
}

/**
 * Whether `count` more accounts may be turned back on. Same lock, so a
 * re-enable cannot race a sign-up into overshooting the limit either.
 */
export async function withCapacityFor<T>(
  count: number, fn: (q: typeof query) => Promise<T>,
): Promise<T | null> {
  return withCapacityLock(async (q, roomFor) =>
    (await roomFor(count)) ? fn(q) : null);
}
