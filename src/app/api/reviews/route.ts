import { body, withUser } from "@/lib/api";
import { saveReview } from "@/lib/db/queries";
import { parseReview } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => saveReview(userId, parseReview(await body(request))));
}
