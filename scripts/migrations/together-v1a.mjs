/**
 * ---- 15. Together V1A: boards, membership, invitations ----------------------
 *
 * Three new tables and one trigger on `users`. Nothing that exists is altered,
 * rewritten or backfilled; every existing account and row is untouched.
 *
 *   together_boards       a shared workspace. `created_by` is an audit fact and
 *                         is set null when that account goes — ownership lives
 *                         in membership, never here.
 *   together_members      who belongs to a board, as owner or member. Exactly
 *                         one owner per board (a unique partial index).
 *   together_invitations  an invitation to one board, of one of two kinds:
 *                         by EMAIL (an address and the SHA-256 of a single-use
 *                         token; usable only once `sent_at` is set, after the
 *                         mail provider accepted the message) or IN-PLATFORM (an
 *                         existing account from the inviter's People, shown
 *                         inside Together). Either way nobody becomes a member
 *                         until they accept (src/lib/together/invitations.ts).
 *
 * The trigger: shared boards must survive their owner's account deletion, by
 * every path that deletes accounts (the admin screen, its bulk action and the
 * prune script all run `delete from users`). Before a user row is deleted, each
 * board it owns is handed to the longest-standing remaining member — or, when
 * nobody else remains, deleted, because it is no longer shared with anyone.
 * "Remaining" excludes accounts already deleted earlier in the same statement:
 * a row-level BEFORE trigger sees the rows its statement has already processed,
 * so joining `users` is what keeps a bulk delete from handing a board to someone
 * who is also being deleted. Concurrent deletions are made safe by locking: the
 * departing account's memberships first (so a promotion committed meanwhile is
 * seen), then the heir's row (so an heir being deleted meanwhile is skipped).
 * The invariant: a board with members always has exactly one owner. In two
 * narrow shapes (cross-owned boards; a bulk delete of an owner and the heir's
 * inviter racing the heir's deletion) two administrative deletions can still
 * deadlock; PostgreSQL aborts one, which changes nothing and can be retried.
 *
 * Idempotent: tables and indexes `if not exists`, the function `or replace`, the
 * trigger only if absent. db/schema.sql carries the same statements for fresh
 * installs; tests/together-migration.test.ts proves both match and that every
 * existing table and row comes through unchanged.
 */

export const TOGETHER_V1A_TABLES = ["together_boards", "together_members", "together_invitations"];

export const TOGETHER_V1A_STATEMENTS = [
  `create table if not exists together_boards (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 80),
  created_by  uuid references users on delete set null,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
)`,
  `create table if not exists together_members (
  board_id  uuid not null references together_boards on delete cascade,
  user_id   uuid not null references users on delete cascade,
  role      text not null check (role in ('owner','member')),
  added_by  uuid references users on delete set null,
  joined_at timestamptz not null default now(),
  primary key (board_id, user_id)
)`,
  `create unique index if not exists together_members_one_owner
  on together_members (board_id) where role = 'owner'`,
  `create index if not exists together_members_user_idx on together_members (user_id)`,
  `create table if not exists together_invitations (
  id               uuid primary key default gen_random_uuid(),
  board_id         uuid not null references together_boards on delete cascade,
  email_normalized text check (length(email_normalized) between 3 and 254),
  token_hash       text unique,
  invitee_id       uuid references users on delete cascade,
  invited_by       uuid not null references users on delete cascade,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  accepted_by      uuid references users on delete set null,
  declined_at      timestamptz,
  revoked_at       timestamptz,
  check ((email_normalized is null) = (token_hash is null)),
  check ((email_normalized is null) <> (invitee_id is null)),
  check (num_nonnulls(accepted_at, declined_at, revoked_at) <= 1)
)`,
  // At most one open invitation per board, invitee and inviter: a retry
  // replaces the inviter's own, and never touches another member's. Accepting
  // any of them closes the rest. The last index finds a person's own.
  `create unique index if not exists together_invitations_one_open
  on together_invitations (board_id, email_normalized, invited_by)
  where email_normalized is not null
    and accepted_at is null and declined_at is null and revoked_at is null`,
  `create unique index if not exists together_invitations_one_open_person
  on together_invitations (board_id, invitee_id, invited_by)
  where invitee_id is not null
    and accepted_at is null and declined_at is null and revoked_at is null`,
  `create index if not exists together_invitations_invitee
  on together_invitations (invitee_id)
  where invitee_id is not null
    and accepted_at is null and declined_at is null and revoked_at is null`,
  `create index if not exists together_invitations_inviter_time
  on together_invitations (invited_by, created_at desc)`,
  `create or replace function together_before_user_delete() returns trigger
language plpgsql as $$
declare
  owned record;
  heir  uuid;
begin
  -- Lock every membership of the departing account BEFORE reading what it owns.
  -- If another deletion is promoting this account to owner right now, this
  -- waits for it; the query below is a new statement with a fresh snapshot, so
  -- it then sees the promotion and hands the board on again. Without this, the
  -- promotion is invisible here and the cascade deletes the new owner's row,
  -- leaving a board with members and no owner.
  -- The same statement also takes the rows this deletion's cascades will change
  -- (memberships it brought about, invitations to or from it), all in one fixed
  -- order, so two deletions of linked accounts queue instead of crossing. These
  -- only lock; nothing is updated before the cascades.
  perform 1 from together_members
   where user_id = old.id or added_by = old.id
   order by board_id, user_id for update;
  perform 1 from together_invitations
   where invited_by = old.id or invitee_id = old.id or accepted_by = old.id
   order by id for update;
  for owned in
    select board_id from together_members where user_id = old.id and role = 'owner' order by board_id for update
  loop
    -- Each change here is one the cascades would make anyway: the leaving
    -- membership goes, and an added_by naming an account already deleted in
    -- this statement becomes null. Making them now keeps the promotion valid
    -- however many owners and members one statement deletes.
    delete from together_members
     where board_id = owned.board_id and user_id = old.id;
    -- The heir's row is locked, so a member whose account another transaction
    -- is deleting at this moment is waited for and then skipped; and if the
    -- promotion still finds nobody, the next member is tried. A board is never
    -- left without an owner.
    loop
      heir := null;
      select m.user_id into heir
        from together_members m
        join users u on u.id = m.user_id
       where m.board_id = owned.board_id
       order by m.joined_at, m.user_id
       limit 1
         for update of m;
      if heir is null then
        delete from together_boards where id = owned.board_id;
        exit;
      end if;
      -- added_by is cleared here when it names the departing account (the cascade
      -- would clear it at the end of the statement anyway). Leaving it for the
      -- cascade would update this row a second time in this transaction, which
      -- makes PostgreSQL re-check its user_id key against the heir's account —
      -- a lock a concurrent deletion of the heir holds: a deadlock.
      update together_members
         set role = 'owner',
             added_by = case when added_by = old.id then null
                             when exists (select 1 from users a where a.id = added_by) then added_by end
       where board_id = owned.board_id and user_id = heir;
      exit when found;
    end loop;
  end loop;
  return old;
end
$$`,
];

const TRIGGER = `create trigger together_before_user_delete
  before delete on users for each row execute function together_before_user_delete()`;

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`, [table]);
  return rows.length > 0;
}

export async function migrateTogetherV1A(client, log = () => {}) {
  if (!(await tableExists(client, "users"))) return 0;
  let changed = 0;
  const existed = {};
  for (const t of TOGETHER_V1A_TABLES) existed[t] = await tableExists(client, t);
  const { rows: fn } = await client.query(
    `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'together_before_user_delete'`);
  for (const statement of TOGETHER_V1A_STATEMENTS) await client.query(statement);
  for (const t of TOGETHER_V1A_TABLES) {
    if (!existed[t]) { log(`  created ${t}`); changed++; }
  }
  if (!fn.length) { log("  created together_before_user_delete()"); changed++; }
  const { rows: trg } = await client.query(
    `select 1 from pg_trigger where tgname = 'together_before_user_delete' and not tgisinternal`);
  if (!trg.length) {
    await client.query(TRIGGER);
    log("  created trigger together_before_user_delete on users");
    changed++;
  }
  return changed;
}

export const TOGETHER_V1A_TRIGGER = TRIGGER;
