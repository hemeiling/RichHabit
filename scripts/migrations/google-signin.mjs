/**
 * Google sign-in — runner step 21, after priority details (20).
 *
 * Everything is additive and touches no existing row:
 *
 *   users.password_hash      — NOT NULL dropped. An account that signs in with
 *                              Google holds no password; a null hash can never
 *                              pass password sign-in (the comparison refuses
 *                              it), and such an account sets a real password
 *                              through the ordinary emailed reset. No stored
 *                              value changes.
 *   users.created_via        — its CHECK learns the value 'google'. A
 *                              constraint swap validates existing rows against
 *                              a strictly wider rule, so it cannot fail or
 *                              rewrite anything.
 *   auth_identities          — which external identity signs in as which
 *                              account. The key is the provider's permanent
 *                              subject identifier, never an email address.
 *   google_pending           — the short-lived handshake between Google's
 *                              callback and the step that needs the person's
 *                              own confirmation: linking to an existing
 *                              account (proved by its password) or finishing a
 *                              brand-new one (username + terms). Single use,
 *                              hashed token, nothing in it grants anything by
 *                              itself.
 *
 * db/schema.sql carries the same statements for fresh installs;
 * tests/google-signin-migration.test.ts proves both match.
 */

export const GOOGLE_SIGNIN_STATEMENTS = [
  `alter table users alter column password_hash drop not null`,
  `create table if not exists auth_identities (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references users on delete cascade,
    provider          text not null check (provider in ('google')),
    -- The provider's permanent subject ("sub"): the identity key. Never email.
    provider_user_id  text not null check (length(provider_user_id) between 1 and 255),
    -- The address the provider reported when this link was made. A record for
    -- the person and for support, never used to match accounts.
    email_at_link     text,
    created_at        timestamptz not null default now(),
    last_signin_at    timestamptz,
    unique (provider, provider_user_id),
    unique (user_id, provider)
  )`,
  `create table if not exists google_pending (
    token_hash        text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
    purpose           text not null check (purpose in ('link', 'signup')),
    provider_user_id  text not null check (length(provider_user_id) between 1 and 255),
    email_normalized  text not null,
    email_verified    boolean not null,
    -- For 'link': the one account this may be attached to, fixed at creation.
    user_id           uuid references users on delete cascade,
    created_at        timestamptz not null default now(),
    expires_at        timestamptz not null,
    used_at           timestamptz,
    check (purpose <> 'link' or user_id is not null)
  )`,
  `create index if not exists google_pending_expiry on google_pending (expires_at)`,
];

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`, [table]);
  return rows.length > 0;
}

export async function migrateGoogleSignin(client, log = () => {}) {
  if (!(await tableExists(client, "users"))) return 0;
  let changed = 0;

  const { rows: [hash] } = await client.query(
    `select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'users' and column_name = 'password_hash'`);
  const hadIdentities = await tableExists(client, "auth_identities");
  const hadPending = await tableExists(client, "google_pending");
  const { rows: [via] } = await client.query(
    `select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'users'::regclass and conname = 'users_created_via_check'`);
  const viaNeedsGoogle = !!via && !via.def.includes("'google'");

  for (const statement of GOOGLE_SIGNIN_STATEMENTS) await client.query(statement);

  /*
   * The CHECK swap, only when the constraint exists under its default name and
   * does not know 'google' yet. Validates existing rows against a wider rule:
   * nothing can fail, nothing is rewritten.
   */
  if (viaNeedsGoogle) {
    await client.query(`alter table users drop constraint users_created_via_check`);
    await client.query(`alter table users add constraint users_created_via_check
      check (created_via in ('self_signup', 'admin', 'test', 'google'))`);
    log("  created_via now admits 'google'");
    changed++;
  }
  if (hash?.is_nullable === "NO") { log("  users.password_hash may now be null (Google-only accounts)"); changed++; }
  if (!hadIdentities) { log("  created auth_identities"); changed++; }
  if (!hadPending) { log("  created google_pending"); changed++; }
  return changed;
}
