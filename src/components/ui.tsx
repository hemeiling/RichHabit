"use client";
import React, { useEffect } from "react";
import { addDays, dow, rangeBack, shortDate, todayISO } from "@/lib/dates";
import { dayScore } from "@/lib/habits";
import type { AppState } from "@/lib/types";

export function Sheet({
  open, onClose, title, children, footer,
}: {
  open: boolean; onClose: () => void; title: string;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <div className="scrim" onClick={onClose} />
      <div className="sheet fade-in">
        <div className="flex items-start justify-between mb-4">
          <h2 className="display" style={{ fontSize: 26, lineHeight: 1.1 }}>{title}</h2>
          <button className="btn btn-quiet" onClick={onClose}>Close</button>
        </div>
        {children}
        {footer && <div className="mt-5 flex gap-2 justify-end">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <div className="eyebrow mb-1.5">{label}</div>
      {children}
      {hint && <div className="faint mt-1" style={{ fontSize: 12 }}>{hint}</div>}
    </label>
  );
}

export function Segmented<T extends string | number | boolean>({
  value, onChange, options, small,
}: {
  value: T; onChange: (v: T) => void;
  options: { value: T; label: string }[]; small?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)} type="button" className="chip" data-on={value === o.value}
          style={small ? { padding: "5px 11px", fontSize: 12.5 } : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Check() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.5 10.5l3.6 3.6L15.5 6.8" stroke="var(--accent-ink)" strokeWidth="2.4"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Empty({
  title, body, action,
}: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="card p-7 text-center">
      <div className="display" style={{ fontSize: 22 }}>{title}</div>
      <p className="muted mt-1.5 mx-auto" style={{ fontSize: 14, maxWidth: 320 }}>{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * The one deliberately bold element: a segmented arc where every scheduled
 * habit is a tick, and its length is its priority. A high-priority habit
 * visibly takes up more of the day than a low one.
 */
export function ScoreDial({
  score, segments, size = 168,
}: { score: number | null; segments: { weight: number; done: boolean }[]; size?: number }) {
  const R = size / 2, inner = R - 20, outer = R - 6;
  const total = segments.reduce((a, s) => a + s.weight, 0) || 1;
  const START = -220, SWEEP = 260;
  let acc = 0;

  const point = (ang: number, r: number): [number, number] => {
    const rad = ((ang - 90) * Math.PI) / 180;
    return [R + r * Math.cos(rad), R + r * Math.sin(rad)];
  };

  const ticks = segments.map((s, i) => {
    const a0 = START + (acc / total) * SWEEP;
    acc += s.weight;
    const a1 = START + (acc / total) * SWEEP;
    const gap = 0.055 * (SWEEP / segments.length);
    const [x0, y0] = point(a0 + gap, inner);
    const [x1, y1] = point(a1 - gap, inner);
    const [x2, y2] = point(a1 - gap, outer);
    const [x3, y3] = point(a0 + gap, outer);
    const large = a1 - a0 > 180 ? 1 : 0;
    return (
      <path
        key={i}
        d={`M${x0} ${y0} A${inner} ${inner} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${outer} ${outer} 0 ${large} 0 ${x3} ${y3} Z`}
        fill={s.done ? "var(--accent)" : "var(--line)"}
        style={{ transition: "fill .3s ease" }}
      />
    );
  });

  return (
    <div style={{ width: size, height: size, position: "relative", flex: "none" }}>
      <svg width={size} height={size} aria-hidden="true">{ticks}</svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", paddingTop: 4,
      }}>
        <div className="display num" style={{ fontSize: 52, lineHeight: 1 }}>
          {score == null ? "—" : score}
          {score != null && <span style={{ fontSize: 22 }}>%</span>}
        </div>
        <div className="eyebrow mt-1">Habit score</div>
      </div>
    </div>
  );
}

export function Heatmap({
  state, weeks = 17, onPick,
}: { state: AppState; weeks?: number; onPick?: (d: string) => void }) {
  const end = todayISO();
  const last = addDays(end, 6 - dow(end));
  const days = rangeBack(last, weeks * 7);
  const cols: string[][] = [];
  for (let i = 0; i < days.length; i += 7) cols.push(days.slice(i, i + 7));

  const color = (d: string) => {
    if (d > end) return "transparent";
    const s = dayScore(state, d);
    if (s.total === 0) return "var(--line-soft)";
    if (s.pct === 0) return "var(--line)";
    return `color-mix(in srgb, var(--accent) ${Math.round(18 + ((s.pct ?? 0) / 100) * 82)}%, var(--line-soft))`;
  };

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {cols.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-1">
            {col.map((d) => (
              <button
                key={d}
                onClick={() => d <= end && onPick?.(d)}
                title={`${shortDate(d)} · ${dayScore(state, d).pct ?? "—"}%`}
                aria-label={`${shortDate(d)}, ${dayScore(state, d).pct ?? 0} percent`}
                style={{
                  width: 13, height: 13, borderRadius: 3.5, border: "none", padding: 0,
                  background: color(d), cursor: d <= end ? "pointer" : "default",
                  outline: d === end ? "1.5px solid var(--ink)" : "none", outlineOffset: 1,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2.5 faint" style={{ fontSize: 11 }}>
        <span>{shortDate(days[0])}</span>
        <span className="flex-1" />
        <span>Less</span>
        {[0, 30, 60, 100].map((p) => (
          <span key={p} style={{
            width: 11, height: 11, borderRadius: 3,
            background: p === 0 ? "var(--line)" : `color-mix(in srgb, var(--accent) ${18 + p * 0.82}%, var(--line-soft))`,
          }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

export function Spark({
  points, height = 52, format = (v: number) => String(v),
}: { points: { d: string; v: number | null }[]; height?: number; format?: (v: number) => string }) {
  const vals = points.filter((p): p is { d: string; v: number } => p.v != null && !Number.isNaN(p.v));
  if (vals.length < 2) {
    return <div className="faint" style={{ fontSize: 13 }}>Two entries and a line appears here.</div>;
  }
  const min = Math.min(...vals.map((p) => p.v));
  const max = Math.max(...vals.map((p) => p.v));
  const span = max - min || 1;
  const W = 300;
  const xy = vals.map((p, i): [number, number] => [
    (i / (vals.length - 1)) * W,
    height - ((p.v - min) / span) * (height - 10) - 5,
  ]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none">
        <path d={`${d} L${W} ${height} L0 ${height} Z`} fill="var(--accent-soft)" opacity=".8" />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round"
          strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="3" fill="var(--accent)" />
      </svg>
      <div className="flex justify-between faint num mt-1" style={{ fontSize: 11 }}>
        <span>{format(min)}</span><span>{format(max)}</span>
      </div>
    </div>
  );
}

export function Bars({ rows }: { rows: { label: string; value: number | null; sub?: string }[] }) {
  const max = Math.max(100, ...rows.map((r) => r.value ?? 0));
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between items-baseline" style={{ fontSize: 13.5 }}>
            <span>{r.label}</span>
            <span className="num muted">
              {r.value == null ? "—" : `${r.value}%`}{r.sub ? ` · ${r.sub}` : ""}
            </span>
          </div>
          <div style={{ height: 6, background: "var(--line-soft)", borderRadius: 4, marginTop: 5, overflow: "hidden" }}>
            <div style={{
              width: `${((r.value ?? 0) / max) * 100}%`, height: "100%",
              background: "var(--accent)", borderRadius: 4, transition: "width .4s ease",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}
