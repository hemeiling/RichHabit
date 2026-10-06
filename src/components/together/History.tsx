"use client";
import type { TaskSummary } from "@/lib/together/work";
import { addDays, iso } from "@/lib/dates";
import { useT } from "@/lib/i18n/context";
import { Assignees } from "@/components/together/TaskCard";
import type { Person } from "@/components/together/shared";

/**
 * History — 历史: what we've done. Work that has been in Done for more than 24
 * hours, newest finished first, grouped by the day it was finished in the
 * reader's own calendar. It is not a list you work in: nothing is dropped here
 * and nothing is reordered. A row opens the task; Reopen sends it back to the
 * Board. Older work is a "Show older" away, a page at a time, and nothing is
 * ever removed for its age.
 */
export default function History({ heading, history, today, members, groups, readOnly, onOpen, onReopen, onShowOlder }: {
  heading: string;
  history: { tasks: TaskSummary[]; more: boolean; total: number } | null;
  today: string;
  members: Map<string, Person>;
  groups: Map<string, string>;
  readOnly: boolean;
  onOpen: (task: TaskSummary) => void;
  onReopen: (task: TaskSummary, anchor: HTMLElement) => void;
  onShowOlder: () => void;
}) {
  const t = useT().together.work;
  const tasks = history?.tasks ?? [];
  const total = history?.total ?? 0;

  // Grouped by the reader's local date of finishing (most recent entry into Done).
  const days: { day: string; tasks: TaskSummary[] }[] = [];
  for (const task of tasks) {
    const day = iso(new Date(task.movedAt.replace(/(\.\d{3})\d*Z$/, "$1Z")));
    const last = days[days.length - 1];
    if (last && last.day === day) last.tasks.push(task);
    else days.push({ day, tasks: [task] });
  }
  const yesterday = addDays(today, -1);
  const label = (day: string) => (day === today ? t.due.today : day === yesterday ? t.yesterday : t.historyDay(day));
  const remaining = Math.max(0, total - tasks.length);

  return (
    <div className="tg-history">
      <div className="tg-section-row">
        <h2 className="tg-section-title" id={heading}>{t.history}</h2>
        {total > 0 && <span className="tg-history-count">{t.historyCount(total)}</span>}
      </div>
      {tasks.length === 0 ? (
        <p className="tg-history-empty">{t.historyEmpty}</p>
      ) : (
        days.map((d) => (
          <div key={d.day} className="tg-history-day">
            <h3 className="tg-history-date">{label(d.day)}</h3>
            <ul className="tg-hlist">
              {d.tasks.map((task) => {
                const group = task.groupId ? groups.get(task.groupId) : undefined;
                return (
                  <li key={task.id} className="tg-hrow">
                    <button type="button" className="tg-hrow-open" onClick={() => onOpen(task)} aria-label={t.openTask(task.title)}>
                      <svg className="tg-card-tick" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                      <span className="tg-hrow-title">{task.title}</span>
                    </button>
                    <span className="tg-hrow-meta">
                      {group && <span className="tg-group">{group}</span>}
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
        ))
      )}
      {history?.more && remaining > 0 && (
        <button type="button" className="tg-older-btn" onClick={onShowOlder}>{t.showOlder(remaining)}</button>
      )}
    </div>
  );
}
