import { query, transaction } from "@/lib/db/pool";
import { isUuid } from "@/lib/http";
import {
  DISPLAY_NAME, TogetherError, requireBoard, requireTogether, type BoardRole,
} from "@/lib/together/access";

/**
 * Together V1A — boards and membership.
 *
 * "People" is derived, not stored: the accounts you share a board with, active
 * or archived. There is no friendship table to manage or leak; somebody is in
 * your People only because you both belong to the same board.
 *
 * Nothing here reads any private RichHabit table. Another member is known by an
 * id and a display name (`DISPLAY_NAME`) — never an email address.
 */

export const MAX_BOARD_NAME = 80;
/** A guard against runaway creation, far above any real use. */
export const MAX_BOARDS_OWNED = 100;
export const MAX_PEOPLE_PER_CREATE = 20;

export interface PersonView { id: string; name: string }
export interface BoardSummary {
  id: string;
  name: string;
  role: BoardRole;
  archived: boolean;
  members: PersonView[];
}
export interface HomeView { boards: BoardSummary[]; people: PersonView[] }

export function cleanBoardName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new TogetherError("nameRequired");
  if (name.length > MAX_BOARD_NAME) throw new TogetherError("nameTooLong");
  return name;
}

/** Everyone who shares at least one board with `userId`, by display name. */
async function peopleOf(q: typeof query, userId: string): Promise<PersonView[]> {
  return q<PersonView>(
    `select distinct u.id::text as id, ${DISPLAY_NAME} as name
       from together_members mine
       join together_members theirs on theirs.board_id = mine.board_id and theirs.user_id <> mine.user_id
       join users u on u.id = theirs.user_id
       left join profiles p on p.id = u.id
      where mine.user_id = $1
      order by name, id`, [userId]);
}

export async function loadHome(userId: string): Promise<HomeView> {
  requireTogether(userId);
  const boards = await query<{ id: string; name: string; role: BoardRole; archived: boolean; members: PersonView[] }>(
    `select b.id::text as id, b.name, mine.role, b.archived_at is not null as archived,
            (select coalesce(json_agg(json_build_object('id', u.id::text, 'name', ${DISPLAY_NAME})
                     order by m.joined_at, m.user_id), '[]'::json)
               from together_members m join users u on u.id = m.user_id
               left join profiles p on p.id = u.id
              where m.board_id = b.id) as members
       from together_members mine join together_boards b on b.id = mine.board_id
      where mine.user_id = $1
      order by b.archived_at is not null, b.updated_at desc, b.id`, [userId]);
  return { boards, people: await peopleOf(query, userId) };
}

/**
 * A new board, owned by its creator, with any of their People added straight
 * away. Somebody already collaborating with you can be put on a new board
 * without a fresh invitation — membership is still explicit, per board, and
 * they can leave. Anyone else is invited by email (invitations.ts).
 */
export async function createBoard(userId: string, rawName: unknown, rawPeople: unknown): Promise<{ id: string; people: number }> {
  requireTogether(userId);
  const name = cleanBoardName(rawName);
  const people = Array.isArray(rawPeople) ? [...new Set(rawPeople.filter(isUuid))] : [];
  if (people.length > MAX_PEOPLE_PER_CREATE) throw new TogetherError("tooManyPeople");
  return transaction(async (q) => {
    const [{ n }] = await q<{ n: number }>(
      `select count(*)::int n from together_members where user_id = $1 and role = 'owner'`, [userId]);
    if (n >= MAX_BOARDS_OWNED) throw new TogetherError("tooManyBoards", 409);
    const mine = new Set((await peopleOf(q, userId)).map((p) => p.id));
    if (people.some((id) => !mine.has(id))) throw new TogetherError("notInPeople");
    const [board] = await q<{ id: string }>(
      `insert into together_boards (name, created_by) values ($1, $2) returning id::text as id`, [name, userId]);
    await q(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'owner', $2)`,
      [board.id, userId]);
    for (const id of people) {
      await q(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'member', $3)`,
        [board.id, id, userId]);
    }
    return { id: board.id, people: people.length };
  });
}

export interface InvitationView {
  id: string;
  /** Shown only to the owner, and to whoever sent it. */
  email: string;
  invitedBy: string;
  expiresAt: string;
}
export interface BoardView {
  id: string;
  name: string;
  role: BoardRole;
  archived: boolean;
  members: (PersonView & { role: BoardRole; joinedAt: string })[];
  invitations: InvitationView[];
  /** Open invitations sent by other members, which this reader may not see. */
  otherInvitations: number;
  /** People who could be added without an invitation (owner only). */
  addable: PersonView[];
}

export async function loadBoard(userId: string, boardId: unknown): Promise<BoardView> {
  const access = await requireBoard(query, userId, boardId);
  const [board] = await query<{ name: string }>(`select name from together_boards where id = $1`, [access.boardId]);
  const members = await query<PersonView & { role: BoardRole; joinedAt: string }>(
    `select u.id::text as id, ${DISPLAY_NAME} as name, m.role, m.joined_at as "joinedAt"
       from together_members m join users u on u.id = m.user_id
       left join profiles p on p.id = u.id
      where m.board_id = $1 order by m.role = 'owner' desc, m.joined_at, m.user_id`, [access.boardId]);
  const open = await query<{ id: string; email: string; invitedBy: string; invitedById: string; expiresAt: string }>(
    `select i.id::text as id, i.email_normalized as email, ${DISPLAY_NAME} as "invitedBy",
            i.invited_by::text as "invitedById", i.expires_at as "expiresAt"
       from together_invitations i join users u on u.id = i.invited_by
       left join profiles p on p.id = u.id
      where i.board_id = $1 and i.sent_at is not null and i.accepted_at is null
        and i.revoked_at is null and i.expires_at > now()
      order by i.created_at desc`, [access.boardId]);
  const visible = open.filter((i) => access.role === "owner" || i.invitedById === userId);
  const memberIds = new Set(members.map((m) => m.id));
  const addable = access.role === "owner" && !access.archived
    ? (await peopleOf(query, userId)).filter((p) => !memberIds.has(p.id)) : [];
  return {
    id: access.boardId, name: board.name, role: access.role, archived: access.archived, members,
    invitations: visible.map(({ invitedById: _ignored, ...i }) => i),
    otherInvitations: open.length - visible.length,
    addable,
  };
}

export async function renameBoard(userId: string, boardId: unknown, rawName: unknown): Promise<void> {
  const name = cleanBoardName(rawName);
  const access = await requireBoard(query, userId, boardId, { owner: true, write: true });
  await query(`update together_boards set name = $2, updated_at = now() where id = $1`, [access.boardId, name]);
}

/** Archive or restore. Owner only; archiving makes the board read-only for everyone. */
export async function setArchived(userId: string, boardId: unknown, archived: boolean): Promise<void> {
  const access = await requireBoard(query, userId, boardId, { owner: true });
  await query(
    `update together_boards set archived_at = ${archived ? "coalesce(archived_at, now())" : "null"},
            updated_at = now() where id = $1`, [access.boardId]);
}

/** Add existing People to a board (owner). Anyone else needs an invitation. */
export async function addMembers(userId: string, boardId: unknown, rawPeople: unknown): Promise<number> {
  const people = Array.isArray(rawPeople) ? [...new Set(rawPeople.filter(isUuid))] : [];
  if (!people.length) return 0;
  if (people.length > MAX_PEOPLE_PER_CREATE) throw new TogetherError("tooManyPeople");
  return transaction(async (q) => {
    const access = await requireBoard(q, userId, boardId, { owner: true, write: true, lock: true });
    const mine = new Set((await peopleOf(q, userId)).map((p) => p.id));
    if (people.some((id) => !mine.has(id))) throw new TogetherError("notInPeople");
    let added = 0;
    for (const id of people) {
      const r = await q(`insert into together_members (board_id, user_id, role, added_by)
        values ($1, $2, 'member', $3) on conflict do nothing returning user_id`, [access.boardId, id, userId]);
      added += r.length;
    }
    return added;
  });
}

/**
 * The owner removes someone. Their open invitations on this board go with them:
 * somebody who is no longer on a board must not still be able to bring others
 * onto it.
 */
export async function removeMember(userId: string, boardId: unknown, targetId: unknown): Promise<void> {
  if (!isUuid(targetId)) throw new TogetherError("notFound", 404);
  if (targetId === userId) throw new TogetherError("cannotRemoveSelf");
  await transaction(async (q) => {
    const access = await requireBoard(q, userId, boardId, { owner: true, lock: true });
    const gone = await q(`delete from together_members where board_id = $1 and user_id = $2 returning user_id`,
      [access.boardId, targetId]);
    if (!gone.length) throw new TogetherError("notFound", 404);
    await q(`update together_invitations set revoked_at = now()
      where board_id = $1 and invited_by = $2 and accepted_at is null and revoked_at is null`,
      [access.boardId, targetId]);
  });
}

/** A member leaves. The owner cannot (V1 has no ownership transfer); they archive instead. */
export async function leaveBoard(userId: string, boardId: unknown): Promise<void> {
  await transaction(async (q) => {
    const access = await requireBoard(q, userId, boardId, { lock: true });
    if (access.role === "owner") throw new TogetherError("ownerCannotLeave", 409);
    await q(`delete from together_members where board_id = $1 and user_id = $2`, [access.boardId, userId]);
    await q(`update together_invitations set revoked_at = now()
      where board_id = $1 and invited_by = $2 and accepted_at is null and revoked_at is null`,
      [access.boardId, userId]);
  });
}
