import { createHash, randomBytes } from "node:crypto";
import { query } from "@/lib/db/pool";
import { sendMail } from "@/lib/email/send";
import { togetherInviteEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/env";
import { isUuid } from "@/lib/http";
import { isLocale, type Locale } from "@/lib/i18n";
import { isPlausibleEmail, normaliseEmail } from "@/lib/identity";
import {
  DISPLAY_NAME, OPEN, TogetherError, USABLE, WAITING, peopleOf, requireAccess, requireBoard, togetherLive,
} from "@/lib/together/access";
import { togetherTransaction as transaction } from "@/lib/together/tx";

/**
 * Together invitations. Nobody becomes a member of a board without accepting.
 *
 * Two kinds, one table, one rule:
 *
 *   IN-PLATFORM  to someone in the inviter's People (an account they already
 *                share a board with). No email: it waits in the invitee's
 *                Together home, with Accept and Decline. Usable at once.
 *   EMAIL        to an address typed in. Always email, whether or not the
 *                address has an account or is in the inviter's People, so the
 *                inviter learns nothing about who uses RichHabit.
 *
 * Each inviter's invitations are their own: at most one open per board,
 * invitee and inviter. A retry replaces the inviter's own and never touches
 * another member's — so nobody can withdraw, or detect, someone else's pending
 * invitation by inviting the same person. Answering one answers them all:
 * accepting closes every other open invitation for that person on that board,
 * and declining declines every in-platform one.
 *
 * Removing someone, or their leaving, withdraws every older invitation for them
 * on that board: only an invitation made afterwards, explicitly accepted, ever
 * brings them back.
 *
 * ## Locks
 *
 * Everything that changes a board's membership or invitations locks the board
 * row first (`lockBoard`), so removal, leaving, inviting and accepting on one
 * board are serialized in one order and cannot interleave or deadlock.
 *
 * ## The email token
 *
 * 32 random bytes, sent once in the email and never stored: the table keeps its
 * SHA-256. The link carries it in the URL fragment (`#t=…`), which browsers do
 * not send to servers, so it reaches no access log and no Referer header.
 *
 * ## Email ordering, and what each failure leaves behind
 *
 *   1. COMMIT  revoke this inviter's open invitation for this board + address,
 *              and insert the new one with `sent_at` null. Not usable yet.
 *   2. SEND    the email, which references a row that has committed.
 *   3. COMMIT  set `sent_at` — the invitation becomes usable.
 *
 *   - Step 1 fails      → nothing was sent, nothing exists. "Couldn't send."
 *   - Step 2 fails      → the row is revoked; the inviter is told it failed and
 *                         it can never be accepted. If the provider did deliver
 *                         despite reporting an error (a timeout), the link in
 *                         that email answers "no longer valid".
 *   - Step 3 fails, its answer is lost, or the process dies between 2 and 3
 *                       → the row is withdrawn or stays unsent, so it is not
 *                         usable; the inviter was not told it succeeded.
 *   - Inviter retries   → step 1 revokes the earlier row, and a partial unique
 *                         index allows the inviter only one open invitation per
 *                         board and address, so no retry leaves two usable.
 *
 * Usable ⇔ sent ∧ open (not accepted, declined or revoked) ∧ not expired ∧
 * board not archived.
 *
 * ## The preview
 *
 * Inviting — either kind — needs full Together access (the preview list), and
 * that is checked before anything else, so outside it every request reads as
 * "does not exist". Accepting does not: an account that holds a valid
 * invitation may answer that invitation, and becomes a member of that board
 * only (access.ts).
 */

const TOKEN_BYTES = 32;
export const INVITE_TTL_DAYS = 14;
/** Email invitations one account may create in 24 hours, across all its boards. */
export const MAX_INVITES_PER_DAY = 20;
/** In-platform invitations one account may create in 24 hours. */
export const MAX_PEOPLE_INVITES_PER_DAY = 50;
/** After someone declines, how long before the same inviter may invite them to that board again. */
export const DECLINE_QUIET_DAYS = 7;
/** Open invitations, of both kinds, one board may have at once. */
export const MAX_OPEN_INVITES_PER_BOARD = 25;
/** People invited in one request. */
export const MAX_PEOPLE_PER_REQUEST = 20;
/** Addresses typed into the new-board sheet. */
export const MAX_EMAILS_PER_CREATE = 10;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
export const isTokenShape = (v: unknown): v is string => typeof v === "string" && TOKEN_SHAPE.test(v);

export const inviteUrl = (token: string) => `${appUrl()}/together/invite#t=${encodeURIComponent(token)}`;

/** Test seam: the mail send, replaceable so failure paths can be exercised. */
let send: typeof sendMail = sendMail;
export function setInviteSenderForTests(fn: typeof sendMail | null) { send = fn ?? sendMail; }

type Q = typeof query;

/** A typed address, normalised, or `emailInvalid`. */
export function cleanEmail(raw: unknown): string {
  const email = normaliseEmail(typeof raw === "string" ? raw : "");
  if (!isPlausibleEmail(email) || email.length > 254) throw new TogetherError("emailInvalid");
  return email;
}

/** A request's person ids, de-duplicated; malformed entries are ignored. */
export function cleanPeople(raw: unknown): string[] {
  const people = Array.isArray(raw) ? [...new Set(raw.filter(isUuid))] : [];
  if (people.length > MAX_PEOPLE_PER_REQUEST) throw new TogetherError("tooManyPeople");
  return people;
}

/** Serializes membership and invitation changes on one board. Ends with the caller's transaction. */
export const lockBoard = (q: Q, boardId: string) =>
  q(`select 1 from together_boards where id = $1 for update`, [boardId]);

/** Serializes one inviter's invitations across boards, for the daily limits. */
const lockInviter = (q: Q, userId: string) =>
  q(`select pg_advisory_xact_lock(hashtext('together-invite:' || $1))`, [userId]);

async function requireRoomFor(q: Q, boardId: string, n: number) {
  const [{ open }] = await q<{ open: number }>(
    `select count(*)::int open from together_invitations i where i.board_id = $1 and ${USABLE}`, [boardId]);
  if (open + n > MAX_OPEN_INVITES_PER_BOARD) throw new TogetherError("tooManyOpenInvites", 409);
}

/**
 * In-platform invitations, inside the caller's transaction (which has already
 * checked the inviter's access and the board). Everyone must be in the
 * inviter's People. Skipped: members, anyone this inviter has already invited
 * here, and anyone who declined this inviter's invitation here recently.
 * Returns how many invitations were created.
 */
export async function insertPeopleInvitations(q: Q, boardId: string, inviterId: string, people: string[]): Promise<number> {
  if (!people.length) return 0;
  const mine = new Set((await peopleOf(q, inviterId)).map((p) => p.id));
  if (people.some((id) => !mine.has(id))) throw new TogetherError("notInPeople");
  await lockBoard(q, boardId);
  await lockInviter(q, inviterId);
  const fresh = (await q<{ id: string }>(
    `select p.id::text as id from unnest($2::uuid[]) as p(id)
      where not exists (select 1 from together_members m where m.board_id = $1 and m.user_id = p.id)
        and not exists (select 1 from together_invitations i
                         where i.board_id = $1 and i.invitee_id = p.id and i.invited_by = $3 and ${USABLE})
        and not exists (select 1 from together_invitations i
                         where i.board_id = $1 and i.invitee_id = p.id and i.invited_by = $3
                           and i.declined_at > now() - ($4 || ' days')::interval)`,
    [boardId, people, inviterId, String(DECLINE_QUIET_DAYS)])).map((r) => r.id);
  if (!fresh.length) return 0;
  const [{ today }] = await q<{ today: number }>(
    `select count(*)::int today from together_invitations
      where invited_by = $1 and invitee_id is not null and created_at > now() - interval '24 hours'`, [inviterId]);
  if (today + fresh.length > MAX_PEOPLE_INVITES_PER_DAY) throw new TogetherError("tooManyInvites", 429);
  // This inviter's own expired-but-open ones make way for the new ones.
  await q(`update together_invitations set revoked_at = now()
    where board_id = $1 and invitee_id = any($2::uuid[]) and invited_by = $3 and ${OPEN}`, [boardId, fresh, inviterId]);
  await requireRoomFor(q, boardId, fresh.length);
  await q(`insert into together_invitations (board_id, invitee_id, invited_by, sent_at, expires_at)
    select $1, p.id, $3, now(), now() + ($4 || ' days')::interval from unnest($2::uuid[]) as p(id)`,
    [boardId, fresh, inviterId, String(INVITE_TTL_DAYS)]);
  return fresh.length;
}

/** Invite some of your People to a board, in-platform. Any member with full access. */
export async function invitePeople(userId: string, boardId: unknown, rawPeople: unknown): Promise<number> {
  await requireAccess(userId, { full: true });
  const people = cleanPeople(rawPeople);
  if (!people.length) return 0;
  return transaction(async (q) => {
    const access = await requireBoard(q, userId, boardId, { write: true, lock: true });
    return insertPeopleInvitations(q, access.boardId, userId, people);
  });
}

/**
 * Invite an address to a board, by email. Resolves once the invitation is
 * usable, or throws `sendFailed` having left nothing usable behind.
 */
export async function createInvitation(
  userId: string, boardId: unknown, rawEmail: unknown, inviterLocale: Locale,
): Promise<{ id: string }> {
  await requireAccess(userId, { full: true });
  const email = cleanEmail(rawEmail);

  // 1. Commit an unsent invitation.
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const created = await transaction(async (q) => {
    const access = await requireBoard(q, userId, boardId, { write: true, lock: true });
    await lockBoard(q, access.boardId);
    await lockInviter(q, userId);
    const [{ today }] = await q<{ today: number }>(
      `select count(*)::int today from together_invitations
        where invited_by = $1 and token_hash is not null and created_at > now() - interval '24 hours'`, [userId]);
    if (today >= MAX_INVITES_PER_DAY) throw new TogetherError("tooManyInvites", 429);
    // A retry replaces this inviter's own; another member's is left alone.
    await q(`update together_invitations set revoked_at = now()
      where board_id = $1 and email_normalized = $2 and invited_by = $3 and ${OPEN}`, [access.boardId, email, userId]);
    await requireRoomFor(q, access.boardId, 1);
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
  const withdraw = () => query(`update together_invitations set revoked_at = now()
    where id = $1 and ${OPEN}`, [created.id]).catch(() => {});
  try {
    await send({
      to: email,
      ...togetherInviteEmail(locale, inviteUrl(token), created.inviter, created.board, INVITE_TTL_DAYS),
    });
  } catch (e) {
    await withdraw();
    console.error("[together] invitation email failed:", e instanceof Error ? e.name : "error");
    throw new TogetherError("sendFailed", 502);
  }

  // 3. Activate. Only now is it usable, and only now is success reported. If
  //    the answer is lost (the update may have committed), withdraw it, so an
  //    invitation reported as failed is never left usable.
  let activated: unknown[];
  try {
    activated = await query(
      `update together_invitations set sent_at = now() where id = $1 and ${OPEN} returning id`, [created.id]);
  } catch {
    await withdraw();
    throw new TogetherError("sendFailed", 502);
  }
  if (!activated.length) throw new TogetherError("sendFailed", 502);
  return { id: created.id };
}

/** Withdraw an open invitation of either kind. The board's owner, or whoever sent it. */
export async function revokeInvitation(userId: string, boardId: unknown, inviteId: unknown): Promise<void> {
  const access = await requireBoard(query, userId, boardId);
  if (!isUuid(inviteId)) throw new TogetherError("notFound", 404);
  const done = await query(
    `update together_invitations set revoked_at = now()
      where id = $1 and board_id = $2 and ${OPEN} and ($3 or invited_by = $4) returning id`,
    [inviteId, access.boardId, access.role === "owner", userId]);
  if (!done.length) throw new TogetherError("notFound", 404);
}

/**
 * Withdraw every open invitation *for* someone on a board. On removal or
 * leaving, so that only a later invitation, accepted, can bring them back; on
 * joining, because the others are spent. The caller holds the board lock.
 */
export async function withdrawInvitationsFor(q: Q, boardId: string, userId: string): Promise<void> {
  await q(`update together_invitations set revoked_at = now()
    where board_id = $1 and ${OPEN}
      and (invitee_id = $2 or email_normalized = (select lower(email) from users where id = $2))`,
    [boardId, userId]);
}

/* ------------------------------- answering ------------------------------- */

export interface PendingInvitation { id: string; board: string; inviter: string; expiresAt: string }

/**
 * In-platform invitations waiting for this account, newest first — one per
 * board, however many members invited them to it.
 */
export async function pendingFor(userId: string, q: Q = query): Promise<PendingInvitation[]> {
  return q<PendingInvitation>(
    `select id, board, inviter, "expiresAt" from (
       select distinct on (i.board_id)
              i.id::text as id, b.name as board, ${DISPLAY_NAME} as inviter, i.expires_at as "expiresAt",
              i.created_at
         from together_invitations i
         join together_boards b on b.id = i.board_id
         join users u on u.id = i.invited_by
         left join profiles p on p.id = u.id
        where ${WAITING}
        order by i.board_id, i.created_at desc, i.id
     ) w order by created_at desc, id`, [userId]);
}

/** How many boards have an invitation waiting — for the navigation's quiet indicator. */
export async function pendingCount(userId: string): Promise<number> {
  const [{ n }] = await query<{ n: number }>(
    `select count(distinct i.board_id)::int n
       from together_invitations i join together_boards b on b.id = i.board_id
      where ${WAITING}`, [userId]);
  return n;
}

/**
 * Before answering an invitation: the accounts it joins (the inviter, who
 * becomes `added_by`, and the person answering), then the board. That is the
 * order an account deletion takes them in — its own row first, then its
 * memberships and boards — so the two wait for each other instead of
 * deadlocking. Returns the board, or null if the invitation or its inviter is
 * gone.
 */
async function lockForAnswer(q: Q, where: string, params: unknown[], me: string): Promise<string | null> {
  const [inv] = await q<{ board_id: string; invited_by: string }>(
    `select i.board_id::text, i.invited_by::text from together_invitations i where ${where}`, params);
  if (!inv) return null;
  const alive = await q(`select id from users where id = any($1::uuid[]) order by id for key share`,
    [[inv.invited_by, me]]);
  if (alive.length !== new Set([inv.invited_by, me]).size) return null;
  await lockBoard(q, inv.board_id);
  return inv.board_id;
}

/**
 * Accept or decline an in-platform invitation addressed to this account.
 * Anything else — someone else's, answered, withdrawn, expired, or on an
 * archived board — is one answer, "no longer valid".
 */
export async function respondToInvitation(
  userId: string, inviteId: unknown, accept: unknown,
): Promise<{ boardId: string }> {
  if (!togetherLive() || !isUuid(inviteId)) throw new TogetherError("invitationInvalid", 404);
  // A decline cannot be undone, so it must be asked for, never defaulted to.
  if (typeof accept !== "boolean") throw new TogetherError("invitationInvalid", 400);
  return transaction(async (q) => {
    const boardId = await lockForAnswer(q, "i.id = $1 and i.invitee_id = $2", [inviteId, userId], userId);
    if (!boardId) throw new TogetherError("invitationInvalid", 404);
    const [inv] = await q<{ id: string; board_id: string; invited_by: string }>(
      `select i.id, i.board_id::text, i.invited_by::text
         from together_invitations i join together_boards b on b.id = i.board_id
        where i.id = $1 and i.invitee_id = $2 and ${USABLE} and b.archived_at is null
        for update of i`, [inviteId, userId]);
    if (!inv) throw new TogetherError("invitationInvalid", 404);
    if (accept) {
      await q(`insert into together_members (board_id, user_id, role, added_by)
        values ($1, $2, 'member', $3) on conflict do nothing`, [inv.board_id, userId, inv.invited_by]);
      await q(`update together_invitations set accepted_at = now(), accepted_by = $2 where id = $1`, [inv.id, userId]);
      await withdrawInvitationsFor(q, inv.board_id, userId);
    } else {
      // A decline answers every in-platform invitation to this board.
      await q(`update together_invitations set declined_at = now()
        where board_id = $1 and invitee_id = $2 and ${OPEN}`, [inv.board_id, userId]);
    }
    return { boardId: inv.board_id };
  });
}

export type Preview =
  | { status: "ok"; board: string; inviter: string }
  | { status: "invalid" };

/**
 * What the holder of an email token may learn before accepting: the board's
 * name and who invited them. Anything unusable — unknown, unsent, answered,
 * withdrawn, expired, or on an archived board — gets one answer, "invalid".
 */
export async function previewInvitation(token: unknown): Promise<Preview> {
  if (!togetherLive() || !isTokenShape(token)) return { status: "invalid" };
  const [row] = await query<{ board: string; inviter: string }>(
    `select b.name as board, ${DISPLAY_NAME} as inviter
       from together_invitations i
       join together_boards b on b.id = i.board_id
       join users u on u.id = i.invited_by
       left join profiles p on p.id = u.id
      where i.token_hash = $1 and ${USABLE} and b.archived_at is null`,
    [hash(token)]);
  return row ? { status: "ok", board: row.board, inviter: row.inviter } : { status: "invalid" };
}

/**
 * Accept an emailed invitation, as the signed-in account. The token proves
 * control of the inbox it was sent to, and the account's own address must be
 * that address. Needs no preview access — this is the one door for an invited
 * account — and opens exactly one board.
 */
export async function acceptInvitation(userId: string, token: unknown): Promise<{ boardId: string }> {
  if (!togetherLive() || !isTokenShape(token)) throw new TogetherError("invitationInvalid", 404);
  return transaction(async (q) => {
    const boardId = await lockForAnswer(q, "i.token_hash = $1", [hash(token)], userId);
    if (!boardId) throw new TogetherError("invitationInvalid", 404);
    const [inv] = await q<{ id: string; board_id: string; email: string; invited_by: string }>(
      `select i.id, i.board_id::text, i.email_normalized as email, i.invited_by::text
         from together_invitations i join together_boards b on b.id = i.board_id
        where i.token_hash = $1 and ${USABLE} and b.archived_at is null
        for update of i`, [hash(token)]);
    if (!inv) throw new TogetherError("invitationInvalid", 404);
    const [me] = await q<{ email: string | null }>(`select lower(email) as email from users where id = $1`, [userId]);
    if (!me?.email || me.email !== inv.email) throw new TogetherError("wrongAccount", 403);

    await q(`insert into together_members (board_id, user_id, role, added_by)
      values ($1, $2, 'member', $3) on conflict do nothing`, [inv.board_id, userId, inv.invited_by]);
    await q(`update together_invitations set accepted_at = now(), accepted_by = $2 where id = $1`, [inv.id, userId]);
    await withdrawInvitationsFor(q, inv.board_id, userId);
    return { boardId: inv.board_id };
  });
}
