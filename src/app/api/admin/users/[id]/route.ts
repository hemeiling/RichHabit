import { withAdmin } from "@/lib/admin";
import { deleteAccount, resetPassword, setDisabled, setRole } from "@/lib/admin/users";
import { check } from "@/lib/http";

/**
 * Everything an admin can do to one account. Admin-only by the same guard as
 * every other route under /api/admin: the role is read from the database per
 * request, and the answer to anyone else is 404.
 *
 * Self-protection and last-admin protection live in `lib/admin/users.ts`, not
 * here and certainly not in the UI — the button being hidden is a courtesy;
 * the refusal is the rule.
 */
export async function PATCH(
  request: Request, { params }: { params: { id: string } },
) {
  return withAdmin(async (admin) => {
    const id = check.uuid(params.id, "id");
    const b = await request.json().catch(() => null);
    const action = check.oneOf(b?.action,
      ["disable", "enable", "role", "reset_password"] as const, "action");

    switch (action) {
      case "disable": await setDisabled(admin, id, true); return { ok: true };
      case "enable": await setDisabled(admin, id, false); return { ok: true };
      case "role":
        await setRole(admin, id, check.oneOf(b?.role, ["user", "admin"] as const, "role"));
        return { ok: true };
      case "reset_password":
        // Returned once, to the admin who asked. Never written to the log.
        return { ok: true, temporaryPassword: await resetPassword(admin, id) };
    }
  });
}

export async function DELETE(
  _request: Request, { params }: { params: { id: string } },
) {
  return withAdmin(async (admin) => {
    await deleteAccount(admin, check.uuid(params.id, "id"));
    return { ok: true };
  });
}

export const dynamic = "force-dynamic";
