import { body, requireId, withUser } from "@/lib/api";
import { deleteGoal, saveGoal } from "@/lib/db/queries";
import { parseGoal } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => saveGoal(userId, parseGoal(await body(request))));
}

export async function DELETE(request: Request) {
  return withUser((userId) => deleteGoal(userId, requireId(request)));
}
