"use client";
import type { HistoryMonth, TaskSummary } from "@/lib/together/work";
import { iso } from "@/lib/dates";
import { effectivePoints } from "@/lib/together/progress";
import { useT } from "@/lib/i18n/context";
import { Assignees } from "@/components/together/TaskCard";
import type { Person } from "@/components/together/shared";

/**
 * History — 历史: what we've done. Work that has been in Done for more than 24
 * hours, newest finished first.
 *
 * Collapsed until someone opens it — each person's choice is remembered per
 * space (the caller keeps it) — because a long-running space's History can hold
 * years of work and the Board is what people come for. Collapsed, the heading
 * still says how much it holds (tasks and story points, for the group filter in
 * use), and Progress counts History in full either way: hiding the list changes
 * no number anywhere.
 *
 * Open, it is a list to look things up in, not one to work in: a search over
 * titles, grouped by the month each task was finished in the reader's own
 * calendar (with that month's count and points, from the server, so a month
 * only half loaded still shows its true size), each row with its completion
 * date and story points — an unestimated task shows its default 1, faintly. A
 * row opens the task; Reopen sends it back to the Board. Older work is a "Show
 * older" away, a page at a time; nothing is ever removed for its age.
 */

export interface HistoryRows { tasks: TaskSummary[]; more: boolean; total: number; points: number; months: HistoryMonth[] }

/** The reader's calendar day a task entered Done (a microsecond timestamp; Date keeps milliseconds). */
export const finishedOn = (task: Pick<TaskSummary, "movedAt">) => iso(new Date(task.movedAt.replace(/(\.\d{3})\d*Z$/, "$1Z")));

export default function History({ heading, open, onToggle, summary, rows, search, onSearch, filtered,
  members, groups, readOnly, onOpen, onReopen, onShowOlder }: {
  heading: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  /** What History holds for the filters in use — known even while it is collapsed. */
  summary: { total: number; points: number };
  /** The rows on screen while open; null until the first page has arrived. */
  rows: HistoryRows | null;
  search: string;
  onSearch: (text: string) => void;
  /** A group filter is on, so an empty History says so rather than "nothing here". */
  filtered: boolean;
  members: Map<string, Person>;
  groups: Map<string, string>;
  readOnly: boolean;
  onOpen: (task: TaskSummary) => void;
  onReopen: (task: TaskSummary, anchor: HTMLElement) => void;
  onShowOlder: () => void;
}) {
  const tt = useT();
  const t = tt.together.work;
  const body = `${heading}-body`;

  const months: { month: string; tasks: TaskSummary[] }[] = [];
  for (const task of rows?.tasks ?? []) {
    const month = finishedOn(task).slice(0, 7);
    const last = months[months.length - 1];
    if (last && last.month === month) last.tasks.push(task);
    else months.push({ month, tasks: [task] });
  }
  const sizeOf = new Map((rows?.months ?? []).map((m) => [m.month, m]));
  const remaining = rows ? Math.max(0, rows.total - rows.tasks.length) : 0;
  const searching = search.trim().length > 0;

  return (
    <div className="tg-history" data-open={open || undefined}>
      <div className="tg-section-row">
        <h2 className="tg-section-title" id={heading}>
          <button type="button" className="tg-disclose" aria-expanded={open} aria-controls={body} onClick={() => onToggle(!open)}>
            <svg className="tg-disclose-mark" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            {t.history}
          </button>
        </h2>
        {summary.total > 0 && <span className="tg-history-count">{t.historySummary(summary.total, summary.points)}</span>}
      </div>

      {open && (
        <div id={body} className="tg-history-body">
          {(summary.total > 0 || searching) && (
            <div className="tg-hsearch" role="search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
              <input type="search" className="tg-hsearch-input" value={search} maxLength={100} enterKeyHint="search"
                aria-label={t.historySearch} placeholder={t.historySearchPlaceholder} onChange={(e) => onSearch(e.target.value)} />
            </div>
          )}
          {rows === null ? (
            <p className="tg-history-empty">{tt.common.loading}</p>
          ) : rows.tasks.length === 0 ? (
            <p className="tg-history-empty">{searching ? t.historyNoMatch : filtered ? t.historyNoneInGroup : t.historyEmpty}</p>
          ) : (
            months.map((m) => {
              const size = sizeOf.get(m.month);
              return (
                <div key={m.month} className="tg-history-day">
                  <h3 className="tg-history-date">
                    <span>{t.historyMonth(m.month)}</span>
                    {size && <span className="tg-history-mcount">{t.historyMonthCount(size.tasks, size.points)}</span>}
                  </h3>
                  <ul className="tg-hlist">
                    {m.tasks.map((task) => {
                      const group = task.groupId ? groups.get(task.groupId) : undefined;
                      const unestimated = task.effort === null;
                      return (
                        <li key={task.id} className="tg-hrow">
                          <button type="button" className="tg-hrow-open" onClick={() => onOpen(task)} aria-label={t.openTask(task.title)}>
                            <svg className="tg-card-tick" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                            <span className="tg-hrow-title">{task.title}</span>
                          </button>
                          <span className="tg-hrow-meta">
                            <span className="tg-hrow-when">{t.completedOn(finishedOn(task))}</span>
                            {group && <span className="tg-group">{group}</span>}
                            <span className="tg-effort" data-default={unestimated || undefined} role="img"
                              aria-label={unestimated ? t.pointsDefault : t.pointsValue(task.effort as number)}
                              title={unestimated ? t.pointsDefault : undefined}>
                              {effectivePoints(task.effort)}
                            </span>
                            <Assignees ids={task.assignees} members={members} size={18} />
                          </span>
                          {!readOnly && (
                            <button type="button" className="tg-reopen" aria-haspopup="menu" aria-label={t.reopenTask(task.title)}
                              onClick={(e) => onReopen(task, e.currentTarget)}>
                              {t.reopen}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
          {rows?.more && remaining > 0 && (
            <button type="button" className="tg-older-btn" onClick={onShowOlder}>{t.showOlder(remaining)}</button>
          )}
        </div>
      )}
    </div>
  );
}
