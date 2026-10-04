import { createHash, randomBytes } from "node:crypto";
import { query, transaction } from "@/lib/db/pool";
import { sendMail } from "@/lib/email/send";
import { togetherInviteEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/env";
import { isUuid } from "@/lib/http";
import { isLocale, type Locale } from "@/lib/i18n";
import { isPlausibleEmail, normaliseEmail } from "@/lib/identity";
import {
  DISPLAY_NAME, TogetherError, requireBoard, requireTogether,
} from "@/lib/together/access";

/**
 * Together invitations — by email, single use, safe to fail.
 *
 * ## The token
 *
 * 32 random bytes, sent once in the email and never stored: the table keeps its
 * SHA-256. The link carries it in the URL fragment (`#t=…`), which browsers do
 * not send to servers, so it reaches no access log and no Referer header. The
 * same pattern email verification and password reset already use — not the
 * admin setup link's plaintext token.
 *
 * ## Ordering, and what each failure leaves behind
 *
 *   1. COMMIT  revoke any open invitation for this board + address, and insert
 *              the new one with `sent_at` null. Not usable yet.
 *   2. SEND    the email, which references a row that has committed.
 *   3. COMMIT  set `sent_at` — the invitation becomes usable.
 *
 *   - Step 1 fails      → nothing was sent, nothing exists. "Couldn't send."
 *   - Step 2 fails      → the row is revoked; the inviter is told it failed and
 *                         it can never be accepted. If the provider did deliver
 *                         despite reporting an error (a timeout), the link in
 *                         that email answers "no longer valid".
 *   - Step 3 fails, or the process dies between 2 and 3
 *                       → the row stays unsent, so it is not usable; the
 *                         inviter was not told it succeeded.
 *   - Inviter retries   → step 1 revokes the earlier row, and a partial unique
 *                         index allows only one open invitation per board and
 *                         address, so no retry can leave two usable invitations.
 *
 * Usable ⇔ sent ∧ not revoked ∧ not accepted ∧ not expired ∧ board not archived.
 * So: success is reported only after the invitation is usable; anything
 * reported as failed is unusable; every email names a row that committed.
 *
 * ## Enumeration
 *
 * The inviter learns nothing about whether an address has an account: the same
 * answer comes back either way, and the invitation is the same. Only the person
 * who holds the token — the owner of the inbox — ever learns which board it is
 * for, and accepting requires being signed in as an account with that address.
 */

const TOKEN_BYTES = 32;
export const INVITE_TTL_DAYS = 14;
/** Invitations one account may create in 24 hours, across all its boards. */
export const MAX_INVITES_PER_DAY = 20;
/** Open invitations one board may have at once. */
export const MAX_OPEN_INVITES_PER_BOARD = 25;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
export const isTokenShape = (v: unknown): v is string => typeof v === "string" && TOKEN_SHAPE.test(v);

export const inviteUrl = (token: string) => `${appUrl()}/together/invite#t=${encodeURIComponent(token)}`;

/** Test seam: the mail send, replaceable so failure paths can be exercised. */
let send: typeof sendMail = sendMail;
export function setInviteSenderForTests(fn: typeof sendMail | null) { send = fn ?? sendMail; }

/**
 * Invite `rawEmail` to a board. Resolves once the invitation is usable, or
 * throws `sendFailed` having left nothing usable behind.
 */
export async function createInvitation(
  userId: string, boardId: unknown, rawEmail: unknown, inviterLocale: Locale,
): Promise<{ id: string }> {
  const email = normaliseEmail(typeof rawEmail === "string" ? rawEmail : "");
  if (!isPlausibleEmail(email) || email.length > 254) throw new TogetherError("emailInvalid");

  // 1. Commit an unsent invitation.
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const created = await transaction(async (q) => {
    const access = await requireBoard(q, userId, boardId, { write: true, lock: true });
    // One invitation at a time per board (two members inviting the same address
    // at once) and per inviter (the daily limit across boards). Both locks end
    // with this transaction, before any email is sent.
    await q(`select 1 from together_boards where id = $1 for update`, [access.boardId]);
    await q(`select pg_advisory_xact_lock(hashtext('together-invite:' || $1))`, [userId]);
    const [{ today }] = await q<{ today: number }>(
      `select count(*)::int today from together_invitations
        where invited_by = $1 and created_at > now() - interval '24 hours'`, [userId]);
    if (today >= MAX_INVITES_PER_DAY) throw new TogetherError("tooManyInvites", 429);
    const [{ open }] = await q<{ open: number }>(
      `select count(*)::int open from together_invitations
        where board_id = $1 and accepted_at is null and revoked_at is null
          and sent_at is not null and expires_at > now()`, [access.boardId]);
    if (open >= MAX_OPEN_INVITES_PER_BOARD) throw new TogetherError("tooManyOpenInvites", 409);
    await q(`update together_invitations set revoked_at = now()
      where board_id = $1 and email_normalized = $2 and accepted_at is null and revoked_at is null`,
      [access.boardId, email]);
    const [row] = await q<{ id: string; board: string; inviter: string; locale: string | null }>(
      `insert into together_invitations (board_id, email_normalized, token_hash, invited_by, expires_at)
       values ($1, $2, $3, $4, now() + ($5 || ' days')::interval)
       returning id::text as id,
         (select name from together_boards where id = $1) as board,
         (select ${DISPLAY_NAME} from users u left join profiles p on p.id = u.id where u.id = $4) as inviter,
         (select up.locale from users u2 join user_preferences up on up.user_id = u2.id
           where lower(u2.email) = $2 limit 1) as locale`,
      [access.boardId, email, hash(token), userId, String(INVITE_TTL_DAYS)]);
    return row;
  });

  // 2. Send. The recipient's own language when they already have an account
  //    (decided here, on the server, and never reported back), else the inviter's.
  const locale: Locale = isLocale(created.locale) ? created.locale : inviterLocale;
  try {
    await send({
      to: email,
      ...togetherInviteEmail(locale, inviteUrl(token), created.inviter, created.board, INVITE_TTL_DAYS),
    });
  } catch (e) {
    await query(`update together_invitations set revoked_at = now()
      where id = $1 and accepted_at is null and revoked_at is null`, [created.id]).catch(() => {});
    console.error("[together] invitation email failed:", e instanceof Error ? e.name : "error");
    throw new TogetherError("sendFailed", 502);
  }

  // 3. Activate. Only now is it usable, and only now is success reported. If
  //    the answer is lost (the update may have committed), withdraw it, so an
  //    invitation reported as failed is never left usable.
  let activated: unknown[];
  try {
    activated = await query(
      `update together_invitations set sent_at = now()
        where id = $1 and accepted_at is null and revoked_at is null returning id`, [created.id]);
  } catch {
    await query(`update together_invitations set revoked_at = now()
      where id = $1 and accepted_at is null and revoked_at is null`, [created.id]).catch(() => {});
    throw new TogetherError("sendFailed", 502);
  }
  if (!activated.length) throw new TogetherError("sendFailed", 502);
  return { id: created.id };
}

/** Withdraw an open invitation. The board's owner, or whoever sent it. */
export async function revokeInvitation(userId: string, boardId: unknown, inviteId: unknown): Promise<void> {
  const access = await requireBoard(query, userId, boardId);
  if (!isUuid(inviteId)) throw new TogetherError("notFound", 404);
  const done = await query(
    `update together_invitations set revoked_at = now()
      where id = $1 and board_id = $2 and accepted_at is null and revoked_at is null
        and ($3 or invited_by = $4) returning id`,
    [inviteId, access.boardId, access.role === "owner", userId]);
  if (!done.length) throw new TogetherError("notFound", 404);
}

export type Preview =
  | { status: "ok"; board: string; inviter: string }
  | { status: "invalid" };

/**
 * What the holder of a token may learn before accepting: the board's name and
 * who invited them. Anything unusable — unknown, unsent, revoked, accepted,
 * expired, or on an archived board — gets one answer, "invalid".
 */
export async function previewInvitation(token: unknown): Promise<Preview> {
  if (!isTokenShape(token)) return { status: "invalid" };
  const [row] = await query<{ board: string; inviter: string }>(
    `select b.name as board, ${DISPLAY_NAME} as inviter
       from together_invitations i
       join together_boards b on b.id = i.board_id
       join users u on u.id = i.invited_by
       left join profiles p on p.id = u.id
      where i.token_hash = $1 and i.sent_at is not null and i.accepted_at is null
        and i.revoked_at is null and i.expires_at > now() and b.archived_at is null`,
    [hash(token)]);
  return row ? { status: "ok", board: row.board, inviter: row.inviter } : { status: "invalid" };
}

/**
 * Accept, as the signed-in account. The token proves control of the inbox it
 * was sent to; the account's own address must be that address. Accepting also
 * records the address as verified — the token could only have been read there.
 */
export async function acceptInvitation(userId: string, token: unknown): Promise<{ boardId: string }> {
  requireTogether(userId);
  if (!isTokenShape(token)) throw new TogetherError("invitationInvalid", 404);
  return transaction(async (q) => {
    const [inv] = await q<{ id: string; board_id: string; email: string; invited_by: string }>(
      `select i.id, i.board_id::text, i.email_normalized as email, i.invited_by::text
         from together_invitations i join together_boards b on b.id = i.board_id
        where i.token_hash = $1 and i.sent_at is not null and i.accepted_at is null
          and i.revoked_at is null and i.expires_at > now() and b.archived_at is null
        for update of i`, [hash(token)]);
    if (!inv) throw new TogetherError("invitationInvalid", 404);
    const [me] = await q<{ email: string | null }>(`select lower(email) as email from users where id = $1`, [userId]);
    if (!me?.email || me.email !== inv.email) throw new TogetherError("wrongAccount", 403);

    await q(`insert into together_members (board_id, user_id, role, added_by)
      values ($1, $2, 'member', $3) on conflict do nothing`, [inv.board_id, userId, inv.invited_by]);
    await q(`update together_invitations set accepted_at = now(), accepted_by = $2 where id = $1`, [inv.id, userId]);
    await q(`update users set email_verified_at = now() where id = $1 and email_verified_at is null`, [userId]);
    return { boardId: inv.board_id };
  });
}
