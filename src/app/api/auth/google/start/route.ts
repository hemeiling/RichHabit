import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { G_FLOW_COOKIE, G_NONCE_COOKIE, G_PKCE_COOKIE, G_STATE_COOKIE, HANDSHAKE_MINUTES,
  beginSignIn, sha256hex } from "@/lib/auth/google";
import { getSessionUser } from "@/lib/auth";
import { appUrl, google, isProduction } from "@/lib/env";
import { loginReturnPath } from "@/lib/loginMode";

/**
 * The start of "Continue with Google": plants the handshake cookies and
 * redirects to Google. GET, because it is a navigation — the whole flow is
 * top-level redirects, which is what survives iPhone Safari.
 *
 * `?then=` is a keyword from the fixed allow-list (loginReturnPath), never a
 * URL. `?flow=link` asks for the result to be attached to the signed-in
 * account (Settings' Connect button); it is refused without a session, and the
 * callback checks the session again — these cookies only carry intent.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!google.enabled) return NextResponse.redirect(new URL("/login", appUrl()), 302);
  const here = new URL(request.url);
  const q = here.searchParams;

  /*
   * Google always returns to ONE callback — APP_URL's — and the handshake
   * cookies planted below are host-only. Started on any other domain the
   * app answers on (richhabit.onrender.com beside richhabit.rosalytics.com),
   * the cookies would sit on the wrong host and every return would fail
   * the state check. So the handshake begins on the canonical host: one hop
   * there with the same query, nothing planted here.
   *
   * At most ONE hop: the hop carries `hop=1`, and a request that still looks
   * foreign after it (a proxy that hides the public host) proceeds exactly
   * as before rather than bouncing forever.
   */
  const canonical = new URL(appUrl());
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? here.host;
  if (host.toLowerCase() !== canonical.host.toLowerCase() && !q.has("hop")) {
    const next = new URL("/api/auth/google/start", canonical);
    for (const [k, v] of q) next.searchParams.set(k, v);
    next.searchParams.set("hop", "1");
    return NextResponse.redirect(next, 302);
  }

  const linking = q.get("flow") === "link";
  if (linking && !(await getSessionUser())) {
    return NextResponse.redirect(new URL("/login", appUrl()), 302);
  }

  const redirectUri = new URL("/api/auth/google/callback", appUrl()).toString();
  const { url, state, nonce, pkceVerifier } = beginSignIn(redirectUri);

  const jar = cookies();
  const opts = {
    httpOnly: true as const, sameSite: "lax" as const, secure: isProduction, path: "/",
    maxAge: HANDSHAKE_MINUTES * 60,
  };
  jar.set(G_STATE_COOKIE, state, opts);
  // The nonce is compared against the ID token later; only its hash rests here.
  jar.set(G_NONCE_COOKIE, sha256hex(nonce), opts);
  jar.set(G_PKCE_COOKIE, pkceVerifier, opts);
  const then = loginReturnPath(q.get("then")) ? q.get("then")! : "";
  jar.set(G_FLOW_COOKIE, JSON.stringify({ linking, then }), opts);

  const res = NextResponse.redirect(url, 302);
  // The nonce itself travels only inside the redirect we are issuing; Google
  // folds it into the ID token. It must not rest anywhere readable, so the
  // cookie holds the hash and the comparison hashes the token's copy.
  return res;
}
