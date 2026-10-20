"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ProgressView } from "@/lib/together/progressRead";
import { PERIOD_KINDS, filterParam, isPeriodKind, type ContributionRow, type TrendBucket } from "@/lib/together/progress";
import { monthFirst, monthOf, todayISO } from "@/lib/dates";
import { monthTitleFor } from "@/lib/i18n";
import { deviceTimeZone } from "@/lib/zonedTime";
import { useLocale, useT } from "@/lib/i18n/context";
import { Avatar, call } from "@/components/together/shared";
import { Menu, Toast, type ToastState } from "@/components/together/overlay";
import SpaceHeader, { spaceStyle } from "@/components/together/SpaceHeader";
import { FilterMenu, GroupFilter } from "@/components/together/Filters";

/**
 * Project Progress & Contributions — 项目进展与贡献: a space's long-run picture,
 * from the same numbers the Excel export is built from (lib/together/progress).
 *
 * Top to bottom, in the order people asked for: the group filter, the period
 * (All Time by default) and member, then the key figures, story points, each
 * member's completed assigned work, the trend, and the export. Every filter
 * lives in the address, so a view can be shared or reloaded as it is.
 *
 * Calm on purpose. No ranks, no leaderboard, no red: members are listed in the
 * order they joined, and an unfinished period is only that. On a phone nothing
 * is a wide table — figures stack, and the trend's exact numbers are a table
 * behind "Show as a table".
 */

let toastSeq = 0;
const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);
/** The name in a download's Content-Disposition: the UTF-8 one when present (it holds the space's own words). */
function fileNameOf(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) { try { return decodeURIComponent(star[1]); } catch { /* fall through */ } }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? null;
}

export default function SpaceProgress({ boardId }: { boardId: string }) {
  const tt = useT();
  const p = tt.together.progress;
  const w = tt.together.work;
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tz = useMemo(() => deviceTimeZone() ?? "UTC", []);

  const [view, setView] = useState<ProgressView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [exportMenu, setExportMenu] = useState<HTMLElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const say = useCallback((message: string) => setToast({ id: ++toastSeq, message }), []);
  const clearToast = useCallback(() => setToast(null), []);

  // The filters, from the address.
  const rawPeriod = params.get("period");
  const period = isPeriodKind(rawPeriod) ? rawPeriod : "all";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const group = filterParam(params.get("group"));
  const member = filterParam(params.get("member"));
  const setParams = useCallback((changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k); else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, pathname, params]);

  const query = useMemo(() => {
    const q = new URLSearchParams({ tz });
    if (period !== "all") q.set("period", period);
    if (period === "custom") { q.set("from", from); q.set("to", to); }
    if (group !== "all") q.set("group", group);
    if (member !== "all") q.set("member", member);
    return q.toString();
  }, [tz, period, from, to, group, member]);

  // Read for every change of filters, and again when the tab comes back. Only the latest read may land.
  const reads = useRef(0);
  const viewed = useRef(false);
  useEffect(() => {
    const mine = ++reads.current;
    const first = !viewed.current;
    viewed.current = true;
    setBusy(true);
    call<ProgressView>(`/api/together/boards/${boardId}/progress?${query}${first ? "&first=1" : ""}`)
      .then((v) => { if (mine === reads.current) { setView(v); setError(null); } })
      .catch((e: Error & { status?: number }) => {
        if (mine !== reads.current) return;
        if (e.status === 404) setGone(e.message); else setError(e.message);
      })
      .finally(() => { if (mine === reads.current) setBusy(false); });
  }, [boardId, query, reloads]);
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") setReloads((n) => n + 1); };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, []);

  // A filter naming a group or person no longer in the space was dropped by the server: say so, and tidy the
  // address — once per reading (tidying the address re-runs this before the next reading arrives).
  const tidied = useRef<ProgressView | null>(null);
  useEffect(() => {
    if (!view || tidied.current === view || (!view.dropped.group && !view.dropped.member)) return;
    tidied.current = view;
    say(view.dropped.group ? p.groupGone : p.memberGone);
    setParams({ ...(view.dropped.group ? { group: null } : {}), ...(view.dropped.member ? { member: null } : {}) });
  }, [view, say, setParams, p]);

  const choosePeriod = (kind: string) => {
    if (kind === "custom") {
      // Starts as this month so far; the dates are right there to change.
      const today = todayISO();
      setParams({ period: "custom", from: from || monthFirst(monthOf(today)), to: to || today });
    } else setParams({ period: kind === "all" ? null : kind, from: null, to: null });
  };

  const download = async (scope: "view" | "all") => {
    setExportMenu(null);
    setExporting(true);
    try {
      const res = await fetch(`/api/together/boards/${boardId}/progress/export?${query}&scope=${scope}`, { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || p.exportFailed);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileNameOf(res.headers.get("Content-Disposition")) ?? "together-progress.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      say(p.exported);
    } catch (e) {
      say((e as Error).message || p.exportFailed);
    } finally {
      setExporting(false);
    }
  };

  if (gone) {
    return (
      <div className="card p-5" role="alert">
        <p style={{ fontSize: 14 }}>{gone}</p>
        <button className="btn mt-3" onClick={() => router.push("/together")}>← {tt.together.title}</button>
      </div>
    );
  }
  if (!view) {
    return error
      ? (
        <div className="card p-5" role="alert">
          <p style={{ fontSize: 14 }}>{error}</p>
          <button className="btn mt-3" onClick={() => { setError(null); setReloads((n) => n + 1); }}>{tt.together.retry}</button>
        </div>
      )
      : <div className="eyebrow py-10 text-center">{tt.common.loading}</div>;
  }

  const { report, filters } = view;
  const { totals, now } = report;
  const nameOf = new Map(view.members.map((m) => [m.id, m.name]));
  const groupName = (id: string | null) => (id === null ? w.ungrouped : view.groups.find((g) => g.id === id)?.name ?? w.ungrouped);
  const periodLine = filters.period.from && filters.period.to
    ? p.rangeLabel(filters.period.from, filters.period.to)
    : report.firstDay ? p.allTimeSince(report.firstDay) : p.periods.all;
  // "No work yet" only for a space with no work at all: filters that select nothing still show their zeros —
  // and Right now, which describes today whatever the period.
  const empty = view.spaceTasks === 0;
  const contributions = report.contributions.filter((r) => r.memberId !== null || r.assigned.tasks > 0 || filters.member === "none");

  return (
    <div className="tg-space tg-progress" style={spaceStyle(view.space.id)} aria-busy={busy || undefined}>
      <SpaceHeader id={view.space.id} name={view.space.name} members={view.members} view="progress" group={filters.group} />
      {view.space.archived && <p className="tg-archived mt-4" role="status">{w.readOnly}</p>}
      {error && (
        <div className="tg-inline-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-quiet tg-small" onClick={() => setError(null)}>{tt.common.dismiss}</button>
        </div>
      )}

      <section className="tg-section" aria-labelledby="tg-h-progress">
        <h2 className="tg-section-title" id="tg-h-progress">{p.title}</h2>

        {/* 1 · group, 2 · period (and member) */}
        <div className="tg-filterbar">
          {view.groups.length > 0 && (
            <GroupFilter groups={view.groups} value={filters.group} onChange={(g) => setParams({ group: g === "all" ? null : g })} />
          )}
          <FilterMenu label={p.period} value={filters.period.kind} onChange={choosePeriod}
            options={PERIOD_KINDS.map((k, i) => ({ key: k, label: k === "custom" ? p.customRange : p.periods[k], divided: i === PERIOD_KINDS.length - 1 }))} />
          <FilterMenu label={p.member} value={filters.member} onChange={(m) => setParams({ member: m === "all" ? null : m })}
            options={[
              { key: "all", label: p.everyone },
              ...view.members.map((m, i) => ({ key: m.id, label: m.name, divided: i === 0 })),
              { key: "none", label: p.unassigned, divided: true },
            ]} />
        </div>
        {filters.period.kind === "custom" && (
          <form className="tg-range" onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setParams({ period: "custom", from: String(data.get("from") ?? ""), to: String(data.get("to") ?? "") });
          }}>
            <label className="tg-range-field"><span>{p.from}</span>
              <input name="from" type="date" className="input tg-date" defaultValue={filters.period.from ?? ""} min="2000-01-01" max="2100-12-31" required key={`f${filters.period.from}`} />
            </label>
            <label className="tg-range-field"><span>{p.to}</span>
              <input name="to" type="date" className="input tg-date" defaultValue={filters.period.to ?? ""} min="2000-01-01" max="2100-12-31" required key={`t${filters.period.to}`} />
            </label>
            <button type="submit" className="btn btn-quiet tg-small">{p.apply}</button>
          </form>
        )}
        <p className="tg-period-line">{periodLine}</p>

        {empty ? (
          <p className="tg-progress-empty">{p.noWork}</p>
        ) : (
          <>
            {/* 3 · key figures */}
            <div className="tg-stats">
              <div className="tg-stat">
                <span className="tg-stat-label">{p.committed}</span>
                <span className="tg-stat-n">{totals.committed.tasks}</span>
                <span className="tg-stat-note">{p.committedNote}</span>
              </div>
              <div className="tg-stat">
                <span className="tg-stat-label">{p.completed}</span>
                <span className="tg-stat-n">{totals.completed.tasks}</span>
                <span className="tg-stat-note">{p.completedNote}</span>
              </div>
              <div className="tg-stat">
                <span className="tg-stat-label">{p.rate}</span>
                <span className="tg-stat-n">{pct(totals.rate)}</span>
                <span className="tg-stat-note">{p.rateNote(totals.completed.tasks, totals.committed.tasks)}</span>
              </div>
            </div>
            <p className="tg-backlog-line"><strong>{p.backlog}</strong> · {p.backlogNote(totals.backlog.tasks, totals.backlog.points)}</p>

            <div className="tg-now">
              <h3 className="tg-sub-title">{p.rightNow}</h3>
              <ul className="tg-now-list">
                {(["todo", "doing", "waiting"] as const).map((s) => (
                  <li key={s}><span className="tg-now-n">{now[s].tasks}</span> {w.stages[s]}</li>
                ))}
                <li><span className="tg-now-n">{now.dueSoon}</span> {p.dueSoon}</li>
                <li data-warm={now.overdue > 0 || undefined}><span className="tg-now-n">{now.overdue}</span> {p.overdue}</li>
              </ul>
            </div>

            {/* 4 · story points */}
            <section className="tg-psection" aria-labelledby="tg-h-points">
              <h3 className="tg-sub-title" id="tg-h-points">{p.points}</h3>
              <Meter done={totals.completed.points} of={totals.committed.points} />
              <p className="tg-meter-line">{p.pointsDone(totals.completed.points, totals.committed.points)}</p>
              {totals.defaulted > 0 && <p className="tg-note">{p.defaulted(totals.defaulted)}</p>}
              {filters.group === "all" && view.groups.length > 0 && (
                <>
                  <h4 className="tg-sub-sub">{p.byGroup}</h4>
                  <ul className="tg-group-bars">
                    {report.groups.filter((r) => r.committed.tasks > 0 || r.backlog.tasks > 0).map((r) => (
                      <li key={r.groupId ?? "none"} className="tg-group-bar">
                        <span className="tg-group-bar-name">{groupName(r.groupId)}</span>
                        <Meter done={r.completed.points} of={r.committed.points} small />
                        <span className="tg-group-bar-figs">
                          {p.ofPoints(r.completed.points, r.committed.points)} · {p.tasksDone(r.completed.tasks, r.committed.tasks)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            {/* 5 · individual contributions */}
            <section className="tg-psection" aria-labelledby="tg-h-contrib">
              <h3 className="tg-sub-title" id="tg-h-contrib">{p.contributions}</h3>
              <p className="tg-note">{p.attribution}</p>
              {contributions.every((r) => r.assigned.tasks === 0) ? (
                <p className="tg-note">{p.noContributions}</p>
              ) : (
                <ul className="tg-contrib">
                  {contributions.map((r) => (
                    <Contribution key={r.memberId ?? "none"} row={r} name={r.memberId === null ? p.notAssigned : nameOf.get(r.memberId) ?? p.notAssigned} />
                  ))}
                </ul>
              )}
            </section>

            {/* 6 · trends */}
            <section className="tg-psection" aria-labelledby="tg-h-trends">
              <h3 className="tg-sub-title" id="tg-h-trends">{p.trends}</h3>
              <Trend buckets={report.trend.buckets} granularity={report.trend.granularity} locale={locale} />
            </section>
          </>
        )}

        {/* 7 · export */}
        <section className="tg-psection tg-export" aria-labelledby="tg-h-export">
          <h3 className="sr-only" id="tg-h-export">{p.exportExcel}</h3>
          <button type="button" className="btn tg-export-btn" aria-haspopup="menu" disabled={exporting}
            onClick={(e) => setExportMenu(e.currentTarget)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
            {exporting ? p.exporting : p.exportExcel}
          </button>
          <p className="tg-note">{p.exportAbout}</p>
        </section>

        <details className="tg-how">
          <summary>{p.howTitle}</summary>
          <ul>{p.how.map((line) => <li key={line}>{line}</li>)}</ul>
        </details>
      </section>

      {exportMenu && (
        <Menu anchor={exportMenu} title={p.exportExcel} currentLabel="" onClose={() => setExportMenu(null)} items={[
          { key: "view", label: `${p.exportView} — ${p.exportViewNote}`, onSelect: () => { void download("view"); } },
          { key: "all", label: `${p.exportAll} — ${p.exportAllNote}`, onSelect: () => { void download("all"); } },
        ]} />
      )}
      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}

/** A quiet bar: how much of something is done. Decorative — the words beside it say the same. */
function Meter({ done, of, small }: { done: number; of: number; small?: boolean }) {
  const share = of > 0 ? Math.min(1, done / of) : 0;
  return (
    <span className="tg-meter" data-small={small || undefined} aria-hidden="true">
      <span className="tg-meter-fill" style={{ width: `${share * 100}%` }} />
    </span>
  );
}

function Contribution({ row, name }: { row: ContributionRow; name: string }) {
  const p = useT().together.progress;
  return (
    <li className="tg-contrib-row" data-nobody={row.memberId === null || undefined}>
      <span className="tg-contrib-who">
        {row.memberId !== null && <Avatar name={name} size={26} />}
        <span className="tg-contrib-name">{name}</span>
      </span>
      <dl className="tg-contrib-figs">
        <div><dt>{p.assigned}</dt><dd>{row.assigned.tasks}</dd></div>
        <div><dt>{p.completedAssigned}</dt><dd>{row.completed.tasks} <span className="tg-faint">· {pct(row.rate)}</span></dd></div>
        <div><dt>{p.points}</dt><dd>{p.ofPoints(row.completed.points, row.assigned.points)}</dd></div>
        <div><dt>{p.sharedTasks}</dt><dd>{row.shared}</dd></div>
      </dl>
    </li>
  );
}

/**
 * Completed story points per week or month, as quiet bars — at most the latest
 * 36, so a years-long project still fits a phone; every bucket is in the table
 * behind "Show as a table" (and in the export's Monthly Trends).
 */
function Trend({ buckets, granularity, locale }: { buckets: TrendBucket[]; granularity: "week" | "month"; locale: ReturnType<typeof useLocale> }) {
  const p = useT().together.progress;
  const last = buckets[buckets.length - 1];
  if (!last || last.cumTasks === 0) return <p className="tg-note">{p.noTrend}</p>;
  const label = (b: TrendBucket) => (granularity === "week" ? p.weekOf(b.start) : monthTitleFor(b.start.slice(0, 7), locale));
  const shown = buckets.slice(-36);
  const max = Math.max(...shown.map((b) => b.points), 1);
  const marks = new Set([0, Math.floor((shown.length - 1) / 2), shown.length - 1]);
  return (
    <>
      <p className="tg-note">{granularity === "week" ? p.perWeek : p.perMonth}</p>
      <div className="tg-trend" role="img" aria-label={p.trendTotal(last.cumTasks, last.cumPoints)}>
        {shown.map((b, i) => (
          <span key={b.start} className="tg-trend-col" title={p.bar(label(b), b.tasks, b.points)}>
            <span className="tg-trend-bar" style={{ height: `${Math.max(b.points > 0 ? 4 : 0, (b.points / max) * 100)}%` }} />
            <span className="tg-trend-tick" aria-hidden="true">{marks.has(i) || shown.length <= 8 ? shortLabel(b, granularity, locale) : ""}</span>
          </span>
        ))}
      </div>
      <p className="tg-meter-line">{p.trendTotal(last.cumTasks, last.cumPoints)}</p>
      <details className="tg-trend-table">
        <summary>{p.showTable}</summary>
        <div className="tg-table-wrap">
          <table>
            <thead><tr><th scope="col">{p.colWhen}</th><th scope="col">{p.colTasks}</th><th scope="col">{p.colPoints}</th><th scope="col">{p.colRunning}</th></tr></thead>
            <tbody>
              {[...buckets].reverse().map((b) => (
                <tr key={b.start}><th scope="row">{label(b)}</th><td>{b.tasks}</td><td>{b.points}</td><td>{b.cumPoints}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

/**
 * The axis's few labels: a day for weeks ("10/13"), a month for months — "Oct",
 * or "Jan 2024" in another year (never "Jan 24", which reads as a day).
 */
function shortLabel(b: TrendBucket, granularity: "week" | "month", locale: string): string {
  const tag = locale === "zh" ? "zh-CN" : "en-US";
  const d = new Date(`${b.start}T12:00:00`);
  if (granularity === "week") return d.toLocaleDateString(tag, { month: "numeric", day: "numeric" });
  return d.toLocaleDateString(tag, d.getFullYear() === new Date().getFullYear() ? { month: "short" } : { month: "short", year: "numeric" });
}
