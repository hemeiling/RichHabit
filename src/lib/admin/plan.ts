/**
 * What plan an account is on, for display in Admin → Users.
 *
 * **A presentation helper, and nothing more.** There is no entitlement logic
 * here, no table, and no decision that any feature consults: today the label is
 * read straight off `users.role`, because that is genuinely all the product
 * knows. Every non-admin account is Free.
 *
 * The shape is what matters. A plan is returned as a `label` plus an optional
 * `source`, so the values a later phase introduces — `Pro · Grandfathered`,
 * `Pro · Gifted`, `Pro · Trial` — are a different value from the same function
 * rather than a different layout in the table. When the real entitlement layer
 * exists, this reads from it and the column does not change.
 *
 * Deliberately NOT here: anything that resolves what an account may *do*. A
 * feature must never ask this module a question; it exists to render a word.
 */

export interface PlanBadge {
  /** The plan itself: "Admin", "Free", and later "Pro". */
  label: string;
  /** Where a plan came from, shown after a middot. Absent for Admin and Free. */
  source?: string;
  /** For a tooltip, so the column explains itself without a legend. */
  title: string;
}

const ADMIN: PlanBadge = {
  label: "Admin",
  title: "An administrator. Consumer plan limits do not apply.",
};
const FREE: PlanBadge = {
  label: "Free",
  title: "The free plan. No paid or granted plan exists yet.",
};

/** The badge for one account. Reads the role and nothing else. */
export function planBadge(account: { role: string }): PlanBadge {
  return account.role === "admin" ? ADMIN : FREE;
}

/** How a badge reads as one string: "Free", or "Pro · Grandfathered" later. */
export const planText = (badge: PlanBadge): string =>
  badge.source ? `${badge.label} · ${badge.source}` : badge.label;
