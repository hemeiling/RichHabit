import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ApiError, isUuid } from "@/lib/http";

export { ApiError, check, isUuid } from "@/lib/http";

/**
 * The guard every data route goes through. The user id comes from the session
 * and nowhere else — no route reads one from a body or a query string, so a
 * caller cannot ask for someone else's rows.
 *
 * Body parsing happens *inside* the callback so a validation failure lands in
 * this try/catch as a 400, rather than escaping as Next's HTML error page.
 */
export async function withUser(
  fn: (userId: string) => Promise<unknown>,
): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  try {
    const data = await fn(user.id);
    return NextResponse.json(data ?? { ok: true });
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    // Anything else is a bug or a database failure. Log it in full, tell the
    // caller nothing — raw Postgres errors name columns, constraints and
    // sometimes values, and the store puts `error.message` on screen.
    console.error("[api]", e);
    return NextResponse.json({ error: "Something went wrong saving that." }, { status: 500 });
  }
}

/** Parses a JSON body, or throws a message the store can show as-is. */
export async function body<T>(request: Request): Promise<T> {
  const parsed = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== "object") throw new ApiError("Malformed request body");
  return parsed as T;
}

export function requireId(request: Request): string {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) throw new ApiError("Missing id");
  if (!isUuid(id)) throw new ApiError("Malformed id");
  return id;
}
