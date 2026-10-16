import { createHash, randomBytes } from "node:crypto";
import { query } from "@/lib/db/pool";
import { sendMail } from "@/lib/email/send";
import { togetherInviteEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/env";
import { isUuid } from "@/lib/http";
import { isLocale, type Locale } from "@/lib/i18n";
import { isPlausibleEmail, normaliseEmail } from "@/lib/identity";
import {
  AUTHORIZED, DISPLAY_NAME, OPEN, TogetherError, USABLE, WAITING, addressedTo, peopleOf, requireAccess, requireBoard,
  togetherLive,
} from "@/lib/together/access";
import { togetherTransaction as transaction } from "@/lib/together/tx";

/**
 * Together invitations. Nobody becomes a member of a board without accepting.
 *
 * Two kinds, one table, one rule:
 *
 *   IN-PLATFORM  to someone in the inviter's People (an account they already
 *                share a board with), or to a public username typed in. No
 *                email: it waits in the invitee's Together home and the
 *                header's notification bell, with Accept and Decline. Usable
 *                at once. An unknown username is refused plainly — usernames
 *                are public handles (the Community board shows them), so that
 *                answer reveals nothing about email addresses.
 *   EMAIL        to an address typed in. Always email, whether or not the
 *                address has an account or is in the inviter's People, so the
 *                inviter learns nothing about who uses RichHabit. When the
 *                address belongs to an account whose address is proved
 *                (access.ts, `addressedTo`), the same invitation also waits in
 *                that account's Together home and bell, so it can be accepted
 *                in-app without the emailed link. The inviter is told nothing
 *                either way.
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
    `select count(*)::int open from together_invitations i where i.board_id = $1 and ${USABLE} and ${AUTHORIZED}`,
    [boardId]);
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
  // Whom you may name by id: People you share a space with, and the
  // collaborators you connected with — both relationships the other person
  // entered knowingly. Anyone else is reached by username or email.
  const { collaboratorsOf } = await import("@/lib/together/connections");
  const mine = new Set([
    ...(await peopleOf(q, inviterId)).map((p) => p.id),
    ...(await collaboratorsOf(inviterId, q)).map((p) => p.id),
  ]);
  if (people.some((id) => !mine.has(id))) throw new TogetherError("notInPeople");
  return insertInvitationsFor(q, boardId, inviterId, people);
}

/**
 * The shared core: in-platform invitations to specific accounts, with the
 * board and inviter already checked and the account ids already resolved —
 * from the inviter's People, or from a typed public username. Never from a
 * raw id in a request: cleanPeople ids go through the People check above, and
 * usernames resolve on the server.
 */
async function insertInvitationsFor(q: Q, boardId: string, inviterId: string, people: string[]): Promise<number> {
  await lockBoard(q, boardId);
  await lockInviter(q, inviterId);
  const fresh = (await q<{ id: string }>(
    `select p.id::text as id from unnest($2::uuid[]) as p(id)
      where not exists (select 1 from together_members m where m.board_id = $1 and m.user_id = p.id)
        -- One live invitation per person per space, whoever sent it, in-app or
        -- emailed to their proved address. The board lock serializes this check.
        and not exists (select 1 from together_invitations i
                         where i.board_id = $1 and ${addressedTo("p.id")} and ${USABLE} and ${AUTHORIZED})
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

/** Invite some of your People to a board, in-platform. The owner, with full access. */
export async function invitePeople(userId: string, boardId: unknown, rawPeople: unknown): Promise<number> {
  await requireAccess(userId, { full: true });
  const people = cleanPeople(rawPeople);
  if (!people.length) return 0;
  return transaction(async (q) => {
    const access = await requireBoard(q, userId, boardId, { owner: true, write: true, lock: true });
    return insertPeopleInvitations(q, access.boardId, userId, people);
  });
}

/**
 * Invite one account by its public username, in-platform — no email, no link.
 * Usernames are public handles (chosen for the Community board), so "no account
 * has that username" is an honest answer that reveals nothing about email
 * addresses or private data. The usual skip rules and daily limit apply;
 * 0 created means they are already here, already invited by this inviter, or
 * recently declined — one combined answer, so a decline is not singled out.
 */
export async function inviteByUsername(userId: string, boardId: unknown, rawUsername: unknown): Promise<number> {
  await requireAccess(userId, { full: true });
  const username = typeof rawUsername === "string" ? rawUsername.trim().toLowerCase() : "";
  // A sanity bound, not the sign-up shape rules: an account whose handle
  // predates today's rules must still be invitable by it.
  if (!username || username.length > 254 || /\s/.test(username)) throw new TogetherError("usernameUnknown", 404);
  return transaction(async (q) => {
    const access = await requireBoard(q, userId, boardId, { owner: true, write: true, lock: true });
    const [target] = await q<{ id: string }>(
      `select id::text as id from users where lower(username) = $1`, [username]);
    if (!target) throw new TogetherError("usernameUnknown", 404);
    return insertInvitationsFor(q, access.boardId, userId, [target.id]);
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
    const access = await requireBoard(q, userId, boardId, { owner: true, write: true, lock: true });
    await lockBoard(q, access.boardId);
    await lockInviter(q, userId);
    const [{ today }] = await q<{ today: number }>(
      `select count(*)::int today from together_invitations
        where invited_by = $1 and token_hash is not null and created_at > now() - interval '24 hours'`, [userId]);
    if (today >= MAX_INVITES_PER_DAY) throw new TogetherError("tooManyInvites", 429);
    // One live invitation per person per space. Someone the inviter already
    // invited in-app, by this very address, keeps that one: nothing new is sent,
    // and the answer is the ordinary one, so it says nothing about the address.
    const [already] = await q<{ id: string }>(
      `select i.id::text as id from together_invitations i join users u on u.id = i.invitee_id
        where i.board_id = $1 and lower(u.email) = $2 and ${USABLE} and ${AUTHORIZED} limit 1`,
      [access.boardId, email]);
    if (already) return { id: already.id, board: "", inviter: "", locale: null, existing: true };
    // Inviting the same address again replaces the open one (a resend), whoever sent it.
    await q(`update together_invitations set revoked_at = now()
      where board_id = $1 and email_normalized = $2 and ${OPEN}`, [access.boardId, email]);
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
    return { ...row, existing: false };
  });
  if (created.existing) return { id: created.id };

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
 * Invitations waiting for this account — in-platform, or emailed to its proved
 * address — newest first; one per board, however many members invited them to
 * it. What the Together home and the header's notification bell both show.
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
 * Accept or decline an invitation addressed to this account — in-platform, or
 * emailed to its proved address (`addressedTo`), which is how a registered
 * account answers an email invitation without the link. Anything else —
 * someone else's, answered, withdrawn, expired, or on an archived board — is
 * one answer, "no longer valid".
 */
export async function respondToInvitation(
  userId: string, inviteId: unknown, accept: unknown,
): Promise<{ boardId: string }> {
  if (!togetherLive() || !isUuid(inviteId)) throw new TogetherError("invitationInvalid", 404);
  // A decline cannot be undone, so it must be asked for, never defaulted to.
  if (typeof accept !== "boolean") throw new TogetherError("invitationInvalid", 400);
  return transaction(async (q) => {
    const boardId = await lockForAnswer(q, `i.id = $1 and ${addressedTo("$2")}`, [inviteId, userId], userId);
    if (!boardId) throw new TogetherError("invitationInvalid", 404);
    const [inv] = await q<{ id: string; board_id: string; invited_by: string }>(
      `select i.id, i.board_id::text, i.invited_by::text
         from together_invitations i join together_boards b on b.id = i.board_id
        where i.id = $1 and ${addressedTo("$2")} and ${USABLE} and ${AUTHORIZED} and b.archived_at is null
        for update of i`, [inviteId, userId]);
    if (!inv) throw new TogetherError("invitationInvalid", 404);
    if (accept) {
      await q(`insert into together_members (board_id, user_id, role, added_by)
        values ($1, $2, 'member', $3) on conflict do nothing`, [inv.board_id, userId, inv.invited_by]);
      await q(`update together_invitations set accepted_at = now(), accepted_by = $2 where id = $1`, [inv.id, userId]);
      await withdrawInvitationsFor(q, inv.board_id, userId);
    } else {
      // A decline answers every invitation addressed to this account on this board.
      await q(`update together_invitations i set declined_at = now()
        where i.board_id = $1 and ${addressedTo("$2")} and ${OPEN}`, [inv.board_id, userId]);
    }
    return { boardId: inv.board_id };
  });
}

/**
 * An address as the invitation screen shows it: the first two and last two
 * characters before the @, the domain whole — "hemeiling90@outlook.com" →
 * "he••••90@outlook.com". Short local parts keep only their first character,
 * and one character is hidden entirely. Informational only.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  const local = [...(at > 0 ? email.slice(0, at) : email)];
  const domain = at > 0 ? email.slice(at + 1) : "";
  const hidden = "••••";
  const shown = local.length >= 6 ? local.slice(0, 2).join("") + hidden + local.slice(-2).join("")
    : local.length >= 2 ? local[0] + hidden
      : hidden;
  return domain ? `${shown}@${domain}` : shown;
}

export type Preview =
  | {
    status: "ok"; board: string; inviter: string;
    /** The invited address, masked. */
    to: string;
    /** Whether it is the signed-in account's own address; null when signed out. */
    forYou: boolean | null;
  }
  | { status: "invalid" };

/**
 * What the holder of an email token may learn before accepting: the board's
 * name, who invited them, the invited address masked, and — when signed in —
 * whether this invitation is for the account they are signed in with. The
 * comparison happens here, so the full address never reaches the browser.
 * Anything unusable — unknown, unsent, answered, withdrawn, expired, or on an
 * archived board — gets one answer, "invalid", with none of these fields.
 */
export async function previewInvitation(token: unknown, viewerId: string | null = null): Promise<Preview> {
  if (!togetherLive() || !isTokenShape(token)) return { status: "invalid" };
  const viewer = isUuid(viewerId) ? viewerId : null;
  const [row] = await query<{ board: string; inviter: string; email: string; for_you: boolean | null }>(
    `select b.name as board, ${DISPLAY_NAME} as inviter, i.email_normalized as email,
            i.email_normalized = (select lower(v.email) from users v where v.id = $2::uuid) as for_you
       from together_invitations i
       join together_boards b on b.id = i.board_id
       join users u on u.id = i.invited_by
       left join profiles p on p.id = u.id
      where i.token_hash = $1 and ${USABLE} and ${AUTHORIZED} and b.archived_at is null`,
    [hash(token), viewer]);
  if (!row) return { status: "invalid" };
  return { status: "ok", board: row.board, inviter: row.inviter, to: maskEmail(row.email),
    forYou: viewer ? row.for_you === true : null };
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
        where i.token_hash = $1 and ${USABLE} and ${AUTHORIZED} and b.archived_at is null
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
