import { body, requireId, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { deleteSpending, saveSpending } from "@/lib/db/queries";
import { parseSpending } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const record = parseSpending(await body(request));
    await saveSpending(userId, record);
    // §20 privacy: what someone spends is theirs. The event records that a
    // record was made and nothing about it — no amount, merchant or note.
    await trackEvent({
      userId, event: "spending_recorded", entityType: "spending",
      entityId: record.id, page: "/more/spending",
    });
  });
}

export async function DELETE(request: Request) {
  return withUser((userId) => deleteSpending(userId, requireId(request)));
}
