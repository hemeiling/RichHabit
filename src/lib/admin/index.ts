import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ApiError } from "@/lib/http";
import { query } from "@/lib/db/pool";

/**
 * Admin authorisation, checked against the database on every request.
 *
 * The role is read fresh from `users.role` each time rather than carried in the
 * session cookie or the client's state — a cookie cannot be made to claim
 * admin, and revoking someone takes effect on their next request rather than
 * whenever their session happens to expire.
 *
 * Nothing in the API can *set* a role. Granting admin is `npm run admin:grant`,
 * run against the database by whoever owns the deployment.
 */

export interface AdminUser {
  id: string;
  email: string;
}

export async function currentAdmin(): Promise<AdminUser | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const rows = await query<{ id: string; email: string }>(
    "select id, email from users where id = $1 and role = 'admin'",
    [user.id],
  );
  return rows[0] ?? null;
}

/**
 * For admin pages. Answers 404, not 403 — a signed-in ordinary user should not
 * be able to learn that /admin exists, let alone that they were refused.
 */
export async function requireAdminPage(): Promise<AdminUser> {
  const admin = await currentAdmin();
  if (!admin) notFound();
  return admin;
}

/** For admin API routes. Same reasoning: 404 rather than 403. */
export async function withAdmin(
  fn: (admin: AdminUser) => Promise<unknown>,
): Promise<NextResponse> {
  const admin = await currentAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json(await fn(admin) ?? { ok: true });
  } catch (e) {
    // A refusal an admin needs to read — "that email already exists", "this is
    // the last active admin" — carries its own status and its own words. Only
    // genuine faults fall through to the generic message.
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[admin]", e);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}
