import { NextResponse, type NextRequest } from "next/server";

// API routes do their own auth check so fetch() callers get JSON, not an HTML redirect.
const PUBLIC_PATHS = ["/login", "/api"];
const SESSION_COOKIE = "rh_session";

/**
 * A cookie-presence check, nothing more. Middleware runs on the edge runtime,
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
  if (hasCookie && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/today";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
