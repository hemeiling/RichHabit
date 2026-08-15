import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

/**
 * Ends the session server-side: the `sessions` row is deleted, so the token in
 * the cookie stops resolving to anyone even if a copy of it survives somewhere.
 *
 * `destroySession` is the only thing that writes the cookie. Setting it here as
 * well produced two `Set-Cookie` values for one name, and the one that reached
 * the browser was whichever Next merged last — which is how it ended up sending
 * one with no `Max-Age` at all.
 *
 * `no-store` so nothing can replay this response.
 */
export async function POST() {
  await destroySession();

  const res = NextResponse.json({ ok: true });
  res.headers.set("Cache-Control", "no-store, must-revalidate");
  return res;
}
