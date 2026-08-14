import { body, requireId, withUser } from "@/lib/api";
import { deleteHabit, saveHabit } from "@/lib/db/queries";
import { parseHabit } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => saveHabit(userId, parseHabit(await body(request))));
}

export async function DELETE(request: Request) {
  return withUser((userId) => deleteHabit(userId, requireId(request)));
}
