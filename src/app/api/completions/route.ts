import { body, withUser } from "@/lib/api";
import { setCompletion } from "@/lib/db/queries";
import { parseCompletion } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const { habitId, date, done, value, note } = parseCompletion(await body(request));
    return setCompletion(userId, habitId, date, done, value, note);
  });
}
