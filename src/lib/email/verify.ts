import { createHash, randomBytes } from "node:crypto";
import { appUrl, capacity } from "@/lib/env";
import { query } from "@/lib/db/pool";
import { withCapacityLock } from "@/lib/db/capacity";
import { EMAIL_PROTECTED } from "@/lib/admin/protected";
import { sendMail } from "@/lib/email/send";
import { emailChangeConfirmEmail, verificationEmail } from "@/lib/email/templates";
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

/**
 * The stored hash of a link minted for an Administrator's requested email
 * change (UM-5) starts with this. It is the row's purpose, fixed when the row
 * is written: a change row may move its account to the address it was sent
 * to; an ordinary row can only ever prove the address the account already
 * has. Without the mark the two are told apart only by "does the address
 * differ", and then a stray link for an OLD address — minted by a resend
 * racing the confirmation — would read as a request to move back to it.
 */
const CHANGE = "change:";

/**
 * Where a verification link points. Absolute, because it is opened from mail.
 *
 * The token is carried in the **fragment**, not the query string, and that is
 * the whole point of the `#`: a fragment is never sent to the server. A query
 * string is, and it is then written verbatim into every request log between the
 * reader and the database — the platform's, the proxy's, the framework's — so a
 * live credential would sit in log storage far longer than the twenty seconds
 * it is actually needed for. The page reads the fragment in the browser, wipes
 * it from the address bar, and sends it once, in the body of a POST.
 *
 * `&for=change` only chooses the page's wording before the button is pressed
 * ("make this your sign-in email"); what the link does is decided by the
 * stored row, never by the URL.
 */
export const verifyUrl = (token: string, change = false) =>
  `${appUrl()}/verify#token=${encodeURIComponent(token)}${change ? "&for=change" : ""}`;

/**
 * Issues a token for an account and emails it.
 *
 * The row is written before the message goes out. The other order can send a
 * link that does not work yet; this order can at worst leave an unused row,
 * which expires on its own.
 *
 * `change`: the link confirms an Administrator's requested change to `email`
 * (UM-5) — see `CHANGE` and `redeem`.
 */
export async function sendVerification(
  userId: string, email: string, locale: Locale, opts: { change?: boolean } = {},
): Promise<void> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expires = new Date(Date.now() + capacity.verifyTtlHours * 60 * 60 * 1000);

  await query(
    `insert into email_verifications (user_id, token_hash, email, expires_at)
     values ($1, $2, $3, $4)`,
    [userId, (opts.change ? CHANGE : "") + hash(token), email, expires],
  );

  await sendMail({
    to: email,
    ...(opts.change
      ? emailChangeConfirmEmail(locale, verifyUrl(token, true))
      : verificationEmail(locale, verifyUrl(token))),
  });
}

/**
 * The email change waiting for its new address to be confirmed, if any (UM-5):
 * the newest live change link. Until it is used the account keeps its
 * current address — and with it its sign-in and its place under the cap.
 */
export async function pendingEmailChange(
  userId: string,
): Promise<{ email: string; expiresAt: string } | null> {
  const rows = await query<{ email: string; expires_at: string }>(
    `select email, expires_at from email_verifications
      where user_id = $1 and starts_with(token_hash, '${CHANGE}')
        and consumed_at is null and expires_at > now()
      order by created_at desc limit 1`,
    [userId],
  );
  const r = rows[0];
  return r ? { email: r.email, expiresAt: new Date(r.expires_at).toISOString() } : null;
}

/**
 * Spends every live change link of an account (an Admin cancelling the
 * request), inside the caller's transaction, and returns the addresses they
 * were for. A new request already spends older ones, so this is normally one.
 */
export async function withdrawEmailChange(
  q: typeof query, userId: string,
): Promise<string[]> {
  const rows = await q<{ email: string }>(
    `update email_verifications set consumed_at = now()
      where user_id = $1 and starts_with(token_hash, '${CHANGE}') and consumed_at is null
      returning email`,
    [userId],
  );
  return rows.map((r) => r.email);
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

/**
 * What happened when an account asked to prove the address it already has.
 *
 * `sent` and `too_soon` are answered identically by the route: a caller cannot
 * use the difference to learn anything, and nothing useful follows from it.
 */
export type OwnVerificationOutcome =
  | "sent" | "already_verified" | "no_address" | "too_soon" | "not_available";

/**
 * An account verifying its own existing address, voluntarily.
 *
 * This exists because `verification_required` and `email_verified_at` answer
 * two different questions. The first is "must this account prove its address
 * before it may be used", decided once at creation and never re-read; the
 * second is "has the address actually been proved". A grandfathered account
 * holds false and null: it is fully entitled to the app, and its address is
 * simply unproven. Until now nothing could move it, because the only way to be
 * sent a link was to be an account that was *required* to verify.
 *
 * So this reads the address off the account itself. **The recipient is never an
 * input.** There is no parameter for it and no branch that could take one from
 * a request, which is what keeps this from becoming a way to post RichHabit
 * mail at a stranger, or to attach a stranger's address to an account.
 *
 * Nothing here writes to `users`. `verification_required` is untouched, and
 * `email_verified_at` is stamped only by `redeem` below, when a live token is
 * actually presented.
 */
export async function requestOwnVerification(
  userId: string, locale: Locale,
): Promise<OwnVerificationOutcome> {
  const rows = await query<{
    email: string | null; verified_at: string | null; disabled_at: string | null;
  }>(
    `select email, email_verified_at as verified_at, disabled_at
       from users where id = $1`,
    [userId],
  );

  const row = rows[0];
  if (!row || row.disabled_at) return "not_available";
  if (row.verified_at) return "already_verified";
  if (!row.email) return "no_address";
  // The same per-account gap the resend route uses, so one button cannot be
  // turned into a way to fill an inbox.
  if (!await mayResend(userId)) return "too_soon";

  await sendVerification(userId, row.email, locale);
  return "sent";
}

export type VerifyOutcome =
  /** Verified just now; the account is active and holds a place. `changed`:
      the link also moved the account to this address (an Admin's request). */
  | { status: "ok"; email: string; changed?: boolean }
  /** Already verified — a second click on the same link, or a scanner. */
  | { status: "already" }
  | { status: "invalid" }
  | { status: "expired" }
  /** Genuine, unexpired, but every place is taken. The link stays usable. */
  | { status: "full" }
  /** A change link whose new address another account has taken since. */
  | { status: "taken" };

type Row = {
  id: string; user_id: string; email: string; change: boolean;
  consumed_at: string | null; expired: boolean;
  verification_required: boolean; email_verified_at: string | null;
  disabled_at: string | null; same_address: boolean; email_protected: boolean;
};
type Q = typeof query;

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
  const hashes = [hash(token), CHANGE + hash(token)];

  try {
    return await withCapacityLock(async (q, roomFor) => {
      const found = await q<{ user_id: string }>(
        "select user_id from email_verifications where token_hash = any($1::text[])", [hashes]);
      if (!found[0]) return { status: "invalid" } as const;
      /* The account row first, then the link — the order an Admin's identity
         edit takes them in — so a confirmation and an edit of the same account
         queue behind each other instead of deadlocking. */
      await q("select 1 from users where id = $1 for update", [found[0].user_id]);
      /*
       * `for update` on the verification row, so two clicks on the same link at
       * the same instant cannot both read it as unconsumed. The capacity lock
       * already serialises the ones that need a place, but a second click by an
       * account that is already verified never asks for a place, so it needs its
       * own guard rather than borrowing that one.
       */
      const rows = await q<Row>(
        `select v.id, v.user_id, v.email, v.consumed_at,
                starts_with(v.token_hash, '${CHANGE}') as change,
                v.expires_at <= now() as expired,
                u.verification_required, u.email_verified_at, u.disabled_at,
                lower(coalesce(u.email, '')) = lower(v.email) as same_address,
                ${EMAIL_PROTECTED("u")} as email_protected
           from email_verifications v join users u on u.id = v.user_id
          where v.token_hash = any($1::text[])
            for update of v`,
        [hashes],
      );

      const row = rows[0];
      if (!row) return { status: "invalid" } as const;
      return row.change ? confirmChange(q, roomFor, row) : confirmAddress(q, roomFor, row);
    });
  } catch (e) {
    // Two accounts confirming the same new address at the same instant: the
    // unique index decides, and the second is told plainly.
    if (e instanceof Error && /users_email_idx/.test(e.message)) return { status: "taken" };
    throw e;
  }
}

/** An ordinary link: proves the address the account already has. */
async function confirmAddress(
  q: Q, roomFor: (n: number) => Promise<boolean>, row: Row,
): Promise<VerifyOutcome> {
  /* A link proves the address it was SENT to, and only while that is still
     the account's address. Without this, a link mailed to an old address —
     issued a moment before an Admin's change took effect — would verify the
     new one. */
  if (!row.same_address) return { status: "invalid" };

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
}

/**
 * A change link (UM-5): an Administrator asked to move this account to the
 * address the link was sent to, and using it proves that inbox is read. Only
 * now does the account's email change — until this moment it kept its old
 * address, its sign-in and its place.
 */
async function confirmChange(
  q: Q, roomFor: (n: number) => Promise<boolean>, row: Row,
): Promise<VerifyOutcome> {
  // A second click after the change went through.
  if (row.same_address) return row.email_verified_at ? { status: "already" } : { status: "invalid" };
  // Superseded by a newer request, cancelled, or spent.
  if (row.consumed_at) return { status: "invalid" };
  if (row.expired) return { status: "expired" };
  if (row.disabled_at) return { status: "invalid" };
  if (row.email_protected) {
    // The account became an Admin's (or is found to have been one) since the
    // request. Never applied; the link is spent so it cannot wait for a demotion.
    await q("update email_verifications set consumed_at = now() where id = $1", [row.id]);
    return { status: "invalid" };
  }
  const taken = await q(
    "select 1 from users where lower(email) = lower($1) and id <> $2", [row.email, row.user_id]);
  if (taken.length) return { status: "taken" };

  /*
   * The place under the cap. An account that already holds one — every account
   * that could be used before the change — keeps it: this asks for no room, so
   * however many people signed up while the link sat in the inbox, confirming
   * it can never cost this person their access. Only an account that never held
   * a place (registered under verification, never confirmed) needs one now,
   * exactly as confirming its first address would.
   */
  if (row.verification_required && !row.email_verified_at && !(await roomFor(1))) {
    return { status: "full" };
  }

  await q("update users set email = $2, email_verified_at = now() where id = $1",
    [row.user_id, row.email]);
  // Everything addressed to the old inbox stops working — and so does this link.
  await q(`update email_verifications set consumed_at = now()
            where user_id = $1 and consumed_at is null`, [row.user_id]);
  await q(`update password_resets set consumed_at = now()
            where user_id = $1 and consumed_at is null`, [row.user_id]);
  await q("delete from google_pending where user_id = $1", [row.user_id]);
  await q(`update user_invites set expires_at = now()
            where user_id = $1 and used_at is null and expires_at > now()`, [row.user_id]);
  /* Audited as the requesting Admin's change, masked exactly as the request
     was. Together reads this row: the new address is proved, so it is
     trusted through `email_verified_at`, never through the legacy arm. */
  await q(
    `insert into admin_audit_log (admin_id, admin_email, target_id, target_email, action, details)
     select r.admin_id, r.admin_email, r.target_id, r.target_email, 'user_email_changed',
            jsonb_build_object('from', r.details->'from', 'to', r.details->'to', 'confirmedByNewAddress', true)
       from admin_audit_log r
      where r.target_id = $1 and r.action = 'user_email_change_requested'
      order by r.id desc limit 1`,
    [row.user_id],
  );
  return { status: "ok", email: row.email, changed: true };
}
