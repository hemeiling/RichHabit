/**
 * ---- 18. Together: find email invitations by address -----------------------
 *
 * One partial index, nothing else: no table, no column, no row changes.
 *
 * Email invitations are now also shown in-app to the signed-in account whose
 * proved address they were sent to (src/lib/together/access.ts, `addressedTo`),
 * and that check runs on every signed-in page load for the waiting-invitation
 * count. The existing indexes all lead with board_id or invitee_id, so a
 * lookup by address alone had nothing to use. Open email invitations are the
 * only rows that lookup can match, which is what the predicate keeps.
 *
 * db/schema.sql carries the same statement for fresh installs;
 * tests/together-invite-email-migration.test.ts proves both match.
 */

export const TOGETHER_INVITE_EMAIL_STATEMENTS = [
  `create index if not exists together_invitations_email_open
  on together_invitations (email_normalized)
  where email_normalized is not null
    and accepted_at is null and declined_at is null and revoked_at is null`,
];

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`, [table]);
  return rows.length > 0;
}

/** Runs after step 15, which created together_invitations. */
export async function migrateTogetherInviteEmail(client, log = () => {}) {
  if (!(await tableExists(client, "together_invitations"))) return 0;
  const { rows: idx } = await client.query(
    `select 1 from pg_indexes where schemaname = 'public' and indexname = 'together_invitations_email_open'`);
  for (const statement of TOGETHER_INVITE_EMAIL_STATEMENTS) await client.query(statement);
  if (!idx.length) { log("  created index together_invitations_email_open"); return 1; }
  return 0;
}
