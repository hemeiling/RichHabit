import { body, withUser } from "@/lib/api";
import { savePrefs } from "@/lib/db/queries";
import { parsePrefs } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => savePrefs(userId, parsePrefs(await body(request))));
}
