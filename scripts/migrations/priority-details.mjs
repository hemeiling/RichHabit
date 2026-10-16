/**
 * ---- Priority details: description, links, attachments ---------------------
 *
 * Additive only. Two columns on `priorities`, both with harmless defaults so
 * every existing row is valid untouched, and one new table. No row is read,
 * rewritten or deleted; no existing column, constraint or index changes.
 *
 *   priorities.description   optional notes, as written, up to 5000 chars.
 *   priorities.links         optional list of {url, label}, at most 10. JSONB
 *                            because it is a small ordered list the row owns
 *                            whole — never queried across rows.
 *   priority_attachments     optional files, stored as bytes in the row like
 *                            the AI Workspace's files table: the server decides the type from the
 *                            bytes, a CHECK pins size to what was declared,
 *                            and deleting the priority (or the account)
 *                            cascades the bytes away. Retention policy: an
 *                            attachment lives exactly as long as its priority
 *                            and its owner, and not one moment longer; there
 *                            are no tombstones and nothing to purge later.
 *
 * db/schema.sql carries the same statements for fresh installs;
 * tests/priority-details-migration.test.ts proves both match. Runner step 20,
 * after the Together email-index (18) and collaborators (19).
 */

export const PRIORITY_DETAILS_STATEMENTS = [
  `alter table priorities add column if not exists description text not null default ''
    constraint priorities_description_length check (length(description) <= 5000)`,
  `alter table priorities add column if not exists links jsonb not null default '[]'
    constraint priorities_links_list check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 10)`,
  `create table if not exists priority_attachments (
    id                 uuid primary key default gen_random_uuid(),
    user_id            uuid not null references users on delete cascade,
    priority_id        uuid not null references priorities on delete cascade,
    -- As uploaded, after removing control characters and path separators.
    original_filename  text not null check (length(original_filename) between 1 and 255),
    kind               text not null check (kind in ('pdf', 'image', 'text')),
    -- Decided by the server from the bytes, never taken from the browser.
    mime_type          text not null check (mime_type in ('application/pdf', 'image/png',
                         'image/jpeg', 'image/gif', 'image/webp', 'text/plain')),
    byte_size          integer not null check (byte_size between 1 and 5242880),
    sha256             text not null check (sha256 ~ '^[0-9a-f]{64}$'),
    content            bytea not null check (octet_length(content) = byte_size),
    created_at         timestamptz not null default now()
  )`,
  `create index if not exists priority_attachments_priority
    on priority_attachments (priority_id)`,
  `create index if not exists priority_attachments_user
    on priority_attachments (user_id)`,
];

async function columnExists(client, column) {
  const { rows } = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'priorities' and column_name = $1`, [column]);
  return rows.length > 0;
}

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`, [table]);
  return rows.length > 0;
}

export async function migratePriorityDetails(client, log = () => {}) {
  if (!(await tableExists(client, "priorities"))) return 0;
  let changed = 0;
  const hadDescription = await columnExists(client, "description");
  const hadLinks = await columnExists(client, "links");
  const hadTable = await tableExists(client, "priority_attachments");
  for (const statement of PRIORITY_DETAILS_STATEMENTS) await client.query(statement);
  if (!hadDescription) { log("  added priorities.description"); changed++; }
  if (!hadLinks) { log("  added priorities.links"); changed++; }
  if (!hadTable) { log("  created priority_attachments"); changed++; }
  return changed;
}
