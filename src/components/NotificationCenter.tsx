"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { call } from "@/components/together/shared";
import { useLocale, useT } from "@/lib/i18n/context";
import {
  BUCKETS, CATEGORIES, bucketOf,
  type Category, type NotificationCenter as Center, type UpcomingItem, type WaitingInvitation,
} from "@/lib/notifications/model";
import { clockTimeFor, shortDateFor } from "@/lib/i18n";
import { deviceTimeZone } from "@/lib/zonedTime";
import { iso } from "@/lib/dates";
import { habitNameOn } from "@/lib/templates";

/**
 * The Notification Center's body — what the bell opens. Two sections and
 * nothing to learn:
 *
 *   Upcoming · 即将到来  Today, Tomorrow, Next 7 days, Later — every dated thing
 *                       ahead, with a filter for Important Dates, Priorities,
 *                       Habits and Together. A dot marks a reminder that came due.
 *   Activity · 动态      new Together assignments, and the invitations the bell
 *                       always held (Accept / Decline right there).
 *
 * It opens on Activity only when something there is new; otherwise on
 * Upcoming. Every row opens its original record. Opening a row clears its
 * dot; Mark all read clears every one. Read when the bell opens, never before.
 */

const dateLabel = (date: string, locale: ReturnType<typeof useLocale>) => {
  const tag = locale === "zh" ? "zh-CN" : "en-US";
  return new Date(`${date}T12:00:00`).toLocaleDateString(tag, { weekday: "short", month: "short", day: "numeric" });
};

export function NotificationPanel({ onNavigate, onCount }: { onNavigate: () => void; onCount: (n: number) => void }) {
  const t = useT();
  const n = t.notifications;
  const locale = useLocale();
  const router = useRouter();
  const [center, setCenter] = useState<Center | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"upcoming" | "activity" | null>(null);
  const [filter, setFilter] = useState<Category | "all">("all");
  const [answering, setAnswering] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const tz = useMemo(() => deviceTimeZone() ?? "UTC", []);

  const load = useCallback(() => {
    setFailed(false);
    call<Center>(`/api/notifications?tz=${encodeURIComponent(tz)}`)
      .then((c) => {
        setCenter(c);
        onCount(c.unread);
        setTab((cur) => cur ?? (c.invitations.length > 0 || c.activity.some((a) => a.unread) ? "activity" : "upcoming"));
      })
      .catch(() => setFailed(true));
  }, [tz, onCount]);
  useEffect(() => { load(); }, [load]);

  const markRead = (ids: string[] | "all") => {
    if (ids !== "all" && !ids.length) return;
    void call("/api/notifications/read", { method: "POST", body: JSON.stringify(ids === "all" ? { all: true } : { ids }) })
      .then(() => load()).catch(() => {});
  };

  const answer = async (w: WaitingInvitation, accept: boolean) => {
    if (answering) return;
    setAnswering(w.id);
    setProblem(null);
    try {
      const r = await call<{ boardId?: string }>(
        w.kind === "connection" ? "/api/together/connections/respond" : "/api/together/invitations/respond",
        { method: "POST", body: JSON.stringify({ id: w.id, accept }) },
      );
      if (w.kind === "space" && accept && r.boardId) {
        setAnswering(null);
        onNavigate();
        router.push(`/together/b/${r.boardId}`);
        router.refresh();
        return;
      }
      load();
      router.refresh();   // the sidebar's indicator
    } catch (e) {
      // It may have been answered elsewhere or withdrawn meanwhile: say why, and re-read.
      setProblem(e instanceof Error ? e.message : String(e));
      load();
    }
    setAnswering(null);
  };

  if (failed) return <p className="bell-note" role="alert">{t.together.loadFailed}</p>;
  if (!center || !tab) return <p className="bell-note">{t.common.loading}</p>;

  const activityNew = center.invitations.length + center.activity.filter((a) => a.unread).length;
  const upcomingNew = center.upcoming.filter((i) => i.notificationId).length;
  const shown = filter === "all" ? center.upcoming : center.upcoming.filter((i) => i.category === filter);
  const groups = BUCKETS.map((b) => ({ bucket: b, items: shown.filter((i) => bucketOf(i, center.today) === b) }))
    .filter((g) => g.items.length > 0);

  const when = (i: UpcomingItem, bucket: string) => {
    if (i.overdue) return `${n.overdue} · ${shortDateFor(i.date, locale)}`;
    const time = i.time ? clockTimeFor(i.time, locale) : null;
    if (bucket === "today" || bucket === "tomorrow") return time;
    return time ? `${dateLabel(i.date, locale)} · ${time}` : dateLabel(i.date, locale);
  };

  return (
    <div className="nc">
      <div className="nc-top">
        <div className="nc-tabs" role="tablist" aria-label={n.title}>
          {(["upcoming", "activity"] as const).map((k) => (
            <button key={k} type="button" role="tab" className="nc-tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {k === "upcoming" ? n.upcoming : n.activity}
              {(k === "upcoming" ? upcomingNew : activityNew) > 0 && (
                <span className="nc-tab-n num">{k === "upcoming" ? upcomingNew : activityNew}</span>
              )}
            </button>
          ))}
        </div>
        {center.unread > 0 && (
          <button type="button" className="nc-markall" onClick={() => markRead("all")}>{n.markAllRead}</button>
        )}
      </div>

      {tab === "upcoming" ? (
        <div role="tabpanel" aria-label={n.upcoming}>
          <div className="nc-filters" role="group" aria-label={n.filterLabel}>
            {(["all", ...CATEGORIES] as const).map((c) => (
              <button key={c} type="button" className="nc-chip" aria-pressed={filter === c} onClick={() => setFilter(c)}>
                {n.filters[c]}
              </button>
            ))}
          </div>
          {groups.length === 0 ? (
            <p className="bell-note">{filter === "all" ? n.nothingUpcoming : n.nothingFiltered}</p>
          ) : groups.map((g) => (
            <section key={g.bucket} className="nc-group" aria-label={n.buckets[g.bucket]}>
              <h3 className="nc-group-title">{n.buckets[g.bucket]}</h3>
              <ul className="nc-list">
                {g.items.map((i) => {
                  const w = when(i, g.bucket);
                  return (
                    <li key={i.key}>
                      <Link href={i.href} className="nc-row" data-unread={i.notificationId ? true : undefined}
                        onClick={() => { if (i.notificationId) markRead([i.notificationId]); onNavigate(); }}>
                        <span className="nc-dot" aria-hidden="true" />
                        <span className="nc-row-main">
                          <span className="nc-row-title">
                            {i.notificationId && <span className="sr-only">{n.unread}: </span>}
                            {i.category === "habits" && i.count > 1 ? n.habitsCount(i.count)
                              : i.habit ? habitNameOn(i.habit, t, i.date) : i.title}
                          </span>
                          <span className="nc-row-meta">
                            <span className="nc-cat" data-cat={i.category}>{n.filters[i.category]}</span>
                            {i.context && <span className="nc-ctx">{i.context}</span>}
                          </span>
                        </span>
                        {w && <span className="nc-when" data-overdue={i.overdue || undefined}>{w}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div role="tabpanel" aria-label={n.activity}>
          {center.invitations.length === 0 && center.activity.length === 0 ? (
            <p className="bell-note">{n.noActivity}</p>
          ) : (
            <ul className="nc-list">
              {center.invitations.map((i) => (
                <li key={`inv-${i.id}`} className="bell-item nc-invite">
                  <p className="bell-text">
                    {i.kind === "connection"
                      ? t.together.collabRequestCard(i.inviter)
                      : t.together.invitePage.invitedYou(i.inviter, i.board)}
                  </p>
                  <div className="bell-actions">
                    <button className="btn" disabled={answering !== null} onClick={() => answer(i, false)}>{t.together.decline}</button>
                    <button className="btn btn-primary" disabled={answering !== null} onClick={() => answer(i, true)}>{t.together.accept}</button>
                  </div>
                </li>
              ))}
              {center.activity.map((a) => (
                <li key={a.id}>
                  <Link href={a.href} className="nc-row" data-unread={a.unread || undefined}
                    onClick={() => { if (a.unread) markRead([a.id]); onNavigate(); }}>
                    <span className="nc-dot" aria-hidden="true" />
                    <span className="nc-row-main">
                      <span className="nc-row-kicker">{a.unread && <span className="sr-only">{n.unread}: </span>}{n.assignedBy(a.actor)}</span>
                      <span className="nc-row-title">{a.title}</span>
                      <span className="nc-row-meta"><span className="nc-cat" data-cat="together">{a.context}</span></span>
                    </span>
                    <span className="nc-when">{shortDateFor(iso(new Date(a.at)), locale)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {problem && <p className="bell-note" role="alert" style={{ color: "var(--warn)" }}>{problem}</p>}
        </div>
      )}

      <p className="bell-foot nc-foot">
        <span>{n.inAppOnly}</span>
        <Link href="/more#notifications" onClick={onNavigate}>{n.settings} →</Link>
      </p>
    </div>
  );
}
