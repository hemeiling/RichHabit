/**
 * ---- Together: global collaborators -----------------------------------------
 *
 * Additive only: two new tables, nothing existing read, altered or rewritten.
 *
 *   together_connections             an accepted collaborator pair. Symmetric,
 *                                    stored once with the smaller id first.
 *                                    It grants NO space access — it only makes
 *                                    the two people easy to invite later.
 *                                    Removing one deletes this row and nothing
 *                                    else: memberships, tasks and invitations
 *                                    are untouched by design.
 *   together_connection_invitations  a pending request, pending until answered,
 *                                    with the same two kinds and the same
 *                                    answer discipline as space invitations:
 *                                    in-platform (invitee_id) or email
 *                                    (email_normalized + token_hash), at most
 *                                    one of accepted/declined/revoked, one
 *                                    open per inviter and person.
 *
 * No membership is converted into a connection: existing People stay derived
 * from shared spaces, and connections only ever come from an accepted request.
 *
 * db/schema.sql carries the same statements for fresh installs;
 * tests/together-connections-migration.test.ts proves both match.
 */

export const TOGETHER_CONNECTIONS_TABLES = ["together_connections", "together_connection_invitations"];

export const TOGETHER_CONNECTIONS_STATEMENTS = [
  `create table if not exists together_connections (
    user_low     uuid not null references users on delete cascade,
    user_high    uuid not null references users on delete cascade,
    connected_at timestamptz not null default now(),
    check (user_low < user_high),
    primary key (user_low, user_high)
  )`,
  `create index if not exists together_connections_high
    on together_connections (user_high)`,
  `create table if not exists together_connection_invitations (
    id               uuid primary key default gen_random_uuid(),
    invited_by       uuid not null references users on delete cascade,
    invitee_id       uuid references users on delete cascade,
    email_normalized text check (email_normalized is null or length(email_normalized) between 3 and 254),
    token_hash       text unique check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
    sent_at          timestamptz,
    expires_at       timestamptz not null,
    accepted_at      timestamptz,
    accepted_by      uuid references users on delete set null,
    declined_at      timestamptz,
    revoked_at       timestamptz,
    created_at       timestamptz not null default now(),
    check (num_nonnulls(accepted_at, declined_at, revoked_at) <= 1),
    check ((invitee_id is null) <> (email_normalized is null)),
    check ((email_normalized is null) = (token_hash is null))
  )`,
  `create unique index if not exists together_connection_invitations_one_open_person
    on together_connection_invitations (invited_by, invitee_id)
    where invitee_id is not null
      and accepted_at is null and declined_at is null and revoked_at is null`,
  `create unique index if not exists together_connection_invitations_one_open_email
    on together_connection_invitations (invited_by, email_normalized)
    where email_normalized is not null
      and accepted_at is null and declined_at is null and revoked_at is null`,
  `create index if not exists together_connection_invitations_invitee
    on together_connection_invitations (invitee_id)
    where invitee_id is not null
      and accepted_at is null and declined_at is null and revoked_at is null`,
  `create index if not exists together_connection_invitations_email_open
    on together_connection_invitations (email_normalized)
    where email_normalized is not null
      and accepted_at is null and declined_at is null and revoked_at is null`,
  `create index if not exists together_connection_invitations_inviter_time
    on together_connection_invitations (invited_by, created_at desc)`,
];

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`, [table]);
  return rows.length > 0;
}

/** Runs after Together V1A, whose users/boards conventions it follows. */
export async function migrateTogetherConnections(client, log = () => {}) {
  if (!(await tableExists(client, "together_boards"))) return 0;
  let changed = 0;
  for (const table of TOGETHER_CONNECTIONS_TABLES) {
    if (!(await tableExists(client, table))) { log(`  created ${table}`); changed++; }
  }
  for (const statement of TOGETHER_CONNECTIONS_STATEMENTS) await client.query(statement);
  return changed;
}
