"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { call } from "@/components/together/shared";
import { Field, Segmented } from "@/components/ui";
import { useT } from "@/lib/i18n/context";
import { habitTime, isClock, type NotificationPrefs } from "@/lib/notifications/model";
import type { Category } from "@/lib/types";

/**
 * "Remind me" in the habit editor — off unless switched on here, habit by
 * habit. It saves on its own, as it changes (it is a notification setting, not
 * part of the habit), so Cancel on the editor leaves it as set. A new habit has
 * nothing to attach a reminder to until it is saved. Shown only when the
 * notification settings load (an account on a database without them sees
 * nothing rather than a broken switch).
 */
export default function HabitReminderField({ habitId, category, isNew }: {
  habitId: string; category: Category; isNew: boolean;
}) {
  const t = useT();
  const n = t.notifications;
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [on, setOn] = useState(false);
  const [time, setTime] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    call<{ prefs: NotificationPrefs; habitReminders: Record<string, string | null> }>("/api/notifications/preferences")
      .then((s) => {
        if (!live) return;
        setPrefs(s.prefs);
        setOn(habitId in s.habitReminders);
        setTime(s.habitReminders[habitId] ?? "");
      })
      .catch(() => {});
    return () => { live = false; };
  }, [habitId]);

  if (!prefs) return null;
  if (isNew) return <Field label={n.remindMe} group><p className="faint" style={{ fontSize: 12.5 }}>{n.remindAfterSave}</p></Field>;

  const save = async (nextOn: boolean, nextTime: string) => {
    setProblem(null);
    try {
      await call(`/api/notifications/habits/${habitId}`, {
        method: "PUT", body: JSON.stringify({ on: nextOn, time: nextOn && isClock(nextTime) ? nextTime : null }),
      });
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  const fallback = habitTime(prefs, category, null);

  return (
    <Field label={n.remindMe} group hint={on ? n.remindDefault(fallback) : undefined}>
      <div className="he-remind">
        <Segmented<boolean> value={on} small
          onChange={(v) => { setOn(v); void save(v, time); }}
          options={[{ value: true, label: t.more.on }, { value: false, label: t.more.off }]} />
        {on && (
          <input type="time" className="input" aria-label={n.remindAt} value={time} placeholder={fallback}
            onChange={(e) => {
              const v = e.target.value;
              setTime(v);
              if (v === "" || isClock(v)) void save(true, v);
            }} />
        )}
      </div>
      {on && !prefs.habits && (
        <p className="faint mt-1" style={{ fontSize: 12 }}>
          {n.remindOff} <Link href="/more#notifications" className="underline">{n.settings}</Link>
        </p>
      )}
      {problem && <p role="alert" className="mt-1" style={{ fontSize: 12.5, color: "var(--warn)" }}>{problem}</p>}
    </Field>
  );
}
