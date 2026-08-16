import { randomBytes } from "node:crypto";
import { ApiError } from "@/lib/http";
import { MAX_LENGTH, MIN_LENGTH, passwordProblems } from "@/lib/password";
import {
  MAX_USERNAME, MIN_USERNAME, checkUsername, isPlausibleEmail, normaliseEmail, normaliseUsername,
} from "@/lib/identity";
import { hashPassword } from "@/lib/auth";
import { isTestInstance } from "@/lib/env";
import { query, transaction } from "@/lib/db/pool";
import { withCapacityFor } from "@/lib/db/capacity";
import { seedAccount } from "@/lib/seed";
import type { AdminUser } from "@/lib/admin";
import type { Locale } from "@/lib/i18n";

/**
 * Account management, for admins.
 *
 * This is the only place that creates, disables, re-roles or deletes an
 * account on someone else's behalf. It is server-only and every function takes
 * the acting admin as its first argument — not to check the role (the route
 * guard has already done that against the database), but because every one of
 * these actions has to be attributable, and an audit entry with no actor is
 * not an audit entry.
 *
 * ## Deletion strategy
 *
 * Everything a person owns is reachable from `users.id`, and every one of those
 * tables declares `on delete cascade`, so a single `delete from users` removes
 * the lot inside one transaction: profile, preferences, habits and their
 * schedules, completions, goals and goal links, stacks, awareness entries,
 * daily metrics, day notes, weekly reviews, spending records, sessions, and any
 * outstanding setup link. There is no ordered teardown to get wrong and no
 * window in which half the account is gone.
 *
 * Two tables deliberately do not cascade:
 *
 *   `analytics_events` and `user_sessions` are `on delete set null`. They carry
 *   no name, note, habit text or amount — only that an event of some kind
 *   happened, and when. Detaching rather than deleting keeps every aggregate
 *   the admin screens draw honest across a deletion, while removing the link to
 *   a person. Per-user reporting for that account disappears with the row that
 *   named them, which is the point.
 *
 *   `admin_audit_log` records both parties as text as well as by id, so an
 *   entry survives the deletion of either. A log that forgets who was deleted
 *   the moment they are deleted is not a log.
 */

export type AdminAction =
  | "user_created" | "admin_account_created" | "user_disabled" | "user_enabled"
  | "user_role_changed" | "user_deleted" | "password_reset_requested";

/** Never called with a password, a hash, or a setup token. */
async function audit(
  admin: AdminUser, action: AdminAction,
  target: { id: string | null; email: string | null },
  details: Record<string, unknown> = {},
) {
  await query(
    `insert into admin_audit_log (admin_id, admin_email, target_id, target_email, action, details)
     values ($1,$2,$3,$4,$5,$6)`,
    [admin.id, admin.email, target.id, target.email, action, JSON.stringify(details)],
  );
}

/** A temporary password an admin can read aloud once. Never stored in the clear. */
export function temporaryPassword(): string {
  // Ambiguous characters left out: this gets read off a screen and typed.
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export interface NewAccount {
  /** Either of these may be empty, but not both. */
  email: string;
  username: string;
  displayName?: string;
  role: "user" | "admin";
  disabled: boolean;
  /**
   * "invite" hands back a setup link; "set" uses the password the admin typed;
   * "temporary" has the server generate one and hands it back. Only "invite"
   * and "set" are offered in the form — "temporary" stays for callers that
   * want a generated credential without a person present.
   */
  credential: "invite" | "temporary" | "set";
  /** Only read when credential is "set". Never stored, logged or returned. */
  password?: string;
  /** Sends them to /change-password until they choose their own. */
  requireChange?: boolean;
  locale: Locale;
  seedHabits: boolean;
}

export interface CreatedAccount {
  id: string;
  email: string;
  /**
   * Present only for `credential: "temporary"` — a password the server
   * generated, handed back once so the admin can pass it on. A password the
   * admin *typed* is never echoed: they already have it, and returning it
   * would put it in a response body for no reason.
   */
  temporaryPassword?: string;
  /** Present only for `credential: "invite"`. Single use, expires. */
  setupToken?: string;
}

const INVITE_DAYS = 7;

export async function createAccount(admin: AdminUser, input: NewAccount): Promise<CreatedAccount> {
  /*
   * A managed account may be named by a username instead of an address — that
   * is the whole point of usernames here. Requiring an email for one would
   * force an admin to invent a fake address, which then looks real in the
   * users list. One of the two is required; both are allowed.
   */
  const email = normaliseEmail(input.email ?? "");
  const username = normaliseUsername(input.username ?? "");
  if (!email && !username) throw new ApiError("Enter an email address or a username");
  if (email && !isPlausibleEmail(email)) throw new ApiError("Enter a valid email address");
  if (username) {
    const problem = checkUsername(username);
    if (problem) {
      throw new ApiError(problem.reason === "too_short"
        ? `A username must be at least ${MIN_USERNAME} characters`
        : problem.reason === "too_long"
          ? `A username must be under ${MAX_USERNAME} characters`
          : "A username may use letters, digits, and dots, hyphens or underscores in between");
    }
  }

  /*
   * Where the first password comes from:
   *
   *   set        the one the admin typed, checked against the same rules the
   *              form showed them — a client that skipped the form gets the
   *              same refusal.
   *   temporary  generated here, returned once.
   *   invite     a long random string nobody has ever seen. That keeps
   *              `password_hash` NOT NULL honest and means an un-redeemed
   *              invite cannot be signed into by any input at all, rather than
   *              by an empty one.
   *
   * Only the hash is ever written. `initial` is a local that leaves this
   * function only for "temporary", and is never logged or audited.
   */
  let initial: string;
  if (input.credential === "set") {
    const supplied = input.password ?? "";
    const problems = passwordProblems(supplied);
    if (problems.length) {
      throw new ApiError(
        problems.includes("too_short")
          ? `The password must be at least ${MIN_LENGTH} characters`
          : problems.includes("too_long")
            ? `The password must be under ${MAX_LENGTH} characters`
            : "That password is too easy to guess — choose another",
      );
    }
    initial = supplied;
  } else if (input.credential === "temporary") {
    initial = temporaryPassword();
  } else {
    initial = randomBytes(32).toString("hex");
  }
  const passwordHash = await hashPassword(initial);

  /*
   * A generated password always has to be changed — the admin has seen it. One
   * the admin chose *with* the person is a real password already, so the change
   * is offered rather than forced.
   */
  const mustChange = input.credential === "temporary"
    ? true
    : input.credential === "set" ? input.requireChange === true : false;

  let created: { id: string } | null;
  try {
    // An admin account takes no place; a user account does, even when an admin
    // creates it — otherwise the cap would not be a cap.
    created = await withCapacityFor(input.role === "admin" ? 0 : 1, async (q) => {
      const rows = await q<{ id: string }>(
        `insert into users (email, username, password_hash, role, disabled_at,
                            must_change_password, created_via)
         values ($1, $2, $3, $4::user_role, $5, $6, $7) returning id`,
        [email || null, username || null, passwordHash, input.role,
          input.disabled ? new Date() : null, mustChange,
          isTestInstance ? "test" : "admin"],
      );
      const id = rows[0].id;

      /*
       * `seedAccount` is what a self-signup uses, and it already creates the
       * profile and the preferences row — there is one definition of what a new
       * account starts with, and this is not a second one. When the starter
       * habits are declined, those two rows still have to exist, so they are
       * created here instead.
       */
      if (input.seedHabits) {
        await seedAccount(q, id, input.locale);
      } else {
        await q("insert into profiles (id) values ($1)", [id]);
        await q("insert into user_preferences (user_id, locale) values ($1,$2)",
          [id, input.locale]);
      }
      if (input.displayName?.trim()) {
        await q("update profiles set display_name = $2 where id = $1",
          [id, input.displayName.trim()]);
      }
      return { id };
    });
  } catch (e) {
    /*
     * Only the email index means "that address is taken". Matching any
     * duplicate-key error here once turned a collision inside the seeding step
     * into "an account with that email already exists" — a message that sent
     * the admin looking for an account that did not exist, for a fault that
     * had nothing to do with the address. The unique index is still what makes
     * this race-safe; checking first would not be.
     */
    if (e instanceof Error && /users_email_idx/.test(e.message)) {
      throw new ApiError("An account with that email already exists", 409);
    }
    if (e instanceof Error && /users_username_idx/.test(e.message)) {
      throw new ApiError("That username is already taken", 409);
    }
    throw e;
  }

  if (!created) {
    throw new ApiError(
      "Early access is full — disable an account first, or raise "
      + "EARLY_ACCESS_USER_LIMIT.", 409);
  }

  const result: CreatedAccount = { id: created.id, email: email || username };

  if (input.credential === "temporary") {
    result.temporaryPassword = initial;
  } else if (input.credential === "invite") {
    const rows = await query<{ token: string }>(
      `insert into user_invites (user_id, created_by, expires_at)
       values ($1, $2, now() + ($3 || ' days')::interval) returning token`,
      [created.id, admin.id, String(INVITE_DAYS)],
    );
    result.setupToken = rows[0].token;
  }
  // credential === "set" returns neither: the admin has the password already,
  // and there is nothing about it worth putting in a response body.

  /*
   * Creating an admin gets its own action, so "who was given admin access, and
   * by whom" is one query rather than a scan of every creation event.
   */
  const action: AdminAction = input.role === "admin" ? "admin_account_created" : "user_created";
  // The audit entry records that a credential was issued, never which one it was.
  await audit(admin, action, { id: created.id, email: email || username }, {
    role: input.role,
    disabled: input.disabled,
    // Which method was used, never the credential itself.
    credential: input.credential,
    mustChangePassword: mustChange,
    seeded: input.seedHabits,
  });

  return result;
}

/** How many admins could still sign in if this one were gone. */
async function otherActiveAdmins(exceptId: string): Promise<number> {
  const rows = await query<{ n: string }>(
    "select count(*) as n from users where role = 'admin' and disabled_at is null and id <> $1",
    [exceptId],
  );
  return Number(rows[0].n);
}

async function loadTarget(id: string) {
  const rows = await query<{ id: string; email: string; role: string; disabled_at: string | null }>(
    `select id, coalesce(email, username) as email, role, disabled_at
       from users where id = $1`,
    [id],
  );
  if (!rows[0]) throw new ApiError("No such account", 404);
  return rows[0];
}

export async function setDisabled(admin: AdminUser, id: string, disabled: boolean) {
  const target = await loadTarget(id);

  if (disabled) {
    // Locking yourself out is not a thing an interface should let you do by tap.
    if (target.id === admin.id) {
      throw new ApiError("You cannot disable the account you are signed in with", 409);
    }
    if (target.role === "admin" && await otherActiveAdmins(target.id) === 0) {
      throw new ApiError("This is the last active admin — promote another one first", 409);
    }
  }

  if (!disabled) {
    /*
     * Turning an account back on takes a place, so it queues behind the same
     * lock a sign-up does — otherwise a re-enable and a registration could each
     * see 49 and both proceed.
     */
    const ok = await withCapacityFor(target.role === "admin" ? 0 : 1, async (q) => {
      await q("update users set disabled_at = null where id = $1", [id]);
      return true;
    });
    if (!ok) {
      throw new ApiError(
        "Early access is full — disable another account first, or raise "
        + "EARLY_ACCESS_USER_LIMIT.", 409);
    }
  } else {
    await query("update users set disabled_at = $2 where id = $1", [id, new Date()]);
  }
  // Existing sessions stop resolving because getSessionUser checks the column,
  // but the rows are cleared too so nothing lingers server-side.
  if (disabled) await query("delete from sessions where user_id = $1", [id]);

  await audit(admin, disabled ? "user_disabled" : "user_enabled",
    { id: target.id, email: target.email });
}

export async function setRole(admin: AdminUser, id: string, role: "user" | "admin") {
  const target = await loadTarget(id);
  if (target.role === role) return;

  if (target.id === admin.id && role === "user") {
    throw new ApiError("You cannot remove your own admin role", 409);
  }
  if (role === "user" && target.role === "admin" && await otherActiveAdmins(target.id) === 0) {
    throw new ApiError("This is the last active admin — promote another one first", 409);
  }

  await query("update users set role = $2::user_role where id = $1", [id, role]);
  await audit(admin, "user_role_changed", { id: target.id, email: target.email },
    { from: target.role, to: role });
}

/**
 * Issues a fresh temporary password and returns it once. The old one stops
 * working immediately, every existing session is dropped, and the account is
 * marked as owing a password change.
 */
export async function resetPassword(admin: AdminUser, id: string): Promise<string> {
  const target = await loadTarget(id);
  const password = temporaryPassword();
  const hash = await hashPassword(password);

  await transaction(async (q) => {
    await q("update users set password_hash = $2, must_change_password = true where id = $1",
      [id, hash]);
    await q("delete from sessions where user_id = $1", [id]);
  });

  await audit(admin, "password_reset_requested", { id: target.id, email: target.email });
  return password;
}

export async function deleteAccount(admin: AdminUser, id: string) {
  const target = await loadTarget(id);

  if (target.id === admin.id) {
    throw new ApiError("You cannot delete the account you are signed in with", 409);
  }
  if (target.role === "admin" && await otherActiveAdmins(target.id) === 0) {
    throw new ApiError("This is the last active admin — promote another one first", 409);
  }

  // Audited first, and by email as well as id: after the delete there is no row
  // left to look the address up from.
  await audit(admin, "user_deleted", { id: target.id, email: target.email },
    { role: target.role });
  // One statement. Everything owned cascades; analytics detach. See the note
  // at the top of this file.
  await query("delete from users where id = $1", [id]);
}

export interface AuditEntry {
  id: string;
  adminEmail: string;
  targetEmail: string | null;
  action: string;
  details: Record<string, unknown>;
  at: string;
}

export async function auditFor(targetId: string, limit = 25): Promise<AuditEntry[]> {
  const rows = await query<any>(
    `select id, admin_email, target_email, action, details, created_at
       from admin_audit_log where target_id = $1
      order by created_at desc limit $2`,
    [targetId, limit],
  );
  return rows.map((r) => ({
    id: String(r.id), adminEmail: r.admin_email, targetEmail: r.target_email,
    action: r.action, details: r.details ?? {}, at: new Date(r.created_at).toISOString(),
  }));
}

// ─────────────────────────── bulk operations ─────────────────────────────────

export type SkipReason =
  | "self" | "last_admin" | "not_found";

export interface BulkResult {
  requested: number;
  deleted: number;
  skipped: { id: string; email: string | null; reason: SkipReason }[];
}

/**
 * Deleting several accounts in one authorised operation.
 *
 * One request, not one per account: the caller's role is checked once, the
 * protections are evaluated against the whole set, and the answer says exactly
 * what happened to each id. A loop of individual requests from the browser
 * could half-finish, would re-check authorisation N times, and — the real
 * problem — evaluates "is this the last admin" against a database that its own
 * earlier deletions have already changed.
 *
 * Protections, enforced here rather than by hiding checkboxes:
 *
 *   self       the account the caller is signed in with, always
 *   last_admin an admin whose removal would leave nobody able to administer
 *              the system. Evaluated against *the set being deleted*, so
 *              selecting every admin at once cannot slip the last one through
 *              on a technicality — the survivors are counted excluding
 *              everything still slated for deletion.
 *
 * A protected account is skipped with a reason rather than failing the whole
 * operation, so selecting 200 accounts and one of your own colleagues does not
 * mean starting again.
 */
export async function bulkDeleteAccounts(
  admin: AdminUser, ids: string[],
): Promise<BulkResult> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { requested: 0, deleted: 0, skipped: [] };
  if (unique.length > 500) throw new ApiError("Too many accounts in one request", 400);

  const rows = await query<{ id: string; email: string; role: string; disabled_at: string | null }>(
    `select id, coalesce(email, username) as email, role::text as role, disabled_at
       from users where id = any($1::uuid[])`,
    [unique],
  );
  const found = new Map(rows.map((r) => [r.id, r]));

  const skipped: BulkResult["skipped"] = [];
  const candidates: typeof rows = [];

  for (const id of unique) {
    const row = found.get(id);
    if (!row) { skipped.push({ id, email: null, reason: "not_found" }); continue; }
    if (row.id === admin.id) { skipped.push({ id, email: row.email, reason: "self" }); continue; }
    candidates.push(row);
  }

  /*
   * How many active admins would be left. Counted once, against everyone not
   * already being deleted — then admins are released from the set one at a
   * time only while at least one would survive.
   */
  const deleting = new Set(candidates.map((c) => c.id));
  const survivors = await query<{ n: string }>(
    `select count(*) as n from users
      where role = 'admin' and disabled_at is null and id <> all($1::uuid[])`,
    [[...deleting]],
  );
  let remainingAdmins = Number(survivors[0].n);

  const doomed: typeof rows = [];
  for (const row of candidates) {
    if (row.role === "admin" && row.disabled_at === null && remainingAdmins === 0) {
      // Releasing this one keeps an administrator in the system.
      skipped.push({ id: row.id, email: row.email, reason: "last_admin" });
      remainingAdmins += 1;
      continue;
    }
    doomed.push(row);
  }

  if (doomed.length > 0) {
    // Audited before the delete: afterwards there is no row to read the
    // address from. One transaction, so the log and the deletion agree.
    await transaction(async (q) => {
      for (const row of doomed) {
        await q(
          `insert into admin_audit_log (admin_id, admin_email, target_id, target_email,
                                        action, details)
           values ($1,$2,$3,$4,'user_deleted',$5)`,
          [admin.id, admin.email, row.id, row.email,
            JSON.stringify({ role: row.role, bulk: true })],
        );
      }
      // Everything owned cascades; analytics detach. Same path as one-at-a-time.
      await q("delete from users where id = any($1::uuid[])", [doomed.map((d) => d.id)]);
    });
  }

  return { requested: unique.length, deleted: doomed.length, skipped };
}

/** Disable or enable several accounts. Same protections as deletion. */
export async function bulkSetDisabled(
  admin: AdminUser, ids: string[], disabled: boolean,
): Promise<BulkResult> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { requested: 0, deleted: 0, skipped: [] };
  if (unique.length > 500) throw new ApiError("Too many accounts in one request", 400);

  const rows = await query<{ id: string; email: string; role: string; disabled_at: string | null }>(
    `select id, coalesce(email, username) as email, role::text as role, disabled_at
       from users where id = any($1::uuid[])`,
    [unique],
  );
  const found = new Map(rows.map((r) => [r.id, r]));
  const skipped: BulkResult["skipped"] = [];
  const targets: typeof rows = [];

  for (const id of unique) {
    const row = found.get(id);
    if (!row) { skipped.push({ id, email: null, reason: "not_found" }); continue; }
    // Only disabling can lock anyone out, so only disabling is protected.
    if (disabled && row.id === admin.id) {
      skipped.push({ id, email: row.email, reason: "self" }); continue;
    }
    targets.push(row);
  }

  let changed = 0;
  if (disabled) {
    const disabling = new Set(targets.filter((t) => t.role === "admin" && !t.disabled_at)
      .map((t) => t.id));
    const survivors = await query<{ n: string }>(
      `select count(*) as n from users
        where role = 'admin' and disabled_at is null and id <> all($1::uuid[])`,
      [[...disabling]],
    );
    let remainingAdmins = Number(survivors[0].n);

    const doable: typeof rows = [];
    for (const row of targets) {
      if (row.role === "admin" && !row.disabled_at && remainingAdmins === 0) {
        skipped.push({ id: row.id, email: row.email, reason: "last_admin" });
        remainingAdmins += 1;
        continue;
      }
      doable.push(row);
    }
    if (doable.length) {
      await transaction(async (q) => {
        const ids = doable.map((d) => d.id);
        await q("update users set disabled_at = now() where id = any($1::uuid[])", [ids]);
        await q("delete from sessions where user_id = any($1::uuid[])", [ids]);
        for (const row of doable) {
          await q(
            `insert into admin_audit_log (admin_id, admin_email, target_id, target_email,
                                          action, details)
             values ($1,$2,$3,$4,'user_disabled',$5)`,
            [admin.id, admin.email, row.id, row.email, JSON.stringify({ bulk: true })],
          );
        }
      });
    }
    changed = doable.length;
  } else if (targets.length) {
    // Only accounts that are actually off take a place when switched on, and
    // admins never take one.
    const wouldOccupy = targets.filter((t) => t.disabled_at && t.role !== "admin").length;
    const done = await withCapacityFor(wouldOccupy, async (q) => {
      const ids = targets.map((t) => t.id);
      await q("update users set disabled_at = null where id = any($1::uuid[])", [ids]);
      for (const row of targets) {
        await q(
          `insert into admin_audit_log (admin_id, admin_email, target_id, target_email,
                                        action, details)
           values ($1,$2,$3,$4,'user_enabled',$5)`,
          [admin.id, admin.email, row.id, row.email, JSON.stringify({ bulk: true })],
        );
      }
      return true;
    });
    if (!done) {
      throw new ApiError(
        `Enabling ${wouldOccupy} account(s) would exceed the early-access limit. `
        + "Disable others first, or raise EARLY_ACCESS_USER_LIMIT.", 409);
    }
    changed = targets.length;
  }

  return { requested: unique.length, deleted: changed, skipped };
}
