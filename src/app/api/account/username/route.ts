import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db/pool";
import { checkUsername, normaliseUsername } from "@/lib/identity";
import { getDict } from "@/lib/i18n/server";
import { clearCommunityCache } from "@/lib/community";

/**
 * Choosing a public username.
 *
 * This writes one column. The account id is untouched, and every habit,
 * completion, goal, journal entry and spending record is keyed on that id —
 * so a rename changes what the board calls someone and nothing else. Their
 * Community Score and rank are recomputed from the same completions either
 * way, which is why renaming cannot move them up or down.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const raw = typeof body?.username === "string" ? body.username : "";
  const username = normaliseUsername(raw);
  const msg = getDict().errors;

  // The same wording sign-up uses, so the rule is stated identically wherever
  // someone meets it.
  if (checkUsername(username)) {
    return NextResponse.json({ error: msg.invalidUsername }, { status: 400 });
  }

  try {
    await query("update users set username = $2 where id = $1", [user.id, username]);
  } catch (e) {
    /* Uniqueness is enforced by `users_username_idx` on lower(username), so
       the database is the authority. Checking first and inserting after would
       leave a gap where two people could claim the same name. */
    if (e instanceof Error && /users_username_idx/.test(e.message)) {
      return NextResponse.json({ error: msg.usernameTaken }, { status: 409 });
    }
    throw e;
  }

  // The board caches names for a minute; drop it so the change shows at once.
  clearCommunityCache();
  return NextResponse.json({ ok: true, username });
}
