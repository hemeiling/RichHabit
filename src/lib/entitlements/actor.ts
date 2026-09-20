import { query } from "@/lib/db/pool";
import { effectivePlan, type Actor, type PlanSource } from "./index";

/**
 * Who is asking, read from the database.
 *
 * Server-only, and the only function that reads `user_plans` for the purpose of
 * resolving entitlement. One query: the role comes from `users` (never from a
 * request — a client that could name its own role could grant itself Pro), and
 * the plan from a left join, because **no row means Free**.
 *
 * That last point is what let plans be introduced without touching anybody:
 * every existing account resolves to Free from an empty table, so there was
 * nothing to backfill and no account to modify.
 *
 * Expiry is applied here, once, through the shared `effectivePlan` rule. A
 * caller therefore cannot forget to check it — the actor it receives is already
 * the truth. A row that has expired resolves to Free while keeping its `source`
 * for the admin screens to explain *why* somebody is no longer Pro.
 *
 * `run` exists so entitlement can be resolved **inside a caller's transaction**,
 * by passing that transaction's scoped query. An enforcement path must read the
 * plan and count what it is limiting in one snapshot; reading the plan on a
 * separate connection would let a plan change land between the two and pair a
 * Pro answer with a Free count. It defaults to the pool, so every existing
 * caller is unaffected.
 */
export async function getActor(userId: string, run: typeof query = query): Promise<Actor> {
  const rows = await run<{
    role: string; plan: string | null; source: string | null; expires_at: string | null;
  }>(
    `select u.role::text as role, up.plan, up.source, up.expires_at
       from users u
       left join user_plans up on up.user_id = u.id
      where u.id = $1`,
    [userId],
  );

  const row = rows[0];
  /*
   * An unknown id yields Free and not-admin rather than throwing. Callers are
   * routes that have already resolved a session, so this is a belt-and-braces
   * default: the safe answer for an account we cannot read is the least
   * privileged one.
   */
  if (!row) return { userId, plan: "free", source: null, isAdmin: false };

  return {
    userId,
    plan: effectivePlan(row),
    source: (row.source as PlanSource | null) ?? null,
    isAdmin: row.role === "admin",
  };
}
