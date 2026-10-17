import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { google } from "@/lib/env";

/**
 * Google sign-in, server side: OpenID Connect's authorization-code flow with
 * PKCE, by full-page redirect (a popup does not survive iPhone Safari or the
 * in-app browsers people actually arrive in).
 *
 * What the rest of the app needs to know: `beginSignIn` produces the redirect
 * and the secrets that must ride short-lived cookies; `completeSignIn` turns
 * Google's callback into a verified identity — `sub`, the permanent subject
 * identifier Google promises never to reuse, plus the address and whether
 * GOOGLE says it is verified. Everything of consequence is checked here, on
 * the server: `state` against its cookie (CSRF), the code exchanged directly
 * with Google over TLS (so it was spent once, by us), the ID token's
 * signature against Google's published keys, its issuer, its audience (our
 * client id — a token minted for any other app is refused) and the `nonce`
 * baked into it (a replayed or substituted token is refused). The browser's
 * claims are never trusted: identity comes only from the validated token.
 *
 * Who signs in as whom is decided by the routes, not here: an unknown `sub`
 * never silently becomes an existing account (matching by email is how
 * accounts get stolen), and a brand-new account still passes the ordinary
 * registration rules.
 */

/** The cookie names the handshake rides on. Ten minutes, httpOnly, lax. */
export const G_STATE_COOKIE = "rh_gstate";
export const G_NONCE_COOKIE = "rh_gnonce";
export const G_PKCE_COOKIE = "rh_gpkce";
export const G_FLOW_COOKIE = "rh_gflow";
/** Carries the pending link/signup token between the callback and its finish. */
export const G_PENDING_COOKIE = "rh_gpending";
export const HANDSHAKE_MINUTES = 10;

const b64url = (buf: Buffer) => buf.toString("base64url");
export const sha256hex = (value: string) => createHash("sha256").update(value).digest("hex");

export interface Handshake {
  url: string;
  state: string;
  nonce: string;
  pkceVerifier: string;
}

/** The redirect to Google, carrying only what the flow itself requires. */
export function beginSignIn(redirectUri: string): Handshake {
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const pkceVerifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(pkceVerifier).digest());
  const url = new URL(google.authUrl);
  url.searchParams.set("client_id", google.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Let someone with several Google accounts pick, every time.
  url.searchParams.set("prompt", "select_account");
  return { url: url.toString(), state, nonce, pkceVerifier };
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  /** Google's own attestation of the address — not RichHabit's. */
  emailVerified: boolean;
}

/** Refusals the routes translate into a friendly, bilingual sentence. */
export class GoogleAuthError extends Error {
  constructor(readonly reason: "exchange" | "token") { super(reason); }
}

const jwks = createRemoteJWKSet(new URL(google.jwksUrl));

/**
 * Exchanges the one-time code and validates the ID token. Throws
 * GoogleAuthError; never leaks Google's raw response into an error message.
 */
export async function completeSignIn(
  code: string, pkceVerifier: string, nonceHash: string, redirectUri: string,
): Promise<GoogleIdentity> {
  let tokenJson: { id_token?: string };
  try {
    const res = await fetch(google.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: google.clientId,
        client_secret: google.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: pkceVerifier,
      }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
    tokenJson = await res.json();
  } catch {
    throw new GoogleAuthError("exchange");
  }
  if (typeof tokenJson.id_token !== "string") throw new GoogleAuthError("exchange");

  try {
    const { payload } = await jwtVerify(tokenJson.id_token, jwks, {
      issuer: google.issuers,
      audience: google.clientId,
    });
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    // Only the nonce's hash ever rested in a cookie; compare in that space.
    if (!sub || !email || typeof payload.nonce !== "string"
      || sha256hex(payload.nonce) !== nonceHash) throw new Error("claims");
    return { sub, email, emailVerified: payload.email_verified === true };
  } catch (e) {
    if (e instanceof GoogleAuthError) throw e;
    throw new GoogleAuthError("token");
  }
}
