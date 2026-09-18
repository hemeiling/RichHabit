import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "@/lib/auth";
import { query, transaction } from "@/lib/db/pool";
import { sendMail } from "@/lib/email/send";
import { resetEmail } from "@/lib/email/templates";
import { appUrl, passwordReset as config } from "@/lib/env";
import { looksLikeEmail, normaliseIdentifier } from "@/lib/identity";
import type { Locale } from "@/lib/i18n";

/**
 * Getting back into an account whose password is gone.
 *
 * The whole design rests on one decision made in the audit: the trusted channel
 * is `users.email` *once `email_verified_at` is set*, and nothing else. An
 * address nobody ever proved is not evidence of anything, so an account with an
 * unverified address is treated exactly like an account that does not exist —
 * it is sent nothing, and the caller is told the same sentence either way.
 *
 * Three further decisions worth keeping in view.
 *
 * **The token is stored hashed**, like the confirmation token and for the same
 * reason: a copy of the table must not be a set of working links. Plain SHA-256
 * rather than scrypt, because a 256-bit random value has no structure to slow
 * an attacker down over.
 *
 * **Asking again invalidates what came before.** Each issue consumes every
 * outstanding token for that account, so the newest message in an inbox is the
 * only one that works, and a link copied out of an older message is already
 * dead.
 *
 * **Succeeding ends every session.** Somebody resetting a password may be
 * recovering from a theft, and leaving the thief's session alive would make the
 * reset theatre. This is the one place that differs from an ordinary password
 * change, which keeps the session doing the changing.
 */

const TOKEN_BYTES = 32;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Where a reset link points. The token rides in the **fragment**, which
 * browsers never send, so the request that opens the page carries no credential
 * and no request log can retain one. See src/app/reset/ResetContent.tsx.
 */
export const resetUrl = (token: string) =>
  `${appUrl()}/reset#token=${encodeURIComponent(token)}`;

/**
 * The account a reset may be sent for, or null.
 *
 * Every condition that disqualifies an account is applied here, in one place,
 * and every one produces the same silence: unknown identifier, no address, an
 * address nobody proved, a disabled account. The caller cannot tell them apart
 * because it is never told which applied.
 */
async function eligible(identifier: string): Promise<{ id: string; email: string } | null> {
  const value = normaliseIdentifier(identifier);
  if (!value) return null;

  const rows = await query<{ id: string; email: string | null }>(
    `select id, email from users
      where ${looksLikeEmail(value) ? "lower(email) = $1" : "lower(username) = $1"}
        and email is not null
        and email_verified_at is not null
        and disabled_at is null`,
    [value],
  );
  const row = rows[0];
  return row?.email ? { id: row.id, email: row.email } : null;
}

/** Whether this account may be sent another reset email now. */
async function withinLimits(userId: string): Promise<boolean> {
  const rows = await query<{ recent: string; today: string }>(
    `select
       count(*) filter (where created_at > now() - ($2 || ' seconds')::interval) as recent,
       count(*) filter (where created_at > now() - interval '24 hours')          as today
       from password_resets where user_id = $1`,
    [userId, String(config.gapSeconds)],
  );
  return Number(rows[0].recent) === 0 && Number(rows[0].today) < config.maxPerDay;
}

/**
 * What actually happened. Returned for tests and logging only — the route
 * answers identically whichever it is, and never puts this in a response.
 */
export type ResetRequestOutcome = "sent" | "not_eligible" | "rate_limited";

export async function requestReset(
  identifier: string, locale: Locale,
): Promise<ResetRequestOutcome> {
  const account = await eligible(identifier);
  if (!account) return "not_eligible";
  if (!await withinLimits(account.id)) return "rate_limited";

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expires = new Date(Date.now() + config.ttlMinutes * 60 * 1000);

  await transaction(async (q) => {
    // The newest link is the only live one.
    await q(
      `update password_resets set consumed_at = now()
        where user_id = $1 and consumed_at is null`,
      [account.id],
    );
    await q(
      `insert into password_resets (user_id, token_hash, expires_at) values ($1, $2, $3)`,
      [account.id, hash(token), expires],
    );
  });

  /* The row is written before the message goes out. The other order can send a
     link that does not work yet; this order can at worst leave an unused row,
     which expires on its own. The address comes from the account, never from
     the request. */
  await sendMail({ to: account.email, ...resetEmail(locale, resetUrl(token), config.ttlMinutes) });
  return "sent";
}

export type ResetOutcome =
  /** The password was changed and every session for that account is gone. */
  | { status: "ok" }
  /** Unknown, already used, or belonging to an account that cannot be reset. */
  | { status: "invalid" }
  | { status: "expired" };

/**
 * Spends a token and sets the new password.
 *
 * Everything happens in one transaction, with the token row locked, so two
 * people racing the same link cannot both succeed: the second finds it
 * consumed. The password itself is hashed by the same function the rest of the
 * application uses, and its rules are checked by the caller against the same
 * `passwordProblems` the sign-up form and the admin form use.
 */
export async function redeemReset(token: string, password: string): Promise<ResetOutcome> {
  if (!token) return { status: "invalid" };
  const passwordHash = await hashPassword(password);

  return transaction(async (q) => {
    const rows = await q<{
      id: string; user_id: string; consumed_at: string | null; expired: boolean;
      disabled_at: string | null;
    }>(
      `select r.id, r.user_id, r.consumed_at, r.expires_at <= now() as expired,
              u.disabled_at
         from password_resets r join users u on u.id = r.user_id
        where r.token_hash = $1
          for update of r`,
      [hash(token)],
    );

    const row = rows[0];
    if (!row) return { status: "invalid" };
    if (row.consumed_at) return { status: "invalid" };
    if (row.expired) return { status: "expired" };
    // An admin turned the account off. Nothing here may switch it back on.
    if (row.disabled_at) return { status: "invalid" };

    await q(
      `update users set password_hash = $2, must_change_password = false where id = $1`,
      [row.user_id, passwordHash],
    );
    // This token, and any other outstanding one, in the same breath.
    await q(
      `update password_resets set consumed_at = now()
        where user_id = $1 and consumed_at is null`,
      [row.user_id],
    );
    /* Every session, including the one that asked. Whoever reset this may be
       recovering from a theft, and a surviving session would make the reset
       theatre. An ordinary password change keeps its own session; this does
       not. */
    await q(`delete from sessions where user_id = $1`, [row.user_id]);

    return { status: "ok" };
  });
}
