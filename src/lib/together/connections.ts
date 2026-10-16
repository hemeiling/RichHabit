import { createHash, randomBytes } from "node:crypto";
import { query } from "@/lib/db/pool";
import { sendMail } from "@/lib/email/send";
import { connectionInviteEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/env";
import { isUuid } from "@/lib/http";
import { isLocale, type Locale } from "@/lib/i18n";
import { isPlausibleEmail, normaliseEmail } from "@/lib/identity";
import { isSchemaBehind } from "@/lib/db/diagnose";
import {
  DISPLAY_NAME, OPEN, TogetherError, USABLE, addressedTo, requireAccess, togetherLive,
  type PersonView,
} from "@/lib/together/access";
import { togetherTransaction as transaction } from "@/lib/together/tx";
import { maskEmail } from "@/lib/together/invitations";

/**
 * Global collaborators: connect with a person once, invite them to any space
 * afterwards without retyping anything.
 *
 * A **connection** is the accepted, symmetric relationship — one row, smaller
 * id first. It grants NO space access and reveals nothing beyond the display
 * name the Community board already shows: it only makes the other person easy
 * to invite. Removing it deletes that one row; memberships, tasks and open
 * space invitations are untouched, by design.
 *
 * A **connection invitation** follows the space invitation's grammar exactly:
 * two kinds (in-platform by id, email by token), pending until answered, at
 * most one of accepted/declined/revoked, one open per inviter and person,
 * answered only by the account it addresses (`addressedTo` — the same proved-
 * address rule, cutoff included). Nobody becomes a collaborator without
 * accepting; the one asymmetry is mutuality: inviting someone whose own
 * request to you is already waiting simply accepts it, because both halves of
 * the handshake exist.
 *
 * **Who may do this:** anyone Together admits at all — the preview list OR
 * the invited tier. Managing your own connections is not an administrative
 * power; creating spaces and inviting members to them keep their existing,
 * stricter rules.
 *
 * **Before the migration** (this code can deploy first): every reader here
 * answers "none" instead of failing, so Together behaves exactly as the
 * previous release until the tables exist.
 */

const TOKEN_BYTES = 32;
export const CONNECTION_TTL_DAYS = 14;
export const MAX_CONNECTIONS = 500;
export const MAX_CONNECTION_INVITES_PER_DAY = 50;
export const MAX_CONNECTION_EMAILS_PER_DAY = 20;
export const MAX_OPEN_CONNECTION_INVITES = 50;
export const CONNECTION_DECLINE_QUIET_DAYS = 7;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
export const connectionInviteUrl = (token: string) =>
  `${appUrl()}/together/invite#c=${encodeURIComponent(token)}`;

/** Test seam, like the space invitations'. */
let send: typeof sendMail = sendMail;
export function setConnectionSenderForTests(fn: typeof sendMail | null) { send = fn ?? sendMail; }

type Q = typeof query;

const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]);

/** Columns of `together_connection_invitations i`: open, usable, addressed. */
const I = "together_connection_invitations";

/**
 * A connection invitation waiting for account `$1`: usable, addressed to it,
 * from an inviter it is not already connected to.
 */
export const CONNECTION_WAITING = `${addressedTo("$1")} and ${USABLE} and i.invited_by <> $1
   and not exists (select 1 from together_connections c
     where c.user_low = least(i.invited_by, $1) and c.user_high = greatest(i.invited_by, $1))`;

/** Readers answer "none" until the migration has run. */
async function tolerant<T>(fallback: T, read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch (e) { if (isSchemaBehind(e)) return fallback; throw e; }
}

/** Accepted collaborators, by display name. */
export async function collaboratorsOf(userId: string, q: Q = query): Promise<PersonView[]> {
  return tolerant([], () => q<PersonView>(
    `select u.id::text as id, ${DISPLAY_NAME} as name
       from together_connections c
       join users u on u.id = case when c.user_low = $1 then c.user_high else c.user_low end
       left join profiles p on p.id = u.id
      where c.user_low = $1 or c.user_high = $1
      order by name, id`, [userId]));
}

export const isConnected = async (q: Q, a: string, b: string): Promise<boolean> => {
  const [low, high] = pair(a, b);
  const rows = await q(`select 1 from together_connections where user_low = $1 and user_high = $2`, [low, high]);
  return rows.length > 0;
};

export interface PendingConnection { id: string; inviter: string; expiresAt: string }

/** Incoming requests waiting for this account — the bell's and home's cards. */
export async function pendingConnectionsFor(userId: string, q: Q = query): Promise<PendingConnection[]> {
  return tolerant([], () => q<PendingConnection>(
    `select id, inviter, "expiresAt" from (
       select distinct on (i.invited_by)
              i.id::text as id, ${DISPLAY_NAME} as inviter, i.expires_at as "expiresAt", i.created_at
         from ${I} i
         join users u on u.id = i.invited_by
         left join profiles p on p.id = u.id
        where ${CONNECTION_WAITING}
        order by i.invited_by, i.created_at desc, i.id
     ) w order by created_at desc, id`, [userId]));
}

export async function pendingConnectionCount(userId: string): Promise<number> {
  return tolerant(0, async () => {
    const [{ n }] = await query<{ n: number }>(
      `select count(distinct i.invited_by)::int n from ${I} i where ${CONNECTION_WAITING}`, [userId]);
    return n;
  });
}

/** Whether this account holds any open addressed connection request — one of
 *  the things that admits it to Together at all. */
export async function hasWaitingConnection(userId: string, q: Q = query): Promise<boolean> {
  return tolerant(false, async () => {
    const rows = await q(`select 1 from ${I} i where ${CONNECTION_WAITING} limit 1`, [userId]);
    return rows.length > 0;
  });
}

export interface SentConnection {
  id: string;
  kind: "email" | "person";
  /** The display name, or the address the sender typed — their own knowledge. */
  label: string;
  expiresAt: string;
}

/** This account's own open requests, for the People section's pending list. */
export async function sentConnectionsBy(userId: string): Promise<SentConnection[]> {
  return tolerant([], () => query<SentConnection>(
    `select i.id::text as id,
            case when i.invitee_id is null then 'email' else 'person' end as kind,
            coalesce(i.email_normalized,
                     (select ${DISPLAY_NAME} from users u left join profiles p on p.id = u.id
                       where u.id = i.invitee_id)) as label,
            i.expires_at as "expiresAt"
       from ${I} i
      where i.invited_by = $1 and ${USABLE}
        and not exists (select 1 from together_connections c
          where c.user_low = least(i.invited_by, coalesce(i.invitee_id, i.invited_by))
            and c.user_high = greatest(i.invited_by, coalesce(i.invitee_id, i.invited_by)))
      order by i.created_at desc, i.id`, [userId]));
}

/** Serializes one account's connection writes, for limits and mutual answers. */
const lockAccount = (q: Q, userId: string) =>
  q(`select pg_advisory_xact_lock(hashtext('together-connect:' || $1))`, [userId]);

async function requireRoom(q: Q, userId: string): Promise<void> {
  const [{ connections, open }] = await q<{ connections: number; open: number }>(
    `select (select count(*)::int from together_connections where user_low = $1 or user_high = $1) as connections,
            (select count(*)::int from ${I} i where i.invited_by = $1 and ${USABLE}) as open`, [userId]);
  if (connections >= MAX_CONNECTIONS) throw new TogetherError("tooManyConnections", 409);
  if (open >= MAX_OPEN_CONNECTION_INVITES) throw new TogetherError("tooManyOpenInvites", 409);
}

async function withinDaily(q: Q, userId: string, email: boolean): Promise<void> {
  const [{ n }] = await q<{ n: number }>(
    `select count(*)::int n from ${I}
      where invited_by = $1 and ${email ? "email_normalized is not null" : "invitee_id is not null"}
        and created_at > now() - interval '24 hours'`, [userId]);
  if (n >= (email ? MAX_CONNECTION_EMAILS_PER_DAY : MAX_CONNECTION_INVITES_PER_DAY)) {
    throw new TogetherError("tooManyInvites", 429);
  }
}

export type ConnectOutcome = { invited: number; connected: boolean };

/**
 * Request a connection with a registered account, by public username. The
 * same honesty as space invitations: an unknown username is said plainly
 * (usernames are public handles); everything about addresses stays silent.
 * If that person's own request to you is already waiting, this accepts it.
 */
export async function inviteCollaboratorByUsername(userId: string, rawUsername: unknown): Promise<ConnectOutcome> {
  await requireAccess(userId);   // any tier: one's own connections are one's own
  const username = typeof rawUsername === "string" ? rawUsername.trim().toLowerCase() : "";
  if (!username || username.length > 254 || /\s/.test(username)) throw new TogetherError("usernameUnknown", 404);
  return transaction(async (q) => {
    const [target] = await q<{ id: string }>(
      `select id::text as id from users where lower(username) = $1`, [username]);
    if (!target) throw new TogetherError("usernameUnknown", 404);
    return requestConnection(q, userId, target.id);
  });
}

/** The shared in-platform core: both accounts resolved and alive. */
async function requestConnection(q: Q, userId: string, targetId: string): Promise<ConnectOutcome> {
  if (targetId === userId) return { invited: 0, connected: false };
  const [low, high] = pair(userId, targetId);
  await lockAccount(q, low);
  await lockAccount(q, high);
  if (await isConnected(q, userId, targetId)) return { invited: 0, connected: true };

  // Mutuality: their request to me is the other half of this handshake.
  const theirs = await q<{ id: string }>(
    `select i.id from ${I} i
      where i.invited_by = $1 and ${addressedTo("$2")} and ${USABLE} for update of i`,
    [targetId, userId]);
  if (theirs.length) {
    await q(`insert into together_connections (user_low, user_high) values ($1, $2)
             on conflict do nothing`, [low, high]);
    await q(`update ${I} set accepted_at = now(), accepted_by = $2 where id = $1`, [theirs[0].id, userId]);
    await closeOpenBetween(q, userId, targetId);
    return { invited: 0, connected: true };
  }

  // My own open request, or their recent decline of me: nothing new, quietly.
  const blocked = await q(
    `select 1 from ${I} i
      where i.invited_by = $1
        and (i.invitee_id = $2 or i.email_normalized = (select lower(email) from users where id = $2))
        and (${USABLE} or i.declined_at > now() - ($3 || ' days')::interval)
      limit 1`,
    [userId, targetId, String(CONNECTION_DECLINE_QUIET_DAYS)]);
  if (blocked.length) return { invited: 0, connected: false };

  await requireRoom(q, userId);
  await withinDaily(q, userId, false);
  await q(`insert into ${I} (invited_by, invitee_id, sent_at, expires_at)
           values ($1, $2, now(), now() + ($3 || ' days')::interval)`,
    [userId, targetId, String(CONNECTION_TTL_DAYS)]);
  return { invited: 1, connected: false };
}

/** Every open request between two people, both directions — spent or stale. */
async function closeOpenBetween(q: Q, a: string, b: string): Promise<void> {
  await q(`update ${I} i set revoked_at = now()
    where ${OPEN}
      and ((i.invited_by = $1 and (i.invitee_id = $2 or i.email_normalized = (select lower(email) from users where id = $2)))
        or (i.invited_by = $2 and (i.invitee_id = $1 or i.email_normalized = (select lower(email) from users where id = $1))))`,
    [a, b]);
}

/**
 * Request a connection by email. Always an email, whatever the address is, so
 * the asker learns nothing — and when the address belongs to an account with
 * a proved address, the same request also waits in that account's bell. The
 * send follows the space invitations' failure discipline exactly: commit
 * unsent, send, then activate, so a reported failure is never usable.
 */
export async function inviteCollaboratorByEmail(
  userId: string, rawEmail: unknown, inviterLocale: Locale,
): Promise<{ id: string }> {
  await requireAccess(userId);
  const email = normaliseEmail(typeof rawEmail === "string" ? rawEmail : "");
  if (!isPlausibleEmail(email) || email.length > 254) throw new TogetherError("emailInvalid");

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const created = await transaction(async (q) => {
    await lockAccount(q, userId);
    // One's own address: answer as if sent; there is nothing true to say.
    const [self] = await q<{ me: boolean }>(
      `select lower(email) = $2 as me from users where id = $1`, [userId, email]);
    if (self?.me) return null;
    // Already connected to the holder of this address: equally, nothing to do —
    // but saying so would reveal the address has an account. Pretend-send.
    const [held] = await q<{ other: string }>(
      `select u.id::text as other from users u where lower(u.email) = $1`, [email]);
    if (held && await isConnected(q, userId, held.other)) return null;

    await withinDaily(q, userId, true);
    await q(`update ${I} set revoked_at = now()
      where invited_by = $1 and email_normalized = $2 and ${OPEN}`, [userId, email]);
    await requireRoom(q, userId);
    const [row] = await q<{ id: string; inviter: string; locale: string | null }>(
      `insert into ${I} (invited_by, email_normalized, token_hash, expires_at)
       values ($1, $2, $3, now() + ($4 || ' days')::interval)
       returning id::text as id,
         (select ${DISPLAY_NAME} from users u left join profiles p on p.id = u.id where u.id = $1) as inviter,
         (select up.locale from users u2 join user_preferences up on up.user_id = u2.id
           where lower(u2.email) = $2 limit 1) as locale`,
      [userId, email, hash(token), String(CONNECTION_TTL_DAYS)]);
    return row;
  });
  if (!created) return { id: "sent" };

  const locale: Locale = isLocale(created.locale) ? created.locale : inviterLocale;
  const withdraw = () => query(`update ${I} set revoked_at = now() where id = $1 and ${OPEN}`,
    [created.id]).catch(() => {});
  try {
    await send({ to: email, ...connectionInviteEmail(locale, connectionInviteUrl(token), created.inviter, CONNECTION_TTL_DAYS) });
  } catch (e) {
    await withdraw();
    console.error("[together] connection email failed:", e instanceof Error ? e.name : "error");
    throw new TogetherError("sendFailed", 502);
  }
  let activated: unknown[];
  try {
    activated = await query(`update ${I} set sent_at = now() where id = $1 and ${OPEN} returning id`, [created.id]);
  } catch { await withdraw(); throw new TogetherError("sendFailed", 502); }
  if (!activated.length) throw new TogetherError("sendFailed", 502);
  return { id: created.id };
}

/** Accept or decline a request addressed to this account, in-app. */
export async function respondToConnection(
  userId: string, inviteId: unknown, accept: unknown,
): Promise<{ connected: boolean }> {
  if (!togetherLive() || !isUuid(inviteId)) throw new TogetherError("invitationInvalid", 404);
  if (typeof accept !== "boolean") throw new TogetherError("invitationInvalid", 400);
  return transaction(async (q) => {
    const [inv] = await q<{ id: string; invited_by: string }>(
      `select i.id, i.invited_by::text from ${I} i
        where i.id = $1 and ${addressedTo("$2")} and ${USABLE} for update of i`,
      [inviteId, userId]);
    if (!inv || inv.invited_by === userId) throw new TogetherError("invitationInvalid", 404);
    const alive = await q(`select id from users where id = any($1::uuid[]) order by id for key share`,
      [[inv.invited_by, userId]]);
    if (alive.length !== 2) throw new TogetherError("invitationInvalid", 404);
    const [low, high] = pair(inv.invited_by, userId);
    await lockAccount(q, low);
    await lockAccount(q, high);
    if (accept) {
      await q(`insert into together_connections (user_low, user_high) values ($1, $2)
               on conflict do nothing`, [low, high]);
      await q(`update ${I} set accepted_at = now(), accepted_by = $2 where id = $1`, [inv.id, userId]);
      await closeOpenBetween(q, inv.invited_by, userId);
      return { connected: true };
    }
    await q(`update ${I} i set declined_at = now()
      where i.invited_by = $1 and ${addressedTo("$2")} and ${OPEN}`, [inv.invited_by, userId]);
    return { connected: false };
  });
}

/** Withdraw one of this account's own open requests. */
export async function revokeConnectionInvitation(userId: string, inviteId: unknown): Promise<void> {
  await requireAccess(userId);
  if (!isUuid(inviteId)) throw new TogetherError("notFound", 404);
  const done = await query(
    `update ${I} set revoked_at = now() where id = $1 and invited_by = $2 and ${OPEN} returning id`,
    [inviteId, userId]);
  if (!done.length) throw new TogetherError("notFound", 404);
}

/**
 * Remove a collaborator: the one row, and any open requests between the two,
 * so nothing reconnects them without a fresh, accepted invitation. Space
 * memberships, tasks and space invitations are deliberately untouched.
 */
export async function removeCollaborator(userId: string, otherId: unknown): Promise<void> {
  await requireAccess(userId);
  if (!isUuid(otherId) || otherId === userId) throw new TogetherError("notFound", 404);
  await transaction(async (q) => {
    const [low, high] = pair(userId, otherId as string);
    await lockAccount(q, low);
    await lockAccount(q, high);
    const gone = await q(
      `delete from together_connections where user_low = $1 and user_high = $2 returning user_low`, [low, high]);
    if (!gone.length) throw new TogetherError("notFound", 404);
    await closeOpenBetween(q, userId, otherId as string);
  });
}

export type ConnectionPreview =
  | { status: "ok"; inviter: string; to: string; forYou: boolean | null }
  | { status: "invalid" };

/** What the holder of a connection token may learn before accepting. */
export async function previewConnection(token: unknown, viewerId: string | null = null): Promise<ConnectionPreview> {
  if (!togetherLive() || typeof token !== "string" || !TOKEN_SHAPE.test(token)) return { status: "invalid" };
  const viewer = isUuid(viewerId) ? viewerId : null;
  return tolerant({ status: "invalid" } as ConnectionPreview, async () => {
    const [row] = await query<{ inviter: string; email: string; for_you: boolean | null }>(
      `select ${DISPLAY_NAME} as inviter, i.email_normalized as email,
              i.email_normalized = (select lower(v.email) from users v where v.id = $2::uuid) as for_you
         from ${I} i join users u on u.id = i.invited_by left join profiles p on p.id = u.id
        where i.token_hash = $1 and ${USABLE}`, [hash(token), viewer]);
    if (!row) return { status: "invalid" };
    return { status: "ok", inviter: row.inviter, to: maskEmail(row.email),
      forYou: viewer ? row.for_you === true : null };
  });
}

/** Accept an emailed connection request: token plus the matching address. */
export async function acceptConnection(userId: string, token: unknown): Promise<{ connected: boolean }> {
  if (!togetherLive() || typeof token !== "string" || !TOKEN_SHAPE.test(token)) {
    throw new TogetherError("invitationInvalid", 404);
  }
  return transaction(async (q) => {
    const [inv] = await q<{ id: string; invited_by: string; email: string }>(
      `select i.id, i.invited_by::text, i.email_normalized as email
         from ${I} i where i.token_hash = $1 and ${USABLE} for update of i`, [hash(token)]);
    if (!inv || inv.invited_by === userId) throw new TogetherError("invitationInvalid", 404);
    const [me] = await q<{ email: string | null }>(`select lower(email) as email from users where id = $1`, [userId]);
    if (!me?.email || me.email !== inv.email) throw new TogetherError("wrongAccount", 403);
    const alive = await q(`select id from users where id = any($1::uuid[]) order by id for key share`,
      [[inv.invited_by, userId]]);
    if (alive.length !== 2) throw new TogetherError("invitationInvalid", 404);
    const [low, high] = pair(inv.invited_by, userId);
    await lockAccount(q, low);
    await lockAccount(q, high);
    await q(`insert into together_connections (user_low, user_high) values ($1, $2) on conflict do nothing`,
      [low, high]);
    await q(`update ${I} set accepted_at = now(), accepted_by = $2 where id = $1`, [inv.id, userId]);
    await closeOpenBetween(q, inv.invited_by, userId);
    return { connected: true };
  });
}
