import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/cookies";

// API routes do their own auth check so fetch() callers get JSON, not an HTML redirect.
const PUBLIC_PATHS = [
  "/login",
  "/api",
  // Redeeming a setup link is how an admin-created account first gets in; the
  // token in the URL is the credential and is checked server-side.
  "/setup",
  // The early-access terms are linked from the sign-in card, so they have to be
  // readable before anyone has an account.
  "/terms",
  // Confirming an address happens before there is any session at all — the
  // token in the URL is the credential, and it is checked server-side.
  "/verify",
];

/**
 * A cookie-presence check, nothing more. /admin is not listed as public, so a
 * signed-out visitor is redirected to /login like anywhere else; whether they
 * are actually an admin is decided server-side, per page, against the database.
 * Middleware runs on the edge runtime,
 * which cannot open a Postgres connection, so the session is not validated
 * here — it is validated in the app layout and in every /api route, both of
 * which do reach the database. This only saves a redirect round-trip.
 */
function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, must-revalidate");
  return res;
}

/**
 * Routes that moved, and where they went.
 *
 * `/today` is Rich Habits now: the day's habits, the score and the journal all
 * live there, and the priority matrix and the calendar that shared that page
 * are Priority Compass. The old address is the most linked-to in the app, so it
 * keeps answering.
 *
 * Done here, in middleware, rather than only in the page: a `redirect()` inside
 * a server component is served as HTML carrying an instruction the client then
 * follows, which costs a render and is not a redirect at all to anything that
 * is not a browser. 308 is the honest answer, it is permanent and it preserves
 * the method. The page at app/(app)/today stays as a backstop, so the route
 * cannot 404 even if this matcher is ever narrowed.
 *
 * No record is touched by any of this. It is one URL pointing at another.
 */
const MOVED: Record<string, string> = { "/today": "/habits" };

export function middleware(request: NextRequest) {
  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const path = request.nextUrl.pathname;

  const moved = MOVED[path];
  if (moved) {
    const url = request.nextUrl.clone();
    url.pathname = moved;
    // The query string is carried through untouched: whatever a link was
    // saying, it still says it at the new address.
    return noStore(NextResponse.redirect(url, 308));
  }

  /*
   * The habit sheet's own deep links.
   *
   * `/habits` was the sheet before Rich Habits took the address, and two query
   * parameters were the only way anything ever linked into it: `?edit=` to open
   * one habit in the editor, and `?from=` to start a habit from an awareness
   * entry. Those links exist in the wild, so they are sent to the sheet's new
   * address with the habit they named.
   *
   * 307 rather than 308, deliberately. The move is permanent but the condition
   * is not the path — `/habits` on its own is a real page — and a permanent
   * status on a conditional redirect is the kind of thing a cache keyed on path
   * alone turns into a page nobody can reach.
   */
  if (path === "/habits") {
    const { searchParams } = request.nextUrl;
    if (searchParams.has("edit") || searchParams.has("from")) {
      const url = request.nextUrl.clone();
      url.pathname = "/more/habits";
      return noStore(NextResponse.redirect(url, 307));
    }
  }

  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!hasCookie && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return noStore(NextResponse.redirect(url));
  }
  // Deliberately no "has a cookie, so bounce them off /login" rule here.
  //
  // Signed-in HTML and RSC payloads are `no-store`, which is what makes signing
  // out stick. Without it the browser is entitled to keep the rendered page and
  // hand it back on Back — bfcache restores a live DOM, cache restores the
  // markup — and the previous account's habits would paint again with no
  // request reaching the server to say the session is gone.
  // Middleware can only see that a cookie exists, while the app layout checks
  // whether the session behind it is still valid. When those two disagree —
  // an expired session, a revoked one, a rebuilt database — /habits redirects
  // to /login and /login redirects back, forever. Whether someone is really
  // signed in is decided in one place: the login page, against the database.
  return noStore(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
