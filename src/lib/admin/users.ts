import { randomBytes } from "node:crypto";
import { ApiError } from "@/lib/http";
import {
  MAX_USERNAME, MIN_USERNAME, checkUsername, isPlausibleEmail, normaliseEmail, normaliseUsername,
} from "@/lib/identity";
import { hashPassword } from "@/lib/auth";
import { query, transaction } from "@/lib/db/pool";
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
  | "user_created" | "user_disabled" | "user_enabled" | "user_role_changed"
  | "user_deleted" | "password_reset_requested";

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
  /** "invite" hands back a setup link; "temporary" hands back a password. */
  credential: "invite" | "temporary";
  locale: Locale;
  seedHabits: boolean;
}

export interface CreatedAccount {
  id: string;
  email: string;
  /** Present only for `credential: "temporary"`, and only in this response. */
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
   * An account created by invite still gets a password hash, of a long random
   * string nobody has ever seen. That keeps `password_hash` NOT NULL honest and
   * means an un-redeemed invite cannot be signed into by any input at all,
   * rather than by an empty one.
   */
  const initial = input.credential === "temporary" ? temporaryPassword() : randomBytes(32).toString("hex");
  const passwordHash = await hashPassword(initial);

  let created: { id: string };
  try {
    created = await transaction(async (q) => {
      const rows = await q<{ id: string }>(
        `insert into users (email, username, password_hash, role, disabled_at,
                            must_change_password)
         values ($1, $2, $3, $4::user_role, $5, $6) returning id`,
        [email || null, username || null, passwordHash, input.role,
          input.disabled ? new Date() : null, input.credential === "temporary"],
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

  const result: CreatedAccount = { id: created.id, email: email || username };

  if (input.credential === "temporary") {
    result.temporaryPassword = initial;
  } else {
    const rows = await query<{ token: string }>(
      `insert into user_invites (user_id, created_by, expires_at)
       values ($1, $2, now() + ($3 || ' days')::interval) returning token`,
      [created.id, admin.id, String(INVITE_DAYS)],
    );
    result.setupToken = rows[0].token;
  }

  // The audit entry records that a credential was issued, never which one it was.
  await audit(admin, "user_created", { id: created.id, email: email || username }, {
    role: input.role,
    disabled: input.disabled,
    credential: input.credential,
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

  await query("update users set disabled_at = $2 where id = $1",
    [id, disabled ? new Date() : null]);
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
