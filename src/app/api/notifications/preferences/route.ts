import { body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { savePrefs, settingsOf } from "@/lib/notifications/server";

/** Notification Settings for the signed-in account: read, or save the fields given. */
export async function GET() {
  return withUser((userId) => settingsOf(userId), (d) => d.errors.loadFailedTitle);
}

export async function PUT(request: Request) {
  return withUser(async (userId) => {
    const raw = await body<Record<string, unknown>>(request);
    const prefs = await savePrefs(userId, raw && typeof raw === "object" ? raw : {});
    // Which settings changed — their names, never their values.
    await trackEvent({ userId, event: "notification_settings_saved", page: "/more", properties: { fields: Object.keys(raw ?? {}).slice(0, 12).join(",") } });
    return { prefs };
  });
}
