import { body, requireId, withUser } from "@/lib/api";
import { deleteAwareness, saveAwareness } from "@/lib/db/queries";
import { parseAwareness } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => saveAwareness(userId, parseAwareness(await body(request))));
}

export async function DELETE(request: Request) {
  return withUser((userId) => deleteAwareness(userId, requireId(request)));
}
