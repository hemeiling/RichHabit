import { body, requireId, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { deleteAwareness, saveAwareness } from "@/lib/db/queries";
import { parseAwareness } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const entry = parseAwareness(await body(request));
    const created = await saveAwareness(userId, entry);
    await trackEvent({
      userId,
      event: created ? "habit_awareness_entry_created" : "habit_awareness_entry_graded",
      entityType: "awareness", entityId: entry.id, page: "/more/awareness",
      properties: { grade: entry.grade },
    });
  });
}

export async function DELETE(request: Request) {
  return withUser(async (userId) => {
    const id = requireId(request);
    await deleteAwareness(userId, id);
  });
}
