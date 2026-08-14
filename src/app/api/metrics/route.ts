import { body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { saveMetrics } from "@/lib/db/queries";
import { parseMetrics } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const { date, metrics } = parseMetrics(await body(request));
    await saveMetrics(userId, date, metrics);
    // Which fields were filled in, never what they said.
    await trackEvent({
      userId, event: "metric_logged", entityType: "day", page: "/more/metrics",
      properties: {
        fields: Object.values(metrics).filter((v) => v !== null && v !== false).length,
      },
    });
  });
}
