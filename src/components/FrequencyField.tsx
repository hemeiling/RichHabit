"use client";
import { Field, Segmented } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { frequencyDefaults, scheduleProblem } from "@/lib/habits";
import { useT } from "@/lib/i18n/context";
import { MAX_INTERVAL_DAYS, MAX_TIMES_PER_MONTH } from "@/lib/types";
import type { FreqMode, Frequency } from "@/lib/types";

/**
 * How a habit repeats — the one picker (HT-2b), used by the habit editor and by
 * the template review. Two pickers would be two sets of rules about what a
 * schedule may be, and they would drift.
 */
export default function FrequencyField({ frequency: f, onChange }: {
  frequency: Frequency;
  onChange: (f: Frequency) => void;
}) {
  const t = useT();
  const set = <K extends keyof Frequency>(k: K, v: Frequency[K]) => onChange({ ...f, [k]: v });
  // Each mode arrives with sensible settings; what was chosen before is kept.
  const chooseMode = (mode: FreqMode) => onChange(frequencyDefaults(f, mode, todayISO()));
  const problem = scheduleProblem(f);

  return (
    <Field label={t.habits.fieldFrequency} group>
      <Segmented<FreqMode> value={f.mode} onChange={chooseMode}
        options={[
          { value: "daily", label: t.habits.freqDaily },
          { value: "days", label: t.habits.freqDays },
          { value: "times", label: t.habits.freqTimes },
          { value: "every_n_days", label: t.habits.freqEvery },
          { value: "month_times", label: t.habits.freqMonthTimes },
          { value: "month_days", label: t.habits.freqMonthDays },
        ]} />
      {f.mode === "days" && (
        <div className="flex gap-1.5 mt-2.5">
          {t.days.initial.map((d, i) => (
            <button key={i} type="button" className="chip" data-on={f.days.includes(i)}
              aria-pressed={f.days.includes(i)} aria-label={t.days.short[i]}
              style={{ width: 38, padding: "7px 0", textAlign: "center" }}
              onClick={() => set("days", f.days.includes(i)
                ? f.days.filter((x) => x !== i)
                : [...f.days, i])}>
              {d}
            </button>
          ))}
        </div>
      )}
      {f.mode === "times" && (
        <div className="flex items-center gap-3 mt-2.5">
          <input type="range" min={1} max={7} value={f.timesPerWeek} aria-label={t.habits.freqTimes}
            onChange={(e) => set("timesPerWeek", Number(e.target.value))} style={{ flex: 1 }} />
          <span className="num" style={{ fontSize: 14 }}>{t.habits.perWeek(f.timesPerWeek)}</span>
        </div>
      )}
      {f.mode === "every_n_days" && (
        <div className="mt-2.5">
          <div className="flex items-center flex-wrap" style={{ gap: "8px 16px", fontSize: 14 }}>
            <label className="flex items-center gap-2">
              <span className="muted">{t.habits.intervalLabel}</span>
              <input className="input num" type="number" inputMode="numeric" min={2} max={MAX_INTERVAL_DAYS}
                aria-label={t.habits.intervalAria}
                value={f.intervalDays ?? ""} style={{ width: 80 }}
                onChange={(e) => set("intervalDays", e.target.value === "" ? undefined : Number(e.target.value))} />
              <span className="muted">{t.habits.intervalUnit}</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="muted">{t.habits.anchorLabel}</span>
              <input className="input num" type="date" value={f.anchorDate ?? ""} style={{ width: "auto" }}
                onChange={(e) => e.target.value && set("anchorDate", e.target.value)} />
            </label>
          </div>
          <div className="faint mt-1.5" style={{ fontSize: 12 }}>{t.habits.everyHint}</div>
        </div>
      )}
      {f.mode === "month_times" && (
        <div className="mt-2.5">
          <div className="flex items-center gap-3">
            <input type="range" min={1} max={MAX_TIMES_PER_MONTH} value={f.timesPerMonth ?? 4}
              aria-label={t.habits.freqMonthTimes}
              onChange={(e) => set("timesPerMonth", Number(e.target.value))} style={{ flex: 1 }} />
            <span className="num" style={{ fontSize: 14 }}>{t.habits.perMonth(f.timesPerMonth ?? 4)}</span>
          </div>
          <div className="faint mt-1.5" style={{ fontSize: 12 }}>{t.habits.monthTimesHint}</div>
        </div>
      )}
      {f.mode === "month_days" && (
        <div className="mt-2.5">
          <div className="grid grid-cols-7 gap-1.5" style={{ maxWidth: 320 }}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => {
              const on = (f.daysOfMonth ?? []).includes(d);
              return (
                <button key={d} type="button" className="chip num" data-on={on} aria-pressed={on}
                  style={{ padding: "6px 0", textAlign: "center" }}
                  onClick={() => set("daysOfMonth", on
                    ? (f.daysOfMonth ?? []).filter((x) => x !== d)
                    : [...(f.daysOfMonth ?? []), d].sort((a, b) => a - b))}>
                  {d}
                </button>
              );
            })}
          </div>
          <div className="faint mt-1.5" style={{ fontSize: 12 }}>{t.habits.monthDaysHint}</div>
        </div>
      )}
      {problem && (
        <p role="alert" className="mt-1.5" style={{ color: "var(--warn)", fontSize: 12.5 }}>
          {t.habits.scheduleProblem[problem]}
        </p>
      )}
    </Field>
  );
}
