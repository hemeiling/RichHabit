import { query } from "@/lib/db/pool";
import { together } from "@/lib/env";
import { ApiError, isUuid } from "@/lib/http";

/**
 * Together — who may see it, and who may touch a board.
 *
 * ## Who may use Together at all
 *
 * While Together is in preview, `TOGETHER_PREVIEW_USER_IDS` decides, and an
 * empty list turns it off for everyone (`togetherLive`). Inside that:
 *
 *   full     — on the list: everything, including creating boards and inviting.
 *   invited  — not on the list, but a member of a board or holding an open
 *              invitation addressed to it (in-platform, or emailed to its
 *              proved address — see `addressedTo`): their own boards and
 *              invitations, and what a member may do on them. Not creating
 *              boards, not inviting — so new access always starts from someone
 *              on the list.
 *
 * Accepting an emailed invitation by its link needs neither: the token, the
 * matching address and the invitation's own validity decide (invitations.ts).
 * That is the narrow way a brand-new account reaches the one board it was
 * invited to.
 *
 * ## Who may touch a board
 *
 * Every board route goes through `requireBoard`. Membership is the authority:
 * the answer for "no such board" and "not your board" is the same 404, so a
 * board id cannot be probed. A member asking for an owner's action is told so
 * (403) — they already know the board exists. Writes to an archived board are
 * refused (409): archiving makes a board read-only, and that has to hold for
 * every write a later phase adds, which is why it is decided here. Membership
 * housekeeping is the exception and stays open on an archived board: the owner
 * may remove someone, a member may leave, and a pending invitation may be
 * withdrawn — each only takes access away.
 */

/** Why a Together operation was refused. Routes translate the code. */
export type TogetherErrorCode =
  | "notFound" | "ownerOnly" | "archived" | "nameRequired" | "nameTooLong"
  | "emailInvalid" | "tooManyInvites" | "tooManyOpenInvites" | "sendFailed"
  | "invitationInvalid" | "wrongAccount" | "ownerCannotLeave" | "cannotRemoveSelf" | "confirmMismatch"
  | "notInPeople" | "tooManyPeople" | "tooManyBoards" | "previewOnly" | "conflict" | "usernameUnknown"
  | "tooManyConnections"
  // V1B — shared work
  | "titleRequired" | "titleTooLong" | "descriptionTooLong" | "stageInvalid" | "effortInvalid"
  | "dueInvalid" | "notAMember" | "tooManyAssignees" | "tooManyTasks" | "taskDeleted" | "textConflict"
  | "taskMissing" | "groupNameRequired" | "groupNameTooLong" | "groupExists" | "groupMissing" | "tooManyGroups"
  // Progress
  | "periodInvalid";

export class TogetherError extends ApiError {
  constructor(readonly code: TogetherErrorCode, status = 400) {
    super(code, status);
    this.name = "TogetherError";
  }
}

const notFound = () => new TogetherError("notFound", 404);

type Q = typeof query;

/** An invitation nobody has answered or withdrawn. */
export const OPEN = "accepted_at is null and declined_at is null and revoked_at is null";
/** …and one that can still be answered. Columns of `together_invitations i`. */
export const USABLE =
  "i.accepted_at is null and i.declined_at is null and i.revoked_at is null and i.sent_at is not null and i.expires_at > now()";

/**
 * Accounts that were never asked to verify (`verification_required = false`)
 * are treated as holding a proved address only when they predate this cutoff
 * — the existing accounts the Product Owner already knows — or were created
 * by an admin, who vouched for the address. A fixed literal, in the manner of
 * Phase 4C's Grandfathered Pro cutoff, so the exempt set is closed: a later
 * spell with REQUIRE_EMAIL_VERIFICATION switched off can mint sign-ins, but
 * never new accounts whose unverified address this check would trust.
 */
export const PROVED_ADDRESS_CUTOFF = "2026-10-17T00:00:00Z";

/**
 * An invitation addressed to the account bound as `param`: it names the account
 * (in-platform), or it was emailed to the account's own address. The email arm
 * requires the address to be *proved* — verified, or held by an account that
 * was never asked to verify and predates `PROVED_ADDRESS_CUTOFF` (or was
 * admin-created, and thereby vouched for). An account whose address is
 * unproved keeps only the email link, whose token proves control of the inbox
 * itself — and the in-app verify flow upgrades it at any time. Columns of
 * `together_invitations i`.
 *
 * An address an Admin has CHANGED (UM-5) is never trusted by the account's age
 * or origin. A change takes effect only when the new address is confirmed,
 * which sets `email_verified_at` (the first arm) in the same transaction that
 * writes the `user_email_changed` audit row; that row also takes the account
 * out of the grandfathered arm for good. No column was needed, so no migration.
 */
export const addressedTo = (param: string) =>
  `(i.invitee_id = ${param} or (i.email_normalized is not null and exists (
     select 1 from users me where me.id = ${param} and lower(me.email) = i.email_normalized
       and (me.email_verified_at is not null
            or (not me.verification_required
                and (me.created_at < timestamptz '${PROVED_ADDRESS_CUTOFF}' or me.created_via = 'admin')
                and not exists (select 1 from admin_audit_log changed
                                 where changed.target_id = me.id and changed.action = 'user_email_changed'))))))`;

/**
 * A space invitation whose sender still holds the right to invite to that
 * space. Today that right is ownership (`mayInvite`); an invitation sent
 * under a right since lost — by a member, before invitations became the
 * owner's — can no longer be answered, appear in a bell, or admit anyone.
 * Checked when an invitation is listed, counted and accepted, so no later
 * change of authority ever needs a sweep of old rows. Columns of
 * `together_invitations i`. (Space invitations only: collaborator requests
 * have no space and are untouched.)
 */
export const AUTHORIZED = `exists (select 1 from together_members auth
   where auth.board_id = i.board_id and auth.user_id = i.invited_by and auth.role = 'owner')`;

/**
 * Invitations waiting for account `$1` — in-platform, or emailed to its proved
 * address: usable, from someone still entitled to send it, on a live board it
 * is not already on. Columns of `together_invitations i` joined to
 * `together_boards b`. The one definition behind access, the list, the count
 * and the header's notification bell.
 */
export const WAITING = `${addressedTo("$1")} and ${USABLE} and ${AUTHORIZED} and b.archived_at is null
   and not exists (select 1 from together_members m where m.board_id = i.board_id and m.user_id = $1)`;

/** Together is switched on at all: during the preview, only while somebody is on the list. */
export const togetherLive = (): boolean => together.previewUserIds.size > 0;

/** On the preview list. Server only; the list never leaves the server. */
export const isPreviewUser = (userId: string): boolean =>
  together.previewUserIds.has(userId.toLowerCase());

/**
 * Whether this reader may invite to a space: its owner, with full access, and
 * the space not archived — what the invitation functions enforce
 * (requireAccess full, then requireBoard owner + write). Invitations are the
 * owner's by default; a member asking is told so plainly, never shown a
 * control that would be refused. Screens use this only for presentation.
 */
export const mayInvite = (userId: string, role: BoardRole, archived: boolean): boolean =>
  role === "owner" && !archived && isPreviewUser(userId);

export type TogetherAccess = "full" | "invited";

/**
 * An open collaborator request addressed to this account also admits it —
 * otherwise the invitee could never see the request to answer it. In its own
 * guarded query because the tables arrive with a later migration than the
 * rest: until then this reads as "none", and Together behaves exactly as the
 * release before it. (The richer rule lives in lib/together/connections.ts;
 * this copy exists because connections.ts imports this module.)
 */
async function waitingConnection(userId: string, q: Q): Promise<boolean> {
  try {
    const rows = await q(
      `select 1 where exists (
         select 1 from together_connections c where c.user_low = $1 or c.user_high = $1
       ) or exists (
         select 1 from together_connection_invitations i
          where ${addressedTo("$1")} and ${USABLE} and i.invited_by <> $1
       ) limit 1`, [userId]);
    return rows.length > 0;
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42P01" || code === "42703") return false;
    throw e;
  }
}

/** What this account may do in Together, or null for "it does not exist". */
export async function togetherAccess(userId: string, q: Q = query): Promise<TogetherAccess | null> {
  if (!togetherLive()) return null;
  if (isPreviewUser(userId)) return "full";
  const [row] = await q<{ yes: boolean }>(
    `select exists (select 1 from together_members where user_id = $1)
         or exists (select 1 from together_invitations i join together_boards b on b.id = i.board_id
                     where ${WAITING}) as yes`,
    [userId]);
  if (row?.yes) return "invited";
  return (await waitingConnection(userId, q)) ? "invited" : null;
}

/** Refuses — as "not found" — anyone with no access; `full` also requires the preview list. */
export async function requireAccess(userId: string, { full = false, q = query }: { full?: boolean; q?: Q } = {}) {
  const access = await togetherAccess(userId, q);
  if (!access) throw notFound();
  if (full && access !== "full") throw new TogetherError("previewOnly", 403);
  return access;
}

export type BoardRole = "owner" | "member";

export interface BoardAccess {
  boardId: string;
  role: BoardRole;
  archived: boolean;
}

/**
 * The gate. Resolves this account's membership of `boardId`, or refuses.
 *
 *   write  — the board must not be archived
 *   owner  — the account must own it
 *
 * Takes the query function so it can run inside a caller's transaction, and
 * can lock the membership row (`lock`) so a removal cannot slip between the
 * check and the write that relies on it.
 */
export async function requireBoard(
  q: Q, userId: string, boardId: unknown,
  { write = false, owner = false, lock = false }: { write?: boolean; owner?: boolean; lock?: boolean } = {},
): Promise<BoardAccess> {
  if (!togetherLive() || !isUuid(boardId)) throw notFound();
  const [row] = await q<{ role: BoardRole; archived: boolean }>(
    `select m.role, b.archived_at is not null as archived
       from together_members m join together_boards b on b.id = m.board_id
      where m.board_id = $1 and m.user_id = $2${lock ? " for update of m" : ""}`,
    [boardId, userId]);
  if (!row) throw notFound();
  if (owner && row.role !== "owner") throw new TogetherError("ownerOnly", 403);
  if (write && row.archived) throw new TogetherError("archived", 409);
  return { boardId, role: row.role, archived: row.archived };
}

/**
 * The name another member sees: the display name, else the first name, else
 * the username. Never an email address, never a last name on its own.
 * `p` is `profiles`, `u` is `users`.
 */
export const DISPLAY_NAME =
  "coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.first_name), ''), u.username, 'RichHabit member')";

export interface PersonView { id: string; name: string }

/**
 * People: everyone who shares at least one board with `userId`, by display
 * name. Derived, never stored — there is no contact list to manage or leak.
 * People are who you can conveniently *invite*; nobody is ever added to a board
 * without accepting.
 */
export async function peopleOf(q: Q, userId: string): Promise<PersonView[]> {
  return q<PersonView>(
    `select distinct u.id::text as id, ${DISPLAY_NAME} as name
       from together_members mine
       join together_members theirs on theirs.board_id = mine.board_id and theirs.user_id <> mine.user_id
       join users u on u.id = theirs.user_id
       left join profiles p on p.id = u.id
      where mine.user_id = $1
      order by name, id`, [userId]);
}
