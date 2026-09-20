/**
 * What an account is entitled to — the one place that answers it.
 *
 * ## The boundary
 *
 * Feature code asks `limitFor(actor, "activeHabits")` and nothing else. It does
 * not read `users.role`, it does not read `user_plans`, and it does not know
 * what a source is. That matters for a reason worth stating: the moment two
 * places decide what Pro means, they disagree, and the disagreement shows up as
 * a person being refused something they paid for — or given something they did
 * not. Admin bypass lives here for the same reason.
 *
 * ## Billing is not entitlement
 *
 * Nothing here knows about a payment provider, and `source = 'purchased'` is
 * just another provenance. A feature asks "what is this account entitled to",
 * never "did this account pay". When billing eventually exists it writes plan
 * rows; it does not get a say in how they are read.
 *
 * ## Unlimited is `null`
 *
 * Not `Infinity`, which does not survive JSON, and emphatically not `0` — the
 * account-cap bug in Phase 2 was exactly a `0` that meant two different things.
 * `null` reads as "no limit" at every call site and cannot be mistaken for a
 * limit of none.
 *
 * ## Where enforcement happens
 *
 * In exactly two places, both in `lib/db/queries.ts`, both inside the
 * transaction that performs the write: `saveHabit` gates a transition **into**
 * active, and `addPriority` charges a day's quota. Nothing else consults these
 * numbers — no route, no component, no screen — which is what keeps the policy
 * here rather than scattered across the features it governs.
 *
 * A limit is checked only by an operation that would *increase* what it counts.
 * Editing, renaming, rescheduling, completing, pausing and retiring are never
 * gated, and an account already over a limit keeps everything it has.
 */

export type Plan = "free" | "pro";
export type PlanSource =
  | "grandfathered" | "purchased" | "gifted" | "promotional" | "trial" | "support";

/** The features that have a limit. Adding one means adding it here first. */
export type Feature = "activeHabits" | "newPrioritiesPerDay";

/**
 * Who is asking, reduced to what entitlement depends on. Built by `getActor`;
 * nothing else should construct one from a request.
 */
export interface Actor {
  userId: string;
  /** The **effective** plan: an expired Pro row resolves to "free" here. */
  plan: Plan;
  /** Where a Pro plan came from. Null for Free, and for a plan without one. */
  source: PlanSource | null;
  isAdmin: boolean;
}

/** `null` means unlimited. */
export interface Entitlements {
  activeHabits: number | null;
  newPrioritiesPerDay: number | null;
}

/**
 * The Free allowance. The one place these numbers are written down.
 *
 * 15 active habits is a sheet somebody can actually keep; 5 new priorities a day
 * is more than a considered day needs and far less than a runaway loop produces.
 */
export const FREE_LIMITS: Entitlements = {
  activeHabits: 15,
  newPrioritiesPerDay: 5,
};

const UNLIMITED: Entitlements = {
  activeHabits: null,
  newPrioritiesPerDay: null,
};

/**
 * What this actor may do.
 *
 * Admins bypass consumer limits — centrally, here, and nowhere else. Pro is
 * unlimited for both of today's features; that will stop being true when Pro
 * gains allowances of its own, and this is where that change belongs.
 */
export function entitlements(actor: Actor): Entitlements {
  if (actor.isAdmin) return UNLIMITED;
  return actor.plan === "pro" ? UNLIMITED : FREE_LIMITS;
}

/** One feature's limit, or null for unlimited. The call site features use. */
export function limitFor(actor: Actor, feature: Feature): number | null {
  return entitlements(actor)[feature];
}

/**
 * Whether a stored plan row is Pro *right now*.
 *
 * Pure, and shared by everything that needs the answer — the actor, the admin
 * listing, and the tests — so an expired row cannot read as Pro on one screen
 * and Free on another. A row is Pro only when it says so and has not expired;
 * `expires_at` null means permanent, which is what Grandfathered Pro holds.
 */
export function effectivePlan(
  row: { plan?: string | null; expires_at?: string | Date | null } | null | undefined,
  now: Date = new Date(),
): Plan {
  if (!row || row.plan !== "pro") return "free";
  if (row.expires_at == null) return "pro";
  return new Date(row.expires_at) > now ? "pro" : "free";
}
