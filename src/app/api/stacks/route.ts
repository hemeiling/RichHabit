import { body, requireId, withUser } from "@/lib/api";
import { deleteStack, saveStack } from "@/lib/db/queries";
import { parseStack } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => saveStack(userId, parseStack(await body(request))));
}

export async function DELETE(request: Request) {
  return withUser((userId) => deleteStack(userId, requireId(request)));
}
