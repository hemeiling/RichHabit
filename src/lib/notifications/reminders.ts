import type { CenterExtras } from "@/lib/notifications/server";
import type { NotificationPrefs } from "@/lib/notifications/model";

/**
 * In-app reminders — Stage 2. Until then: none are written, none are counted,
 * and Upcoming carries no reminder marks.
 */
export const reminderExtras = (_userId: string) =>
  async (_prefs: NotificationPrefs, _today: string, _zone: string): Promise<CenterExtras> => ({});
export async function materializeReminders(_userId: string, _rawZone: unknown): Promise<void> {}
export async function unreadReminders(_userId: string): Promise<number> { return 0; }
