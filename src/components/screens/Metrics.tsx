"use client";
import { useState } from "react";
import { useHabits } from "@/components/store";
import { Field, Segmented, Spark } from "@/components/ui";
import { rangeBack, shortDate, todayISO } from "@/lib/dates";
import { useLocale, useT } from "@/lib/i18n/context";
import { prettyDateFor, shortDateFor } from "@/lib/i18n";
import type { DayMetrics } from "@/lib/types";

const FIELDS = [
  { key: "weight", step: "0.1" },
  { key: "calories", step: "10" },
  { key: "sleep", step: "0.25" },
  { key: "water", step: "1" },
  { key: "cardioMin", step: "5" },
] as const satisfies readonly { key: keyof DayMetrics; step: string }[];

const LABEL_KEY = {
  weight: "weight", calories: "calories", sleep: "sleep", water: "water", cardioMin: "cardio",
} as const;
const UNIT_KEY = {
  weight: null, calories: "unitKcal", sleep: "unitHours", water: "unitGlasses", cardioMin: "unitMinutes",
} as const;

export default function Metrics() {
  const { state, actions } = useHabits();
  const t = useT();
  const locale = useLocale();
  const [date, setDate] = useState(todayISO());
  const [span, setSpan] = useState(30);
  const entry = state.metrics[date] ?? {};
  const dates = rangeBack(todayISO(), span);

  const series = (key: keyof DayMetrics) =>
    dates.map((d) => {
      const raw = state.metrics[d]?.[key];
      return { d, v: raw === "" || raw == null || typeof raw === "boolean" ? null : Number(raw) };
    });

  const average = (key: keyof DayMetrics) => {
    const vs = series(key).map((p) => p.v).filter((v): v is number => v != null && !Number.isNaN(v));
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };

  const unit = (key: (typeof FIELDS)[number]["key"]) => {
    const k = UNIT_KEY[key];
    return k ? t.metrics[k] : "";
  };
  const label = (key: (typeof FIELDS)[number]["key"]) => {
    const u = unit(key);
    return u ? `${t.metrics[LABEL_KEY[key]]} (${u})` : t.metrics[LABEL_KEY[key]];
  };

  const dayCount = (key: "gym" | "cardio") => dates.filter((d) => state.metrics[d]?.[key]).length;

  const latestWeight = [...dates].reverse()
    .map((d) => state.metrics[d]?.weight)
    .find((v) => v != null && v !== "");

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="eyebrow">{t.metrics.logFor}</div>
            <h1 className="display" style={{ fontSize: 21, marginTop: 2 }}>{shortDateFor(date, locale)}</h1>
          </div>
          <input className="input num" type="date" value={date} max={todayISO()} style={{ width: 160 }}
            onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <Field key={f.key} label={label(f.key)}>
              <input
                className="input num" type="number" step={f.step} placeholder="—"
                value={(entry[f.key] as string | number | undefined) ?? ""}
                onChange={(e) => actions.setMetrics(date, { [f.key]: e.target.value } as DayMetrics)}
              />
            </Field>
          ))}
        </div>
        <div className="flex gap-2 mt-1">
          <button className="chip" data-on={!!entry.gym} onClick={() => actions.setMetrics(date, { gym: !entry.gym })}>{t.metrics.gymDay}</button>
          <button className="chip" data-on={!!entry.cardio} onClick={() => actions.setMetrics(date, { cardio: !entry.cardio })}>{t.metrics.cardioDay}</button>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="eyebrow">{t.metrics.trends}</div>
          <Segmented<number> value={span} onChange={setSpan} small
            options={[{ value: 7, label: t.metrics.spanWeek }, { value: 30, label: t.metrics.spanMonth }, { value: 365, label: t.metrics.spanYear }]} />
        </div>
        <div className="flex flex-col gap-5">
          {FIELDS.map((f) => {
            const avg = average(f.key);
            return (
              <div key={f.key}>
                <div className="flex items-baseline justify-between">
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{t.metrics[LABEL_KEY[f.key]]}</span>
                  <span className="muted num" style={{ fontSize: 13 }}>
                    {avg == null
                      ? t.metrics.noEntries
                      : t.metrics.avg(avg.toFixed(f.key === "calories" ? 0 : 1), unit(f.key))}
                  </span>
                </div>
                <div className="mt-1.5"><Spark points={series(f.key)} /></div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="flat p-3.5">
            <div className="eyebrow" style={{ fontSize: 10 }}>{t.metrics.gymDays}</div>
            <div className="display num mt-1" style={{ fontSize: 26 }}>{dayCount("gym")}</div>
          </div>
          <div className="flat p-3.5">
            <div className="eyebrow" style={{ fontSize: 10 }}>{t.metrics.cardioDays}</div>
            <div className="display num mt-1" style={{ fontSize: 26 }}>{dayCount("cardio")}</div>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <Field label={t.metrics.goalWeight} hint={t.metrics.goalWeightHint}>
          <input className="input num" type="number" step="0.1" placeholder="—"
            value={state.prefs.goalWeight ?? ""}
            onChange={(e) => actions.setPrefs({ goalWeight: e.target.value === "" ? null : Number(e.target.value) })} />
        </Field>
        {state.prefs.goalWeight != null && latestWeight != null && (
          <p className="muted num" style={{ fontSize: 14 }}>
            {t.metrics.latest(
              Number(latestWeight).toFixed(1),
              Math.abs(Number(latestWeight) - state.prefs.goalWeight).toFixed(1),
            )}
          </p>
        )}
      </section>
    </div>
  );
}
