import { withAdmin } from "@/lib/admin";
import { bulkDeleteAccounts, bulkSetDisabled } from "@/lib/admin/users";
import { check } from "@/lib/http";
import { parseIdList } from "@/lib/validate";

/**
 * One bulk operation, one authorisation check, one structured answer.
 *
 * Admin-only by the same guard as everything under /api/admin: the role is read
 * from the database per request and anyone else gets 404. Which accounts are
 * protected is decided in the service, never by what the client sent.
 */
export async function POST(request: Request) {
  return withAdmin(async (admin) => {
    const body = await request.json().catch(() => null);
    const action = check.oneOf(body?.action, ["delete", "disable", "enable"] as const, "action");
    const ids = parseIdList(body, "ids");

    return action === "delete"
      ? bulkDeleteAccounts(admin, ids)
      : bulkSetDisabled(admin, ids, action === "disable");
  });
}

export const dynamic = "force-dynamic";
