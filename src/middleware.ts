import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/cookies";

// API routes do their own auth check so fetch() callers get JSON, not an HTML redirect.
const PUBLIC_PATHS = ["/login", "/api"];

/**
 * A cookie-presence check, nothing more. /admin is not listed as public, so a
 * signed-out visitor is redirected to /login like anywhere else; whether they
 * are actually an admin is decided server-side, per page, against the database.
 * Middleware runs on the edge runtime,
 * which cannot open a Postgres connection, so the session is not validated
 * here — it is validated in the app layout and in every /api route, both of
 * which do reach the database. This only saves a redirect round-trip.
 */
export function middleware(request: NextRequest) {
  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!hasCookie && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  // Deliberately no "has a cookie, so bounce them off /login" rule here.
  // Middleware can only see that a cookie exists, while the app layout checks
  // whether the session behind it is still valid. When those two disagree —
  // an expired session, a revoked one, a rebuilt database — /today redirects
  // to /login and /login redirects back, forever. Whether someone is really
  // signed in is decided in one place: the login page, against the database.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
