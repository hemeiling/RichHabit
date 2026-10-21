"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DrillTask, ProgressView } from "@/lib/together/progressRead";
import { PERIOD_KINDS, effectivePoints, filterParam, isPeriodKind, type ContributionRow, type TrendBucket } from "@/lib/together/progress";
import { monthFirst, monthOf, todayISO } from "@/lib/dates";
import { monthTitleFor } from "@/lib/i18n";
import { deviceTimeZone } from "@/lib/zonedTime";
import { useLocale, useT } from "@/lib/i18n/context";
import { Avatar, call } from "@/components/together/shared";
import { Menu, Toast, type ToastState } from "@/components/together/overlay";
import SpaceHeader, { spaceStyle } from "@/components/together/SpaceHeader";
import { FilterMenu, GroupFilter } from "@/components/together/Filters";

/**
 * Project Progress & Contributions — 项目进展与贡献: summary first, details on
 * demand. The default view answers three questions at a glance — how much of
 * the project is done, how each group is doing, what each person is working on
 * — and everything else (work by stage, due dates, the Backlog, defaulted
 * points, trends, how the numbers work) waits behind More details. Every number
 * comes from the same calculations as the Excel export (lib/together/progress).
 *
 * Rows explore rather than decorate: a group narrows the whole dashboard to it
 * (the existing group filter); a member — or the unassigned work — opens the
 * tasks behind that row, each one a link to its sheet on the Board. Filters live
 * in the address; the open/closed state of More details and More filters is
 * remembered per person per space in this browser.
 *
 * Calm on purpose: no ranks and no red. Members are in the order they joined.
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

/** A remembered yes/no for this person in this space; storage may be unavailable (private mode). */
function useRemembered(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    try { const v = localStorage.getItem(key); if (v !== null) setValue(v === "1"); } catch { /* not remembered */ }
  }, [key]);
  const set = useCallback((v: boolean) => {
    setValue(v);
    try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* remembered for this visit only */ }
  }, [key]);
  return [value, set];
}

export default function SpaceProgress({ boardId, viewerId }: { boardId: string; viewerId: string }) {
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
  /** Which contributions row has its tasks open: a member's id, "none" (unassigned), or none. */
  const [drill, setDrill] = useState<string | null>(null);
  const say = useCallback((message: string) => setToast({ id: ++toastSeq, message }), []);
  const clearToast = useCallback(() => setToast(null), []);
  const prefix = `rh:tg-progress:${viewerId}:${boardId}`;
  const [detailsOpen, setDetailsOpen] = useRemembered(`${prefix}:details`, false);
  const [filtersOpen, setFiltersOpen] = useRemembered(`${prefix}:filters`, false);

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

  /** The dashboard's filters except the member — the drill-down picks its own person. */
  const baseQuery = useMemo(() => {
    const q = new URLSearchParams({ tz });
    if (period !== "all") q.set("period", period);
    if (period === "custom") { q.set("from", from); q.set("to", to); }
    if (group !== "all") q.set("group", group);
    return q;
  }, [tz, period, from, to, group]);
  const query = useMemo(() => {
    const q = new URLSearchParams(baseQuery);
    if (member !== "all") q.set("member", member);
    return q.toString();
  }, [baseQuery, member]);

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
  // A changed filter closes an open drill-down: its list belonged to the old one.
  useEffect(() => { setDrill(null); }, [query]);

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

  const { report, filters, context } = view;
  const { totals, now } = report;
  const nameOf = new Map(view.members.map((m) => [m.id, m.name]));
  const groupName = (id: string | null) => (id === null ? w.ungrouped : view.groups.find((g) => g.id === id)?.name ?? w.ungrouped);
  const periodLine = filters.period.from && filters.period.to
    ? p.rangeLabel(filters.period.from, filters.period.to)
    : report.firstDay ? p.allTimeSince(report.firstDay) : p.periods.all;
  // "No work yet" only for a space with no work at all: filters that select nothing still show their zeros.
  const empty = view.spaceTasks === 0;
  const people = report.contributions.filter((r) => r.memberId !== null);
  const unassigned = report.contributions.find((r) => r.memberId === null);
  const groupRows = report.groups.filter((r) => r.committed.tasks > 0);
  const moreFiltersShown = filtersOpen || filters.member !== "all";

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
        <div className="tg-progress-head">
          <h2 className="tg-section-title" id="tg-h-progress">{p.title}</h2>
          <button type="button" className="btn btn-quiet tg-small tg-export-btn" aria-haspopup="menu" disabled={exporting}
            onClick={(e) => setExportMenu(e.currentTarget)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
            {exporting ? p.exporting : p.exportExcel}
          </button>
        </div>

        {/* The two filters people use most stay in sight; the member filter waits under More filters. */}
        <div className="tg-filterbar">
          {view.groups.length > 0 && (
            <GroupFilter groups={view.groups} value={filters.group} onChange={(g) => setParams({ group: g === "all" ? null : g })} />
          )}
          <FilterMenu label={p.period} value={filters.period.kind} onChange={choosePeriod}
            options={PERIOD_KINDS.map((k, i) => ({ key: k, label: k === "custom" ? p.customRange : p.periods[k], divided: i === PERIOD_KINDS.length - 1 }))} />
          <button type="button" className="tg-more-filters" aria-expanded={moreFiltersShown} aria-controls="tg-more-filters"
            onClick={() => setFiltersOpen(!moreFiltersShown)}>
            {p.moreFilters}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        </div>
        {moreFiltersShown && (
          <div className="tg-filterbar tg-filterbar-more" id="tg-more-filters">
            <FilterMenu label={p.member} value={filters.member} onChange={(m) => setParams({ member: m === "all" ? null : m })}
              options={[
                { key: "all", label: p.everyone },
                ...view.members.map((m, i) => ({ key: m.id, label: m.name, divided: i === 0 })),
                { key: "none", label: p.unassigned, divided: true },
              ]} />
          </div>
        )}
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
            {/* 1 · How much is done */}
            <div className="tg-summary">
              <div className="tg-summary-top">
                <span className="tg-summary-pct">{pct(totals.rate)}</span>
                <span className="tg-summary-label">{p.complete}</span>
              </div>
              <Meter done={totals.completed.tasks} of={totals.committed.tasks} big />
              {totals.committed.tasks > 0 ? (
                <p className="tg-summary-line">
                  <span>{p.tasksOf(totals.completed.tasks, totals.committed.tasks)}</span>
                  <span className="tg-summary-dot" aria-hidden="true">·</span>
                  <span>{p.remaining(totals.open.tasks)}</span>
                </p>
              ) : <p className="tg-summary-line">{p.noCommitted}</p>}
              <p className="tg-summary-sub">{p.pointsSummary(totals.completed.points, totals.committed.points)}</p>
              {filters.group !== "all" && (
                <p className="tg-summary-filter">
                  {p.filteredTo(groupName(filters.group === "none" ? null : filters.group))}
                  <button type="button" className="tg-link-btn" onClick={() => setParams({ group: null })}>{p.showAllGroups}</button>
                </p>
              )}
            </div>

            {/* 2 · How each group is doing — a group narrows the whole dashboard to it */}
            {filters.group === "all" && view.groups.length > 0 && groupRows.length > 0 && (
              <section className="tg-psection" aria-labelledby="tg-h-groups">
                <h3 className="tg-sub-title" id="tg-h-groups">{p.groupsTitle}</h3>
                <ul className="tg-prows">
                  {groupRows.map((r) => {
                    const name = groupName(r.groupId);
                    return (
                      <li key={r.groupId ?? "none"}>
                        <button type="button" className="tg-prow" aria-label={`${p.showGroup(name)} — ${p.tasksDone(r.completed.tasks, r.committed.tasks)}, ${pct(r.rate)}`}
                          onClick={() => setParams({ group: r.groupId ?? "none" })}>
                          <span className="tg-prow-name">{name}</span>
                          <span className="tg-prow-figs">{r.completed.tasks}/{r.committed.tasks} · {pct(r.rate)}</span>
                          <Meter done={r.completed.tasks} of={r.committed.tasks} />
                          <span className="tg-prow-pts">{p.ofPoints(r.completed.points, r.committed.points)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* 3 · What each person is working on — a row opens the tasks behind it */}
            <section className="tg-psection" aria-labelledby="tg-h-contrib">
              <h3 className="tg-sub-title" id="tg-h-contrib">{p.contributions}</h3>
              <p className="tg-note">{p.shortNote}</p>
              {people.length > 0 && (
                <ul className="tg-prows">
                  {people.map((r) => {
                    const name = nameOf.get(r.memberId as string) ?? p.unassigned;
                    return (
                      <ContributionItem key={r.memberId} row={r} name={name} avatar open={drill === r.memberId}
                        onToggle={() => setDrill(drill === r.memberId ? null : r.memberId)}
                        boardId={boardId} baseQuery={baseQuery} groupName={groupName}
                        onOnly={() => setParams({ member: r.memberId })} onlyLabel={p.onlyMember} />
                    );
                  })}
                </ul>
              )}
              {unassigned && (unassigned.assigned.tasks > 0 || filters.member === "none") && (
                <div className="tg-unassigned" aria-labelledby="tg-h-unassigned" role="group">
                  <h4 className="tg-sub-sub" id="tg-h-unassigned">{p.unassignedTitle}</h4>
                  <ul className="tg-prows">
                    <ContributionItem row={unassigned} name={p.unassignedRow} open={drill === "none"}
                      onToggle={() => setDrill(drill === "none" ? null : "none")}
                      boardId={boardId} baseQuery={baseQuery} groupName={groupName}
                      onOnly={() => setParams({ member: "none" })} onlyLabel={p.onlyUnassigned} />
                  </ul>
                </div>
              )}
            </section>

            {/* Everything else, one tap away — and remembered open or closed. */}
            <details className="tg-details" open={detailsOpen}
              onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== detailsOpen) setDetailsOpen(o); }}>
              <summary className="tg-details-summary">{p.moreDetails}</summary>
              <div className="tg-details-body">
                <section aria-labelledby="tg-h-now">
                  <h3 className="tg-sub-title" id="tg-h-now">{p.rightNow}</h3>
                  <ul className="tg-now-list">
                    {(["todo", "doing", "waiting"] as const).map((s) => (
                      <li key={s}><span className="tg-now-n">{now[s].tasks}</span> {w.stages[s]}</li>
                    ))}
                    <li><span className="tg-now-n">{now.dueSoon}</span> {p.dueSoon}</li>
                    <li data-warm={now.overdue > 0 || undefined}><span className="tg-now-n">{now.overdue}</span> {p.overdue}</li>
                  </ul>
                </section>

                <section aria-labelledby="tg-h-points">
                  <h3 className="tg-sub-title" id="tg-h-points">{p.points}</h3>
                  <p className="tg-meter-line">{p.pointsDone(totals.completed.points, totals.committed.points)}</p>
                  {totals.defaulted > 0 && <p className="tg-note">{p.defaulted(totals.defaulted)}</p>}
                  <p className="tg-backlog-line"><strong>{p.backlog}</strong> · {p.backlogNote(totals.backlog.tasks, totals.backlog.points)}</p>
                </section>

                <section aria-labelledby="tg-h-trends">
                  <h3 className="tg-sub-title" id="tg-h-trends">{p.trends}</h3>
                  <ul className="tg-context">
                    {context.start && <li>{p.projectStarted(context.start)}</li>}
                    {context.lastCompleted && <li>{p.lastCompleted(context.lastCompleted)}</li>}
                    <li>{p.completedThisMonth(context.completedThisMonth)}</li>
                  </ul>
                  <Trend buckets={report.trend.buckets} granularity={report.trend.granularity} locale={locale} />
                </section>

                <section aria-labelledby="tg-h-how">
                  <h3 className="tg-sub-title" id="tg-h-how">{p.howTitle}</h3>
                  <ul className="tg-how-list">{p.how.map((line) => <li key={line}>{line}</li>)}</ul>
                  <p className="tg-note">{p.exportAbout}</p>
                </section>
              </div>
            </details>
          </>
        )}
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
function Meter({ done, of, big }: { done: number; of: number; big?: boolean }) {
  const share = of > 0 ? Math.min(1, done / of) : 0;
  return (
    <span className="tg-meter" data-big={big || undefined} aria-hidden="true">
      <span className="tg-meter-fill" style={{ width: `${share * 100}%` }} />
    </span>
  );
}

/**
 * One row of contributions — a member, or the unassigned work — and, opened,
 * the committed tasks behind it for the dashboard's filters (fetched then, never
 * before). Each task links to its sheet on the Board.
 */
function ContributionItem({ row, name, avatar, open, onToggle, boardId, baseQuery, groupName, onOnly, onlyLabel }: {
  row: ContributionRow; name: string; avatar?: boolean; open: boolean; onToggle: () => void;
  boardId: string; baseQuery: URLSearchParams; groupName: (id: string | null) => string;
  onOnly: () => void; onlyLabel: string;
}) {
  const tt = useT();
  const p = tt.together.progress;
  const w = tt.together.work;
  const who = row.memberId ?? "none";
  const panel = `tg-drill-${who}`;
  const [tasks, setTasks] = useState<DrillTask[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!open) { setTasks(null); setFailed(null); return; }
    let live = true;
    const q = new URLSearchParams(baseQuery);
    q.set("who", who);
    call<{ tasks: DrillTask[] }>(`/api/together/boards/${boardId}/progress/tasks?${q}`)
      .then((r) => { if (live) setTasks(r.tasks); })
      .catch((e: Error) => { if (live) setFailed(e.message); });
    return () => { live = false; };
  }, [open, who, boardId, baseQuery]);

  return (
    <li className="tg-prow-item" data-open={open || undefined} data-nobody={row.memberId === null || undefined}>
      <button type="button" className="tg-prow" aria-expanded={open} aria-controls={panel}
        aria-label={`${p.showTasksOf(name)} — ${p.tasksDone(row.completed.tasks, row.assigned.tasks)}, ${pct(row.rate)}`}
        onClick={onToggle}>
        <span className="tg-prow-name">
          {avatar && <Avatar name={name} size={24} />}
          <span className="tg-prow-label">{name}</span>
          {row.shared > 0 && <span className="tg-badge">{p.sharedBadge(row.shared)}</span>}
        </span>
        <span className="tg-prow-figs">{row.completed.tasks}/{row.assigned.tasks} · {pct(row.rate)}</span>
        <Meter done={row.completed.tasks} of={row.assigned.tasks} />
        <span className="tg-prow-pts">{p.ofPoints(row.completed.points, row.assigned.points)}</span>
        <svg className="tg-prow-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="tg-drill" id={panel}>
          {failed ? <p className="tg-note" role="alert">{failed}</p>
            : tasks === null ? <p className="tg-note">{tt.common.loading}</p>
            : tasks.length === 0 ? <p className="tg-note">{p.drillEmpty}</p>
            : (
              <ul className="tg-drill-list">
                {tasks.map((t) => (
                  <li key={t.id} className="tg-drill-row">
                    <Link className="tg-drill-title" href={`/together/b/${boardId}?task=${t.id}${t.inHistory ? "&history=1" : ""}`}
                      aria-label={w.openTask(t.title)}>
                      {t.standing === "completed" && (
                        <svg className="tg-card-tick" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                      )}
                      <span>{t.title}</span>
                    </Link>
                    <span className="tg-drill-meta">
                      <span className="tg-group">{groupName(t.groupId)}</span>
                      <span>{t.inHistory ? p.inHistoryShort : w.stages[t.stage]}</span>
                      {t.dueOn && t.standing === "open" && <span>{w.dueDate}: {w.due.later(t.dueOn)}</span>}
                      {t.completedOn && t.standing === "completed" && <span>{w.completedOn(t.completedOn)}</span>}
                      {t.shared && <span className="tg-badge">{p.sharedTag}</span>}
                      <span className="tg-effort" data-default={t.effort === null || undefined} role="img"
                        aria-label={t.effort === null ? w.pointsDefault : w.pointsValue(t.effort)}>{effectivePoints(t.effort)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          <button type="button" className="tg-link-btn tg-drill-only" onClick={onOnly}>{onlyLabel}</button>
        </div>
      )}
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
