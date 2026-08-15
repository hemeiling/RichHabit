import { withAdmin } from "@/lib/admin";
import { createAccount } from "@/lib/admin/users";
import { check } from "@/lib/http";
import { isLocale } from "@/lib/i18n";

/**
 * Creating an account, admin only.
 *
 * `withAdmin` resolves the caller's session and re-reads `users.role` from the
 * database on every request, and answers 404 rather than 403 — a signed-in
 * ordinary user should not learn that this endpoint exists. Nothing the client
 * sends can influence that check.
 */
export async function POST(request: Request) {
  return withAdmin(async (admin) => {
    const b = await request.json().catch(() => null);
    const locale = isLocale(b?.locale) ? b.locale : "en";

    return createAccount(admin, {
      email: check.text(b?.email, "email", 254),
      // Either identifies the account; `createAccount` requires one of them.
      username: check.text(b?.username, "username", 40),
      displayName: check.text(b?.displayName, "displayName", 120),
      role: check.oneOf(b?.role ?? "user", ["user", "admin"] as const, "role"),
      disabled: b?.disabled === true,
      credential: check.oneOf(b?.credential ?? "invite",
        ["invite", "temporary", "set"] as const, "credential"),
      /*
       * Read straight into the service and hashed there. It is never written to
       * a profile table, an analytics event, a log line, or this response — the
       * only thing that leaves this request is a user id.
       */
      password: typeof b?.password === "string" ? b.password : "",
      requireChange: b?.requireChange === true,
      locale,
      // Defaults on: an account with no habits opens on an empty checklist,
      // which is a worse first morning than one someone edits down.
      seedHabits: b?.seedHabits !== false,
    });
  });
}

export const dynamic = "force-dynamic";
