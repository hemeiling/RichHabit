import { body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { saveMonthlyReflection } from "@/lib/db/queries";
import { parseMonthlyReflection } from "@/lib/validate";

/** A reflection on a whole month, written from Insights. Private user content. */
export async function POST(request: Request) {
  return withUser(async (userId) => {
    const { month, body: text } = parseMonthlyReflection(await body(request));
    await saveMonthlyReflection(userId, month, text);
    await trackEvent({
      userId, event: "monthly_reflection_written", page: "/insights",
      properties: { hasText: text.trim().length > 0 },
    });
  });
}
