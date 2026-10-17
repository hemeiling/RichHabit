import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, getSessionUser } from "@/lib/auth";
import { G_FLOW_COOKIE, G_NONCE_COOKIE, G_PENDING_COOKIE, G_PKCE_COOKIE, G_STATE_COOKIE,
  GoogleAuthError, HANDSHAKE_MINUTES, completeSignIn } from "@/lib/auth/google";
import { gateGoogleIdentity, linkFromSettings } from "@/lib/auth/googleAccount";
import { trackEvent } from "@/lib/analytics/track";
import { appUrl, google, isProduction } from "@/lib/env";
import { loginReturnPath } from "@/lib/loginMode";

/**
 * Google sends the browser back here. Nothing in the query is trusted until it
 * has survived: the state against its cookie, the code against Google's token
 * endpoint (with the PKCE verifier), and the ID token's signature, issuer,
 * audience and nonce. Only then does the verified identity meet the account
 * rules (lib/auth/googleAccount): a linked `sub` signs in; an email match
 * waits for that account's own password; anything else starts an ordinary
 * registration. Every refusal lands back on /login with a key the screen
 * says in the person's language — never Google's raw error.
 */
export const dynamic = "force-dynamic";

const back = (page: string, params: Record<string, string> = {}) => {
  const url = new URL(page, appUrl());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 302);
};

export async function GET(request: Request) {
  if (!google.enabled) return back("/login");
  const q = new URL(request.url).searchParams;
  const jar = cookies();
  const state = jar.get(G_STATE_COOKIE)?.value ?? "";
  const nonceHash = jar.get(G_NONCE_COOKIE)?.value ?? "";
  const pkce = jar.get(G_PKCE_COOKIE)?.value ?? "";
  let flow: { linking?: boolean; then?: string } = {};
  try { flow = JSON.parse(jar.get(G_FLOW_COOKIE)?.value ?? "{}"); } catch { /* absent */ }
  // The handshake is one-shot either way.
  for (const name of [G_STATE_COOKIE, G_NONCE_COOKIE, G_PKCE_COOKIE, G_FLOW_COOKIE]) {
    jar.set(name, "", { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/", expires: new Date(0) });
  }

  // Cancelled or refused at Google: a calm sentence, nothing created.
  if (q.get("error")) return back("/login", { gerr: "cancelled" });

  const code = q.get("code") ?? "";
  if (!code || !state || !q.get("state") || q.get("state") !== state || !nonceHash || !pkce) {
    return back("/login", { gerr: "failed" });
  }

  let identity;
  try {
    identity = await completeSignIn(code, pkce, nonceHash,
      new URL("/api/auth/google/callback", appUrl()).toString());
  } catch (e) {
    console.error("[google] sign-in failed:", e instanceof GoogleAuthError ? e.reason : "error");
    return back("/login", { gerr: "failed" });
  }

  const then = loginReturnPath(flow.then) ?? "/habits";

  // Settings' Connect: attach to the signed-in account — proved by its session.
  if (flow.linking) {
    const me = await getSessionUser();
    if (!me) return back("/login", { gerr: "failed" });
    const gate = await gateGoogleIdentity(identity);
    if (gate.kind === "signin") {
      return back("/more", { google: gate.userId === me.id ? "connected" : "notYours" });
    }
    const ok = gate.kind === "link" && (await linkFromSettings(gate.token, me.id));
    // "link" with someone else's account, or a brand-new address: both mean
    // this Google account does not belong to the signed-in one.
    await trackEvent({ userId: me.id, event: "google_link", page: "/more", properties: { ok } });
    return back("/more", { google: ok ? "connected" : "notYours" });
  }

  const gate = await gateGoogleIdentity(identity);
  if (gate.kind === "signin") {
    if (gate.disabled) return back("/login", { gerr: "disabled" });
    await createSession(gate.userId);
    await trackEvent({ userId: gate.userId, event: "signin", page: "/login", properties: { method: "google" } });
    return back(then);
  }

  // The person's own next step: the token rides a cookie, never a URL.
  jar.set(G_PENDING_COOKIE, gate.token, {
    httpOnly: true, sameSite: "lax", secure: isProduction, path: "/", maxAge: HANDSHAKE_MINUTES * 60,
  });
  return back("/login", { google: gate.kind === "link" ? "linkExisting" : "finish" });
}
