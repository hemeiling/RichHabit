import { body, withUser } from "@/lib/api";
import { saveDayNote } from "@/lib/db/queries";
import { parseNote } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const { date, body: text } = parseNote(await body(request));
    return saveDayNote(userId, date, text);
  });
}
