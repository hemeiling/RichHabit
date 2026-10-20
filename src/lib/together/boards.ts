import { query } from "@/lib/db/pool";
import { isUuid } from "@/lib/http";
import type { Locale } from "@/lib/i18n";
import {
  AUTHORIZED, DISPLAY_NAME, OPEN, TogetherError, USABLE, addressedTo, mayInvite, peopleOf, requireAccess, requireBoard,
  togetherLive,
  type BoardRole, type PersonView, type TogetherAccess,
} from "@/lib/together/access";
import {
  MAX_EMAILS_PER_CREATE, cleanEmail, cleanPeople, createInvitation, insertPeopleInvitations, lockBoard, pendingFor,
  withdrawInvitationsFor, type PendingInvitation,
} from "@/lib/together/invitations";
import {
  collaboratorsOf, pendingConnectionsFor, sentConnectionsBy, type SentConnection,
} from "@/lib/together/connections";
import { togetherTransaction as transaction } from "@/lib/together/tx";

/**
 * Together V1A — boards and membership.
 *
 * Membership is only ever created by accepting an invitation (invitations.ts),
 * except for the owner, who creates the board. "People" — the accounts you
 * share a board with — are whom you can invite in-platform, never whom you can
 * enroll.
 *
 * Nothing here reads any private RichHabit table. Another member is known by an
 * id and a display name (`DISPLAY_NAME`) — never an email address.
 */

export const MAX_BOARD_NAME = 80;
/** A guard against runaway creation, far above any real use. */
export const MAX_BOARDS_OWNED = 100;

export type { PersonView };
export interface BoardSummary {
  id: string;
  name: string;
  role: BoardRole;
  archived: boolean;
  members: PersonView[];
}
/** Something waiting for this account: a space invitation, or a collaborator request. */
export type HomeInvitation =
  | ({ kind: "space" } & PendingInvitation)
  | { kind: "connection"; id: string; inviter: string; expiresAt: string };
export interface HomeView {
  /** "invited": may use the boards it is on, but not create boards or invite to them. */
  access: TogetherAccess;
  boards: BoardSummary[];
  /** People one tick can name when inviting to a space (full access only):
   *  co-members and collaborators, deduplicated. */
  people: PersonView[];
  /** Accepted collaborator connections — every tier manages its own. */
  collaborators: PersonView[];
  /** This account's own open collaborator requests, withdrawable. */
  sentConnections: SentConnection[];
  /** Everything waiting for this account, requests before rooms. */
  invitations: HomeInvitation[];
}

export function cleanBoardName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new TogetherError("nameRequired");
  if (name.length > MAX_BOARD_NAME) throw new TogetherError("nameTooLong");
  return name;
}

/** How many board shortcuts the sidebar shows; Overview lists them all. */
export const SIDEBAR_BOARDS = 5;

/**
 * The sidebar's Together shortcuts: this account's ACTIVE boards — owned or
 * joined — by name (the same order as the overview's tiles, so the sidebar
 * shows the overview's first few), and how many there are. Ids and names only:
 * the same names the Together home already shows this account. Navigation
 * only; opening a board is still decided by requireBoard. The caller (the app
 * layout) asks only for accounts with Together access.
 */
export async function sidebarBoards(userId: string): Promise<{ boards: { id: string; name: string }[]; total: number }> {
  if (!togetherLive()) return { boards: [], total: 0 };
  const rows = await query<{ id: string; name: string; total: number }>(
    `select b.id::text as id, b.name, count(*) over ()::int as total
       from together_members m join together_boards b on b.id = m.board_id
      where m.user_id = $1 and b.archived_at is null
      order by lower(b.name), b.name, b.id
      limit $2`, [userId, SIDEBAR_BOARDS]);
  return { boards: rows.map(({ id, name }) => ({ id, name })), total: rows[0]?.total ?? 0 };
}

export async function loadHome(userId: string): Promise<HomeView> {
  const access = await requireAccess(userId);
  const boards = await query<BoardSummary>(
    `select b.id::text as id, b.name, mine.role, b.archived_at is not null as archived,
            (select coalesce(json_agg(json_build_object('id', u.id::text, 'name', ${DISPLAY_NAME})
                     order by m.joined_at, m.user_id), '[]'::json)
               from together_members m join users u on u.id = m.user_id
               left join profiles p on p.id = u.id
              where m.board_id = b.id) as members
       from together_members mine join together_boards b on b.id = mine.board_id
      where mine.user_id = $1
      order by b.archived_at is not null, lower(b.name), b.name, b.id`, [userId]);
  const [peers, collaborators, sentConnections, spaceInvitations, connectionRequests] = await Promise.all([
    access === "full" ? peopleOf(query, userId) : Promise.resolve([]),
    collaboratorsOf(userId),
    sentConnectionsBy(userId),
    pendingFor(userId),
    pendingConnectionsFor(userId),
  ]);
  const seen = new Set<string>();
  const people = [...collaborators, ...peers].filter((p) => !seen.has(p.id) && seen.add(p.id));
  return {
    access,
    boards,
    people: access === "full" ? people.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) : [],
    collaborators,
    sentConnections,
    invitations: [
      ...connectionRequests.map((c) => ({ kind: "connection" as const, ...c })),
      ...spaceInvitations.map((i) => ({ kind: "space" as const, ...i })),
    ],
  };
}

export interface CreatedBoard {
  id: string;
  /** People invited in-platform. */
  invited: number;
  /** Email invitations sent. */
  emailed: number;
  /** Typed addresses whose invitation could not be sent; the board exists regardless. */
  failedEmails: string[];
}

/**
 * A new board, owned by its creator. People selected get an in-platform
 * invitation and join only when they accept; typed addresses get the email
 * invitation, sent once the board exists. Full access only.
 */
export async function createBoard(
  userId: string, rawName: unknown, rawPeople: unknown, rawEmails: unknown, locale: Locale,
): Promise<CreatedBoard> {
  // Access first: outside it, every request reads as "does not exist".
  await requireAccess(userId, { full: true });
  const name = cleanBoardName(rawName);
  const people = cleanPeople(rawPeople);
  const emails = [...new Set((Array.isArray(rawEmails) ? rawEmails : []).map(cleanEmail))];
  if (emails.length > MAX_EMAILS_PER_CREATE) throw new TogetherError("tooManyPeople");

  const { id, invited } = await transaction(async (q) => {
    const [{ n }] = await q<{ n: number }>(
      `select count(*)::int n from together_members where user_id = $1 and role = 'owner'`, [userId]);
    if (n >= MAX_BOARDS_OWNED) throw new TogetherError("tooManyBoards", 409);
    const [board] = await q<{ id: string }>(
      `insert into together_boards (name, created_by) values ($1, $2) returning id::text as id`, [name, userId]);
    await q(`insert into together_members (board_id, user_id, role, added_by) values ($1, $2, 'owner', $2)`,
      [board.id, userId]);
    return { id: board.id, invited: await insertPeopleInvitations(q, board.id, userId, people) };
  });

  // Each email is its own invitation, with its own failure boundary.
  const failedEmails: string[] = [];
  for (const email of emails) {
    try {
      await createInvitation(userId, id, email, locale);
    } catch {
      failedEmails.push(email);
    }
  }
  return { id, invited, emailed: emails.length - failedEmails.length, failedEmails };
}

export interface InvitationView {
  id: string;
  kind: "email" | "person";
  /** The address (email) or display name (person). Shown only to the owner and the sender. */
  label: string;
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
  /** Whether this reader may invite (the owner, full access, board not archived). */
  canInvite: boolean;
  /** Who could be invited in-platform — accepted collaborators first, then
   *  people from the reader's other spaces — never current members. Someone
   *  already invited here (by anyone, in-app or to their proved address) is
   *  kept, marked `pending`, so the screen can say so instead of offering a
   *  duplicate. Empty unless the reader may invite. */
  invitable: InvitablePerson[];
}

export interface InvitablePerson extends PersonView {
  /** The public handle, for searching — the same one the Community board shows. */
  username: string | null;
  collaborator: boolean;
  pending: boolean;
}

export async function loadBoard(userId: string, boardId: unknown): Promise<BoardView> {
  const access = await requireBoard(query, userId, boardId);
  const [board] = await query<{ name: string }>(`select name from together_boards where id = $1`, [access.boardId]);
  const members = await query<PersonView & { role: BoardRole; joinedAt: string }>(
    `select u.id::text as id, ${DISPLAY_NAME} as name, m.role, m.joined_at as "joinedAt"
       from together_members m join users u on u.id = m.user_id
       left join profiles p on p.id = u.id
      where m.board_id = $1 order by m.role = 'owner' desc, m.joined_at, m.user_id`, [access.boardId]);
  const open = await query<InvitationView & { invitedById: string; inviteeId: string | null }>(
    `select i.id::text as id,
            case when i.invitee_id is null then 'email' else 'person' end as kind,
            coalesce(i.email_normalized,
                     (select ${DISPLAY_NAME} from users u left join profiles p on p.id = u.id where u.id = i.invitee_id)) as label,
            (select ${DISPLAY_NAME} from users u left join profiles p on p.id = u.id where u.id = i.invited_by) as "invitedBy",
            i.invited_by::text as "invitedById", i.invitee_id::text as "inviteeId", i.expires_at as "expiresAt"
       from together_invitations i
      where i.board_id = $1 and ${USABLE} and ${AUTHORIZED}
      order by i.created_at desc, i.id`, [access.boardId]);
  const visible = open.filter((i) => access.role === "owner" || i.invitedById === userId);
  const canInvite = mayInvite(userId, access.role, access.archived);
  // One directory for every space: the reader's accepted collaborators lead,
  // co-members of their other spaces follow; nobody twice, members never.
  let invitable: InvitablePerson[] = [];
  if (canInvite) {
    const memberIds = new Set(members.map((m) => m.id));
    const [collabs, peers] = await Promise.all([collaboratorsOf(userId), peopleOf(query, userId)]);
    const collabIds = new Set(collabs.map((c) => c.id));
    const seen = new Set<string>();
    const people = [...collabs, ...peers].filter((p) => !memberIds.has(p.id) && !seen.has(p.id) && seen.add(p.id));
    const ids = people.map((p) => p.id);
    // Only the reader who may invite sees this, and today that is the owner,
    // who sees every pending invitation below anyway.
    const facts = ids.length ? await query<{ id: string; username: string | null; pending: boolean }>(
      `select p.id::text as id, u.username,
              exists (select 1 from together_invitations i
                       where i.board_id = $1 and ${addressedTo("p.id")} and ${USABLE} and ${AUTHORIZED}) as pending
         from unnest($2::uuid[]) as p(id) join users u on u.id = p.id`,
      [access.boardId, ids]) : [];
    const byId = new Map(facts.map((f) => [f.id, f]));
    invitable = people
      .map((p) => ({ ...p, username: byId.get(p.id)?.username ?? null,
        collaborator: collabIds.has(p.id), pending: byId.get(p.id)?.pending ?? false }))
      .sort((a, b) => Number(b.collaborator) - Number(a.collaborator)
        || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }
  return {
    id: access.boardId, name: board.name, role: access.role, archived: access.archived, members,
    invitations: visible.map(({ invitedById: _a, inviteeId: _b, ...i }) => i),
    otherInvitations: open.length - visible.length,
    canInvite,
    invitable,
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

/**
 * The owner removes someone. Access ends at once. Their open invitations on this
 * board go with them (someone no longer on a board must not bring others onto
 * it), and so does any older invitation *for* them, so only a new invitation,
 * accepted, brings them back.
 */
export async function removeMember(userId: string, boardId: unknown, targetId: unknown): Promise<void> {
  if (!isUuid(targetId)) throw new TogetherError("notFound", 404);
  if (targetId === userId) throw new TogetherError("cannotRemoveSelf");
  await transaction(async (q) => {
    const access = await requireBoard(q, userId, boardId, { owner: true, lock: true });
    await lockBoard(q, access.boardId);
    const gone = await q(`delete from together_members where board_id = $1 and user_id = $2 returning user_id`,
      [access.boardId, targetId]);
    if (!gone.length) throw new TogetherError("notFound", 404);
    await q(`update together_invitations set revoked_at = now()
      where board_id = $1 and invited_by = $2 and ${OPEN}`,
      [access.boardId, targetId]);
    await withdrawInvitationsFor(q, access.boardId, targetId);
  });
}

/** What a deleted space held — counts only, for the audit event; never a name or any text. */
export interface DeletedBoard { members: number; tasks: number; groups: number; invitations: number }

/**
 * The owner deletes a space for good — the one board action that cannot be
 * undone, so the space's name, typed, is checked here as well as on screen: a
 * stray or replayed request without it deletes nothing.
 *
 * What goes is decided by the schema, not by this function: memberships,
 * invitations, groups and tasks all reference the board `on delete cascade`,
 * and assignments cascade from the tasks and memberships. Nothing outside the
 * space refers to a board — no account, no personal RichHabit table, no other
 * space, no collaborator link (those are between people) — so deleting the one
 * row can take nothing else with it.
 *
 * The owner's membership row is locked first (as every owner action does), then
 * the board. A second request racing this one waits on that lock and then finds
 * no membership: "not found", never a second deletion and never a 500.
 */
export async function deleteBoard(userId: string, boardId: unknown, confirmName: unknown): Promise<DeletedBoard> {
  return transaction(async (q) => {
    const access = await requireBoard(q, userId, boardId, { owner: true, lock: true });
    await lockBoard(q, access.boardId);
    const [board] = await q<{ name: string }>(`select name from together_boards where id = $1`, [access.boardId]);
    const same = (s: string) => s.trim().normalize("NFC");
    if (typeof confirmName !== "string" || same(confirmName) !== same(board.name)) {
      throw new TogetherError("confirmMismatch");
    }
    const [held] = await q<DeletedBoard>(
      `select (select count(*)::int from together_members where board_id = $1) as members,
              (select count(*)::int from together_tasks where board_id = $1) as tasks,
              (select count(*)::int from together_groups where board_id = $1) as groups,
              (select count(*)::int from together_invitations where board_id = $1) as invitations`,
      [access.boardId]);
    await q(`delete from together_boards where id = $1`, [access.boardId]);
    return held;
  });
}

/** A member leaves. The owner cannot (V1 has no ownership transfer); they archive instead. */
export async function leaveBoard(userId: string, boardId: unknown): Promise<void> {
  await transaction(async (q) => {
    const access = await requireBoard(q, userId, boardId, { lock: true });
    if (access.role === "owner") throw new TogetherError("ownerCannotLeave", 409);
    await lockBoard(q, access.boardId);
    await q(`delete from together_members where board_id = $1 and user_id = $2`, [access.boardId, userId]);
    await q(`update together_invitations set revoked_at = now()
      where board_id = $1 and invited_by = $2 and ${OPEN}`,
      [access.boardId, userId]);
    await withdrawInvitationsFor(q, access.boardId, userId);
  });
}
