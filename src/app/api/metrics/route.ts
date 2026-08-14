import { body, withUser } from "@/lib/api";
import { saveMetrics } from "@/lib/db/queries";
import { parseMetrics } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const { date, metrics } = parseMetrics(await body(request));
    return saveMetrics(userId, date, metrics);
  });
}
