import { ApiError, check } from "@/lib/http";
import { query, transaction } from "@/lib/db/pool";
import { effectivePlan } from "@/lib/entitlements";
import type { AdminUser } from "@/lib/admin";

/**
 * Membership administration (UM-3): the one place that WRITES `user_plans`.
 *
 * Reading a plan to decide what someone may do stays the entitlement
 * module's job (`getActor`), and nothing here is consulted by a feature. This
 * module only lets an administrator change the row that module reads:
 *
 *   grant   Free → Advanced, from the `gifted` source (complimentary; there is
 *           no billing), with an optional expiry and an admin note
 *   modify  an existing Advanced plan's expiry and note — its source stays
 *   revoke  Advanced → Free. The row is kept with `plan = 'free'` so its
 *           provenance still reads on the listing ("a grant from Gifted was
 *           removed"); the entitlement rule already treats it as Free.
 *
 * Protections, enforced here rather than by hiding buttons:
 *
 *   · Admin accounts are unlimited by role and can hold no plan at all.
 *   · A row whose source is `grandfathered` — the eight early accounts' permanent
 *     Advanced — changes only with the account's username typed back AND a
 *     reason, both recorded. Nothing reaches such a row by default or in bulk.
 *   · "Advanced" is the label; the stored value stays `pro`, which the
 *     entitlement module, the CHECK constraint and every reader already speak.
 *
 * Every change runs in one transaction with the user and plan rows locked,
 * so two admins acting at once serialize, and the audit entry — the complete
 * row before and after, plus the reason — commits with the change or not at
 * all. The audit is the undo: a mistaken revoke can be restored exactly.
 */

export interface PlanRecord {
  plan: "free" | "pro";
  source: string | null;
  grantedAt: string | null;
  expiresAt: string | null;
  note: string | null;
  grantedBy: string | null;
}

export interface Membership {
  role: "user" | "admin";
  /** What a grandfathered change must be confirmed with: the username, else the address. */
  identifier: string;
  record: PlanRecord | null;
  /** Today's answer from the shared entitlement rule. */
  effective: "free" | "pro";
  /**
   * The stored plan is grandfathered: changing it needs the typed username and
   * a reason. Decided here, so no screen inspects the source for itself.
   */
  protectedPlan: boolean;
}

export type PlanOp = "grant" | "modify" | "revoke";

export interface PlanChange {
  op: PlanOp;
  /** "YYYY-MM-DD", the last day the plan holds; null for no expiry. */
  expiresOn: string | null;
  note: string | null;
  confirm: string;
  reason: string;
}

const MAX_NOTE = 500;

type Row = {
  plan: "free" | "pro"; source: string | null; granted_at: Date | string | null;
  expires_at: Date | string | null; note: string | null; granted_by: string | null;
};
const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());
const record = (r: Row | undefined): PlanRecord | null => r ? {
  plan: r.plan, source: r.source, grantedAt: iso(r.granted_at), expiresAt: iso(r.expires_at),
  note: r.note, grantedBy: r.granted_by,
} : null;

/** The membership panel's view of one account (admin pages only; carries the note). */
export async function membershipFor(id: string): Promise<Membership | null> {
  const rows = await query<Row & { role: string; identifier: string }>(
    `select u.role::text as role, coalesce(u.username, u.email) as identifier,
            up.plan, up.source, up.granted_at, up.expires_at, up.note, up.granted_by
       from users u left join user_plans up on up.user_id = u.id
      where u.id = $1`, [id]);
  const r = rows[0];
  if (!r) return null;
  const rec = r.plan ? record(r) : null;
  return {
    role: r.role === "admin" ? "admin" : "user",
    identifier: r.identifier,
    record: rec,
    effective: effectivePlan(r.plan ? { plan: r.plan, expires_at: r.expires_at } : null),
    protectedPlan: isProtected(r.source),
  };
}

/** The one rule for which stored plans need the typed confirmation and a reason. */
const isProtected = (source: string | null | undefined) => source === "grandfathered";

/** The request body, read with the house checks; the rules live below. */
export function parsePlanChange(b: any): PlanChange {
  const expiresOn = b?.expiresOn == null || b.expiresOn === "" ? null : check.date(b.expiresOn, "expiresOn");
  const note = check.text(b?.note ?? "", "note", MAX_NOTE).trim();
  return {
    op: check.oneOf(b?.op, ["grant", "modify", "revoke"] as const, "op"),
    expiresOn,
    note: note || null,
    confirm: check.text(b?.confirm ?? "", "confirm", 254).trim(),
    reason: check.text(b?.reason ?? "", "reason", MAX_NOTE).trim(),
  };
}

/** The end of the chosen day, UTC: "through Dec 31" means the whole of Dec 31. */
const endOf = (day: string) => new Date(`${day}T23:59:59.999Z`);

export async function setMembership(admin: AdminUser, id: string, change: PlanChange): Promise<Membership> {
  if (change.expiresOn && endOf(change.expiresOn) <= new Date()) {
    throw new ApiError("The expiry date must be today or later", 400);
  }

  await transaction(async (q) => {
    const [user] = await q<{ id: string; role: string; identifier: string }>(
      `select id, role::text as role, coalesce(username, email) as identifier
         from users where id = $1 for update`, [id]);
    if (!user) throw new ApiError("No such account", 404);
    if (user.role === "admin") {
      throw new ApiError("Admin accounts are unlimited by role — they hold no plan", 409);
    }

    const [beforeRow] = await q<Row>(
      `select plan, source, granted_at, expires_at, note, granted_by
         from user_plans where user_id = $1 for update`, [id]);
    const before = record(beforeRow);
    const isAdvanced = effectivePlan(beforeRow ? { plan: beforeRow.plan, expires_at: beforeRow.expires_at } : null) === "pro";

    // A grandfathered row changes only deliberately, with both proofs recorded.
    if (isProtected(beforeRow?.source)) {
      if (change.confirm.toLowerCase() !== (user.identifier ?? "").toLowerCase()) {
        throw new ApiError(`This is a grandfathered plan. Type the username (${user.identifier}) to confirm.`, 409);
      }
      if (!change.reason) throw new ApiError("A reason is required to change a grandfathered plan", 400);
    }

    const expiresAt = change.expiresOn ? endOf(change.expiresOn) : null;
    let action: "plan_granted" | "plan_changed" | "plan_revoked";
    if (change.op === "grant") {
      if (isAdvanced) throw new ApiError("This account already has Advanced — change or revoke it instead", 409);
      await q(
        `insert into user_plans (user_id, plan, source, granted_at, expires_at, note, granted_by)
         values ($1, 'pro', 'gifted', now(), $2, $3, $4)
         on conflict (user_id) do update
           set plan = 'pro', source = 'gifted', granted_at = now(),
               expires_at = excluded.expires_at, note = excluded.note, granted_by = excluded.granted_by`,
        [id, expiresAt, change.note, admin.id]);
      action = "plan_granted";
    } else if (change.op === "modify") {
      if (!isAdvanced) throw new ApiError("This account has no Advanced plan to change — grant one instead", 409);
      await q(`update user_plans set expires_at = $2, note = $3 where user_id = $1`,
        [id, expiresAt, change.note]);
      action = "plan_changed";
    } else {
      if (!isAdvanced) throw new ApiError("This account is already on Free", 409);
      // Kept as a Free row, so where the plan came from stays readable.
      await q(`update user_plans set plan = 'free', expires_at = null where user_id = $1`, [id]);
      action = "plan_revoked";
    }

    const [afterRow] = await q<Row>(
      `select plan, source, granted_at, expires_at, note, granted_by from user_plans where user_id = $1`, [id]);
    await q(
      `insert into admin_audit_log (admin_id, admin_email, target_id, target_email, action, details)
       values ($1, $2, $3, $4, $5, $6)`,
      [admin.id, admin.email, user.id, user.identifier, action, JSON.stringify({
        before, after: record(afterRow),
        ...(change.reason ? { reason: change.reason } : {}),
      })]);
  });

  return (await membershipFor(id))!;
}
