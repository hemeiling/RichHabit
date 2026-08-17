import { createHash, randomBytes } from "node:crypto";
import { appUrl, capacity } from "@/lib/env";
import { query } from "@/lib/db/pool";
import { withCapacityLock } from "@/lib/db/capacity";
import { sendMail } from "@/lib/email/send";
import { verificationEmail } from "@/lib/email/templates";
import type { Locale } from "@/lib/i18n";

/**
 * Proving that a new account's address belongs to whoever registered it.
 *
 * Three decisions worth keeping in view.
 *
 * **The token is stored hashed.** It is a bearer credential for a short while,
 * and the same argument that applies to passwords applies here: a leaked
 * backup should not be a set of working links. What is compared is the SHA-256,
 * and a plain SHA-256 rather than scrypt because a 256-bit random token has no
 * guessable structure to slow an attacker down over.
 *
 * **Redeeming a link takes a place, and can therefore be refused.** An
 * unverified account occupies nothing, so between registering and clicking,
 * the last place can legitimately go to someone else. That is answered plainly
 * rather than by letting the platform drift to 51 — and the token is left
 * unconsumed, so the same link still works if a place frees up.
 *
 * **Nothing here reads a role or a user id from the request.** The token is the
 * only input, and it names its own account.
 */

const TOKEN_BYTES = 32;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Where a verification link points. Absolute, because it is opened from mail. */
export const verifyUrl = (token: string) =>
  `${appUrl()}/verify?token=${encodeURIComponent(token)}`;

/**
 * Issues a token for an account and emails it.
 *
 * The row is written before the message goes out. The other order can send a
 * link that does not work yet; this order can at worst leave an unused row,
 * which expires on its own.
 */
export async function sendVerification(
  userId: string, email: string, locale: Locale,
): Promise<void> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expires = new Date(Date.now() + capacity.verifyTtlHours * 60 * 60 * 1000);

  await query(
    `insert into email_verifications (user_id, token_hash, email, expires_at)
     values ($1, $2, $3, $4)`,
    [userId, hash(token), email, expires],
  );

  await sendMail({ to: email, ...verificationEmail(locale, verifyUrl(token)) });
}

/**
 * True when this account may be sent another link now. Stops a resend button
 * from being turned into a way to post mail at somebody.
 */
export async function mayResend(userId: string): Promise<boolean> {
  const rows = await query<{ recent: string }>(
    `select count(*) as recent from email_verifications
      where user_id = $1 and created_at > now() - ($2 || ' seconds')::interval`,
    [userId, String(capacity.resendGapSeconds)],
  );
  return Number(rows[0].recent) === 0;
}

export type VerifyOutcome =
  /** Verified just now; the account is active and holds a place. */
  | { status: "ok"; email: string }
  /** Already verified — a second click on the same link, or a scanner. */
  | { status: "already" }
  | { status: "invalid" }
  | { status: "expired" }
  /** Genuine, unexpired, but every place is taken. The link stays usable. */
  | { status: "full" };

/**
 * Redeems a token.
 *
 * Everything happens inside `withCapacityLock`, so the count that decides
 * whether this account may become active is taken in the same transaction that
 * activates it, behind the same lock a registration takes. Two people holding
 * valid links to the last free place are therefore serialised: the first
 * commits at 50, the second counts 50 and is told the programme is full.
 */
export async function redeem(token: string): Promise<VerifyOutcome> {
  if (!token) return { status: "invalid" };

  return withCapacityLock(async (q, roomFor) => {
    /*
     * `for update` on the verification row, so two clicks on the same link at
     * the same instant cannot both read it as unconsumed. The capacity lock
     * already serialises the ones that need a place, but a second click by an
     * account that is already verified never asks for a place, so it needs its
     * own guard rather than borrowing that one.
     */
    const rows = await q<{
      id: string; user_id: string; email: string;
      consumed_at: string | null; expired: boolean;
      verification_required: boolean; email_verified_at: string | null;
      disabled_at: string | null;
    }>(
      `select v.id, v.user_id, v.email, v.consumed_at,
              v.expires_at <= now() as expired,
              u.verification_required, u.email_verified_at, u.disabled_at
         from email_verifications v join users u on u.id = v.user_id
        where v.token_hash = $1
          for update of v`,
      [hash(token)],
    );

    const row = rows[0];
    if (!row) return { status: "invalid" };

    // Already done: say so rather than reporting an error at someone who is
    // simply looking at an old message.
    if (row.email_verified_at) return { status: "already" };
    // A consumed token on an unverified account means it was consumed for
    // something no longer true; treat it as spent.
    if (row.consumed_at) return { status: "invalid" };
    if (row.expired) return { status: "expired" };
    // An admin turned the account off before it was ever used. Nothing to do.
    if (row.disabled_at) return { status: "invalid" };

    /*
     * The flag may have been turned off since this was sent, in which case the
     * account already holds its place and needs no room. Stamping the date is
     * still right: the address really was proved.
     */
    if (row.verification_required && !(await roomFor(1))) {
      return { status: "full" };
    }

    await q(
      "update users set email_verified_at = now() where id = $1 and email_verified_at is null",
      [row.user_id],
    );
    await q("update email_verifications set consumed_at = now() where id = $1", [row.id]);
    // Every other outstanding link for this account becomes dead weight.
    await q(
      `update email_verifications set consumed_at = now()
        where user_id = $1 and consumed_at is null`,
      [row.user_id],
    );
    return { status: "ok", email: row.email };
  });
}
