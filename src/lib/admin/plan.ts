import { effectivePlan, type Plan, type PlanSource } from "@/lib/entitlements";

/**
 * What plan an account is on, as a word for Admin → Users.
 *
 * **Presentation only.** It decides nothing: `effectivePlan` in the entitlement
 * module is what says whether a row is Pro today, and this turns that answer
 * into a label. No feature may ask this module a question, and it reads no
 * database and no environment — the row it is handed comes from the admin
 * listing's own query.
 *
 * Expiry is applied through the shared rule, so an expired Pro row reads as
 * **Free** here exactly as a feature would treat it. Its `source` is still shown
 * in a tooltip, because "Free, and it used to be a trial" is the useful answer
 * when somebody asks why access changed.
 *
 * `note` is deliberately absent. It is admin prose about a person's plan and has
 * no place in a listing; the privacy test fails if the listing query so much as
 * names that column.
 */

export interface PlanBadge {
  /** "Admin", "Free" or "Pro". */
  label: string;
  /** Shown after a middot for Pro: "Grandfathered", "Paid", "Trial"… */
  source?: string;
  /** For a tooltip, so the column explains itself without a legend. */
  title: string;
}

/** How each stored source reads on screen. `purchased` shows as "Paid". */
const SOURCE_LABEL: Record<PlanSource, string> = {
  grandfathered: "Grandfathered",
  purchased: "Paid",
  gifted: "Gifted",
  promotional: "Promotional",
  trial: "Trial",
  support: "Support",
};

const SOURCE_TITLE: Record<PlanSource, string> = {
  grandfathered: "Permanent Pro, granted to an early account at no charge. It does not expire and needs no payment provider.",
  purchased: "Pro from a purchase.",
  gifted: "Pro given at no charge.",
  promotional: "Pro from a promotion.",
  trial: "Pro for a trial period.",
  support: "Pro granted by a support decision.",
};

const ADMIN: PlanBadge = {
  label: "Admin",
  title: "An administrator. Consumer plan limits do not apply.",
};

/** What the listing needs to know about one account's plan. Never the note. */
export interface PlanRow {
  role: string;
  plan?: Plan | string | null;
  source?: PlanSource | string | null;
  expiresAt?: string | Date | null;
}

export function planBadge(account: PlanRow, now: Date = new Date()): PlanBadge {
  if (account.role === "admin") return ADMIN;

  const plan = effectivePlan(
    { plan: account.plan ?? null, expires_at: account.expiresAt ?? null }, now);
  const source = (account.source ?? null) as PlanSource | null;

  if (plan === "pro" && source) {
    return {
      label: "Pro",
      source: SOURCE_LABEL[source] ?? source,
      title: SOURCE_TITLE[source] ?? "Pro.",
    };
  }
  if (plan === "pro") {
    // The CHECK constraint forbids this in the database; if it ever appears, say
    // so plainly rather than inventing a provenance.
    return { label: "Pro", title: "Pro, with no recorded source." };
  }

  /*
   * Free — and a source surviving on a Free row means a plan once existed, so
   * say so. Inferred from the source alone rather than from the stored plan,
   * deliberately: the caller hands over the **effective** plan, so an expired
   * grant already reads "free" here, and testing `account.plan === "pro"` made
   * this branch unreachable from the admin listing. Asking the caller for the
   * raw plan as well would put expiry resolution back in two places, which is
   * what the entitlement module exists to prevent.
   *
   * It is sound: `source` is non-null only on a plan row, and the table's
   * `plan <> 'pro' or source is not null` CHECK means a Free row needs no source
   * at all. So Free-with-a-source is a grant that lapsed or was downgraded — the
   * wording covers both rather than claiming an expiry it cannot prove.
   */
  if (source) {
    return {
      label: "Free",
      title: `The free plan. A Pro grant from ${SOURCE_LABEL[source] ?? source} has expired or been removed.`,
    };
  }
  return { label: "Free", title: "The free plan." };
}

/** How a badge reads as one string: "Free", or "Pro · Grandfathered". */
export const planText = (badge: PlanBadge): string =>
  badge.source ? `${badge.label} · ${badge.source}` : badge.label;
