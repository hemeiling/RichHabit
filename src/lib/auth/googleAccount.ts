import { randomBytes } from "node:crypto";
import { query, transaction } from "@/lib/db/pool";
import { withReservedSlot } from "@/lib/db/capacity";
import { isTestInstance } from "@/lib/env";
import { seedAccount } from "@/lib/seed";
import type { Locale } from "@/lib/i18n";
import { HANDSHAKE_MINUTES, sha256hex, type GoogleIdentity } from "@/lib/auth/google";

/**
 * What a verified Google identity may do to RichHabit's accounts — the three
 * doors, and nothing between them:
 *
 *   1. A `sub` already linked signs in as that account. Nothing else does.
 *   2. A `sub` whose address matches an existing account gets a PENDING LINK:
 *      the link is written only after that account proves itself with its own
 *      password. An email match alone never signs anyone in and never merges
 *      anything — matching by address is how accounts get stolen, and whether
 *      the address is verified on either side changes nothing here.
 *   3. A `sub` matching nothing gets a PENDING SIGNUP: a real registration —
 *      username, terms, the same capacity rules — finished by the person.
 *
 * A pending row is the handshake between Google's callback and that human
 * step: hashed single-use token, ten minutes, holding only what the step
 * needs. It grants nothing by itself.
 */

export type GoogleGate =
  | { kind: "signin"; userId: string; disabled: boolean }
  | { kind: "link"; token: string }
  | { kind: "signup"; token: string };

const PENDING_TTL = `${HANDSHAKE_MINUTES} minutes`;

/** Where this identity leads. The callback's one decision, in one transaction. */
export async function gateGoogleIdentity(g: GoogleIdentity): Promise<GoogleGate> {
  return transaction(async (q) => {
    const [known] = await q<{ user_id: string; disabled: boolean }>(
      `select i.user_id::text, u.disabled_at is not null as disabled
         from auth_identities i join users u on u.id = i.user_id
        where i.provider = 'google' and i.provider_user_id = $1`, [g.sub]);
    if (known) {
      await q(`update auth_identities set last_signin_at = now()
        where provider = 'google' and provider_user_id = $1`, [g.sub]);
      return { kind: "signin", userId: known.user_id, disabled: known.disabled };
    }

    const token = randomBytes(32).toString("hex");
    const [existing] = await q<{ id: string }>(
      `select id::text as id from users where lower(email) = $1`, [g.email]);
    await q(`delete from google_pending where expires_at < now()`);
    await q(
      `insert into google_pending (token_hash, purpose, provider_user_id, email_normalized,
                                   email_verified, user_id, expires_at)
       values ($1, $2, $3, $4, $5, $6, now() + interval '${PENDING_TTL}')`,
      [sha256hex(token), existing ? "link" : "signup", g.sub, g.email, g.emailVerified, existing?.id ?? null]);
    return existing ? { kind: "link", token } : { kind: "signup", token };
  });
}

export interface Pending {
  purpose: "link" | "signup";
  sub: string;
  email: string;
  emailVerified: boolean;
  userId: string | null;
}

/**
 * Spends a pending token: valid, unexpired, unused — marked used in the same
 * statement, so two racing finishes cannot both succeed.
 */
async function spendPending(q: typeof query, token: unknown, purpose: Pending["purpose"]): Promise<Pending | null> {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return null;
  const [row] = await q<{
    provider_user_id: string; email_normalized: string; email_verified: boolean; user_id: string | null;
  }>(
    `update google_pending set used_at = now()
      where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
      returning provider_user_id, email_normalized, email_verified, user_id::text`,
    [sha256hex(token), purpose]);
  return row ? {
    purpose, sub: row.provider_user_id, email: row.email_normalized,
    emailVerified: row.email_verified, userId: row.user_id,
  } : null;
}

/** What the finish screen may show. Reads without spending. */
export async function peekPending(token: unknown): Promise<Pending | null> {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return null;
  const [row] = await query<{
    purpose: "link" | "signup"; provider_user_id: string; email_normalized: string;
    email_verified: boolean; user_id: string | null;
  }>(
    `select purpose, provider_user_id, email_normalized, email_verified, user_id::text
       from google_pending where token_hash = $1 and used_at is null and expires_at > now()`,
    [sha256hex(token)]);
  return row ? {
    purpose: row.purpose, sub: row.provider_user_id, email: row.email_normalized,
    emailVerified: row.email_verified, userId: row.user_id,
  } : null;
}

/**
 * Attaches the pending Google identity to the account that just proved itself
 * with its password. `sessionUserId` must be the very account the pending row
 * was created for — signing in as anyone else spends nothing and links
 * nothing. Idempotent against the unique keys.
 */
export async function linkPendingToAccount(token: unknown, sessionUserId: string): Promise<boolean> {
  return transaction(async (q) => {
    const p = await spendPending(q, token, "link");
    if (!p || p.userId !== sessionUserId) return false;
    const linked = await q<{ id: string }>(
      `insert into auth_identities (user_id, provider, provider_user_id, email_at_link, last_signin_at)
       values ($1, 'google', $2, $3, now())
       on conflict do nothing returning id`,
      [sessionUserId, p.sub, p.email]);
    return linked.length > 0;
  });
}

/** Connect Google to the signed-in account, from Settings — same rules. */
export { linkPendingToAccount as linkFromSettings };

export type GoogleSignupRefusal = "invalid" | "usernameTaken" | "emailTaken" | "full";

/**
 * Finishes a brand-new Google registration: the same creation as password
 * sign-up — capacity through the same reserved slot, the same seeding, the
 * same terms moment — only the credential differs. Google's own attestation
 * of the address stands in for the emailed link, so a verified address starts
 * verified; an unverified one goes through RichHabit's ordinary verification
 * before the account can sign in at all.
 */
export async function finishGoogleSignup(
  token: unknown, username: string, locale: Locale,
): Promise<{ userId: string; mustVerify: boolean; email: string } | { refused: GoogleSignupRefusal }> {
  // Peeked (not spent) only to pick the capacity path; the row is immutable
  // and the spend inside decides validity once, atomically.
  const peeked = await peekPending(token);
  if (!peeked || peeked.purpose !== "signup") return { refused: "invalid" };

  const create = async (q: typeof query): Promise<{ id: string } | "badToken"> => {
    const p = await spendPending(q, token, "signup");
    if (!p) return "badToken";
    const rows = await q<{ id: string }>(
      `insert into users (email, username, password_hash, created_via, terms_accepted_at,
                          verification_required, email_verified_at)
       values ($1, $2, null, $3, now(), $4, $5) returning id`,
      [p.email, username, isTestInstance ? "test" : "google",
        !p.emailVerified, p.emailVerified ? new Date().toISOString() : null]);
    const id = rows[0].id;
    await seedAccount(q, id, locale);
    await q(
      `insert into auth_identities (user_id, provider, provider_user_id, email_at_link, last_signin_at)
       values ($1, 'google', $2, $3, now())`, [id, p.sub, p.email]);
    return { id };
  };

  try {
    /*
     * The same capacity rule as password sign-up: an account whose address is
     * already proved takes its place now, inside the reserved-slot lock; an
     * unproved one is created pending — it reserves its email and username and
     * nothing more, and the place is counted when its link is clicked.
     */
    const made = peeked.emailVerified
      ? await withReservedSlot(create)   // null = the programme is full; the token was not spent
      : await transaction(create);
    if (made === null) return { refused: "full" };
    if (made === "badToken") return { refused: "invalid" };
    return { userId: made.id, mustVerify: !peeked.emailVerified, email: peeked.email };
  } catch (e) {
    if (e instanceof Error && /users_username_idx/.test(e.message)) return { refused: "usernameTaken" };
    if (e instanceof Error && /users_email_idx/.test(e.message)) return { refused: "emailTaken" };
    throw e;
  }
}

/** The Settings card: is Google connected, and as which (masked) address. */
export async function googleConnection(userId: string): Promise<{ emailAtLink: string | null } | null> {
  const [row] = await query<{ email_at_link: string | null }>(
    `select email_at_link from auth_identities where user_id = $1 and provider = 'google'`, [userId]);
  return row ? { emailAtLink: row.email_at_link } : null;
}
