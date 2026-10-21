import { addDays, daysBetween } from "@/lib/dates";
import type { Habit } from "@/lib/types";

/**
 * Unified Notifications — the shape of the Notification Center, shared by the
 * server and the bell (this file imports nothing server-side).
 *
 * Two sections, nothing more:
 *
 *   Upcoming / 即将到来 — every dated thing ahead (Important Dates, planned
 *     Priorities, Together tasks assigned to you, and habits whose reminder is
 *     on), worked out live from the source tables when the bell opens, grouped
 *     Today · Tomorrow · Next 7 days · Later. Never stored, so it always
 *     reflects current schedules, edits and completions. An item carries a
 *     reminder's unread mark when one has come due for it.
 *   Activity / 动态 — things someone did that need you: a Together task
 *     assigned to you, and the invitations the bell already handled.
 *
 * The badge counts only what genuinely asks for attention — unread activity,
 * unread reminders that are still relevant, waiting invitations — never every
 * future event.
 */

export const CATEGORIES = ["dates", "priorities", "habits", "together"] as const;
export type Category = (typeof CATEGORIES)[number];

export const BUCKETS = ["today", "tomorrow", "week", "later"] as const;
export type Bucket = (typeof BUCKETS)[number];

/** How far ahead Upcoming looks. */
export const UPCOMING_DAYS = 30;

export interface UpcomingItem {
  /** Unique within the list: source, record and occurrence. */
  key: string;
  category: Category;
  /** The record's own words, read live — never stored in a notification. */
  title: string;
  /** The reader's calendar day it falls on (an event's occurrence start, a due or planned day). */
  date: string;
  /** "HH:MM" on the reader's clock, for a timed event or a habit's reminder time. */
  time: string | null;
  /** A due or planned day already past, still open. */
  overdue: boolean;
  /** Where it lives: the space's name for Together; null otherwise. */
  context: string | null;
  /** How many habits a grouped habit row stands for (1 for everything else). */
  count: number;
  /** The original record. */
  href: string;
  /** An unread reminder for this item, if one came due — what the badge counts. */
  notificationId: string | null;
  /** For a habit: what its name is made of, so the bell names it in the reader's language (template habits are translated). */
  habit?: Pick<Habit, "templateKey" | "name" | "rotation" | "rotationStart">;
}

export interface ActivityItem {
  id: string;
  kind: "task_assigned";
  title: string;
  /** The space's name. */
  context: string;
  /** Who assigned it, while they are still a member of the space; null otherwise. */
  actor: string | null;
  at: string;
  href: string;
  unread: boolean;
}

export type WaitingInvitation =
  | { kind: "space"; id: string; board: string; inviter: string; expiresAt: string }
  | { kind: "connection"; id: string; inviter: string; expiresAt: string };

export interface NotificationCenter {
  today: string;
  timeZone: string;
  upcoming: UpcomingItem[];
  activity: ActivityItem[];
  invitations: WaitingInvitation[];
  unread: number;
}

/** Overdue and today's items are Today; then tomorrow, the rest of the week ahead, and later. */
export function bucketOf(item: Pick<UpcomingItem, "date" | "overdue">, today: string): Bucket {
  if (item.overdue || item.date <= today) return "today";
  const days = daysBetween(today, item.date);
  if (days === 1) return "tomorrow";
  return days <= 7 ? "week" : "later";
}

/** Upcoming in order: overdue first, then by day, timed before untimed within a day, then by title. */
export function compareUpcoming(a: UpcomingItem, b: UpcomingItem): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if ((a.time === null) !== (b.time === null)) return a.time === null ? 1 : -1;
  if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
  return a.title.localeCompare(b.title);
}

export const lastUpcomingDay = (today: string) => addDays(today, UPCOMING_DAYS);

/* --------------------------------- settings -------------------------------- */

export const LEADS = [0, 1, 3, 7] as const;
export type Lead = (typeof LEADS)[number];

export interface NotificationPrefs {
  togetherAssigned: boolean;
  togetherDue: boolean;
  importantDates: boolean;
  /** Days before an Important Date its reminder comes (0 = on the day). */
  importantDateLead: Lead;
  priorities: boolean;
  /** Master switch for habit reminders; each habit still has to be switched on. */
  habits: boolean;
  morningTime: string;
  daytimeTime: string;
  nighttimeTime: string;
  /** IANA zone; null until first set from the browser. */
  timeZone: string | null;
}

/** What no row means: the approved defaults. */
export const DEFAULT_PREFS: NotificationPrefs = {
  togetherAssigned: true, togetherDue: true, importantDates: true, importantDateLead: 1,
  priorities: true, habits: true, morningTime: "08:00", daytimeTime: "13:00", nighttimeTime: "20:00", timeZone: null,
};

export const isClock = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** A habit's reminder time: its own, else its category's default. */
export function habitTime(prefs: NotificationPrefs, category: "morning" | "daytime" | "nighttime", own: string | null): string {
  if (own && isClock(own)) return own;
  return category === "morning" ? prefs.morningTime : category === "daytime" ? prefs.daytimeTime : prefs.nighttimeTime;
}
