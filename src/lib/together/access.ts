import { query } from "@/lib/db/pool";
import { together } from "@/lib/env";
import { ApiError, isUuid } from "@/lib/http";

/**
 * Together — who may see it, and who may touch a board.
 *
 * Every Together route goes through `requireBoard` (or `requireTogether` for
 * the few that are not about one board). It is the single place that answers
 * "is this person on this board, and may they do this", and a test enumerates
 * the route files to prove none skips it.
 *
 * The answer for "no such board" and "not your board" is the same 404, so a
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
  | "invitationInvalid" | "wrongAccount" | "ownerCannotLeave" | "cannotRemoveSelf"
  | "notInPeople" | "tooManyPeople" | "tooManyBoards";

export class TogetherError extends ApiError {
  constructor(readonly code: TogetherErrorCode, status = 400) {
    super(code, status);
    this.name = "TogetherError";
  }
}

const notFound = () => new TogetherError("notFound", 404);

/** Whether this account may see Together at all. Server only. */
export const togetherEnabledFor = (userId: string): boolean =>
  together.previewUserIds.has(userId.toLowerCase());

/** Refuses — as "not found" — anyone outside the preview. */
export function requireTogether(userId: string): void {
  if (!togetherEnabledFor(userId)) throw notFound();
}

export type BoardRole = "owner" | "member";

export interface BoardAccess {
  boardId: string;
  role: BoardRole;
  archived: boolean;
}

type Q = typeof query;

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
  requireTogether(userId);
  if (!isUuid(boardId)) throw notFound();
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
