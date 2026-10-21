"use client";
import { useEffect, useMemo, useState } from "react";
import { call } from "@/components/together/shared";
import { Segmented } from "@/components/ui";
import { useLocale, useT } from "@/lib/i18n/context";
import { zoneLabelFor } from "@/lib/i18n";
import { LEADS, type Lead, type NotificationPrefs } from "@/lib/notifications/model";
import { deviceTimeZone } from "@/lib/zonedTime";

/**
 * Notification Settings / 通知设置 — on the Account page (`#notifications`).
 * A few switches and times, saved as each one changes. It says plainly that
 * these are in-app reminders, shown when RichHabit is open — Phase 1 sends no
 * email or push. Habit reminders are switched on per habit, in its editor; here
 * is only the master switch and the three times of day they default to.
 */

interface Settings { prefs: NotificationPrefs; together: boolean }

export default function NotificationSettings() {
  const t = useT();
  const n = t.notifications;
  const locale = useLocale();
  const [s, setS] = useState<Settings | null>(null);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const device = useMemo(() => deviceTimeZone(), []);
  const zones = useMemo(() => {
    try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? []; }
    catch { return []; }
  }, []);

  useEffect(() => {
    call<Settings>("/api/notifications/preferences").then(setS).catch((e: Error) => setProblem(e.message));
  }, []);
  // The bell's "Notification settings" link lands here; the browser's own jump
  // to #notifications happened before this card had its height, so do it now.
  const loaded = s !== null;
  useEffect(() => {
    if (loaded && window.location.hash === "#notifications") {
      document.getElementById("notifications")?.scrollIntoView({ block: "start" });
    }
  }, [loaded]);

  const save = async (patch: Partial<NotificationPrefs>) => {
    if (!s) return;
    setS({ ...s, prefs: { ...s.prefs, ...patch } });
    setStatus("idle");
    try {
      const r = await call<{ prefs: NotificationPrefs }>("/api/notifications/preferences", { method: "PUT", body: JSON.stringify(patch) });
      setS((cur) => (cur ? { ...cur, prefs: r.prefs } : cur));
      setStatus("saved");
    } catch (e) {
      setProblem((e as Error).message);
      setStatus("error");
    }
  };

  const onOff = (value: boolean, key: keyof NotificationPrefs) => (
    <Segmented<boolean> value={value} onChange={(v) => save({ [key]: v } as Partial<NotificationPrefs>)} small
      options={[{ value: true, label: t.more.on }, { value: false, label: t.more.off }]} />
  );
  const row = (label: string, control: React.ReactNode, hint?: string) => (
    <div className="flex items-center justify-between py-2 gap-3">
      <div>
        <div style={{ fontSize: 15 }}>{label}</div>
        {hint && <div className="faint" style={{ fontSize: 12.5 }}>{hint}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );

  return (
    <section className="card p-5" id="notifications" aria-labelledby="ns-title">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="eyebrow" id="ns-title">{n.settingsTitle}</h2>
        <span className="faint" role="status" style={{ fontSize: 12 }}>{status === "saved" ? n.saved : ""}</span>
      </div>
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{n.settingsNote}</p>
      {problem && <p role="alert" style={{ fontSize: 13, color: "var(--warn)" }}>{problem}</p>}
      {!s ? (
        !problem && <p className="faint mt-2" style={{ fontSize: 13 }}>{t.common.loading}</p>
      ) : (
        <div className="mt-2">
          {row(n.importantDates, onOff(s.prefs.importantDates, "importantDates"))}
          {s.prefs.importantDates && row(n.leadLabel, (
            <select className="input ns-select" aria-label={n.leadLabel} value={s.prefs.importantDateLead}
              onChange={(e) => save({ importantDateLead: Number(e.target.value) as Lead })}>
              {LEADS.map((l) => <option key={l} value={l}>{n.leads[l]}</option>)}
            </select>
          ))}
          {row(n.prioritiesPlanned, onOff(s.prefs.priorities, "priorities"))}
          {s.together && row(n.togetherAssigned, onOff(s.prefs.togetherAssigned, "togetherAssigned"))}
          {s.together && row(n.togetherDue, onOff(s.prefs.togetherDue, "togetherDue"))}
          {row(n.habitReminders, onOff(s.prefs.habits, "habits"), n.habitRemindersHint)}

          <div className="ns-sub">{n.reminderTimes}</div>
          <div className="ns-times">
            {([["morningTime", n.timeMorning], ["daytimeTime", n.timeDaytime], ["nighttimeTime", n.timeNighttime]] as const).map(([key, label]) => (
              <label key={key} className="ns-time">
                <span>{label}</span>
                <input type="time" className="input" value={s.prefs[key]} required
                  onChange={(e) => { if (/^\d{2}:\d{2}$/.test(e.target.value)) void save({ [key]: e.target.value } as Partial<NotificationPrefs>); }} />
              </label>
            ))}
          </div>

          <div className="ns-sub">{n.timeZone}</div>
          <div className="ns-zone">
            <select className="input ns-select" aria-label={n.timeZone} value={s.prefs.timeZone ?? device ?? "UTC"}
              onChange={(e) => save({ timeZone: e.target.value })}>
              {!zones.includes(s.prefs.timeZone ?? device ?? "UTC") && <option value={s.prefs.timeZone ?? device ?? "UTC"}>{s.prefs.timeZone ?? device ?? "UTC"}</option>}
              {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </select>
            <span className="faint" style={{ fontSize: 12.5 }}>{zoneLabelFor(s.prefs.timeZone ?? device ?? "UTC", locale)}</span>
            {device && device !== s.prefs.timeZone && (
              <button type="button" className="btn btn-quiet tg-small" onClick={() => save({ timeZone: device })}>
                {n.useDevice(zoneLabelFor(device, locale))}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
