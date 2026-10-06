"use client";
import { useRef, useState } from "react";
import type { TaskSummary } from "@/lib/together/work";
import { useT } from "@/lib/i18n/context";
import { Assignees, DueText, Effort } from "@/components/together/TaskCard";
import type { Person } from "@/components/together/shared";
import type { useListDrag } from "@/components/together/useListDrag";

/**
 * The Backlog — 想法池: what "we might" do. Capturing is one field and Enter;
 * nothing else has to be decided. Committing is one tap, to the top of To do;
 * "Commit to…" chooses another stage.
 *
 * Rows rather than cards: this is a list to scan and pick from, and it can be
 * long, so it stays light — quieter than the Board above it. On a desktop a row
 * can be dragged up to a board stage (committing it) or within the Backlog, and
 * cards can be dragged down into it.
 */
export default function Backlog({ tasks, today, members, groups, readOnly, onCapture, onOpen, onCommit, onCommitTo, dnd }: {
  tasks: TaskSummary[];
  today: string;
  members: Map<string, Person>;
  groups: Map<string, string>;
  readOnly: boolean;
  onCapture: (title: string) => Promise<boolean>;
  onOpen: (task: TaskSummary) => void;
  onCommit: (task: TaskSummary) => void;
  onCommitTo: (task: TaskSummary, anchor: HTMLElement) => void;
  dnd: ReturnType<typeof useListDrag>;
}) {
  const t = useT().together.work;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const capture = async () => {
    const title = value.trim();
    if (!title || busy) return;
    setBusy(true);
    const ok = await onCapture(title);
    setBusy(false);
    if (ok) setValue("");
    field.current?.focus();
  };

  return (
    <div className="tg-backlog" {...dnd.list("backlog", tasks)}>
      <p className="tg-backlog-intro">{t.backlogIntro}</p>

      {!readOnly && (
        <form className="tg-capture" onSubmit={(e) => { e.preventDefault(); capture(); }}>
          <span className="tg-capture-plus" aria-hidden="true">+</span>
          <input ref={field} className="tg-capture-input" value={value} maxLength={200} enterKeyHint="done"
            aria-label={t.captureLabel} placeholder={t.capturePlaceholder}
            onChange={(e) => setValue(e.target.value)} />
          <button type="submit" className="tg-capture-go" disabled={!value.trim() || busy}>{t.add}</button>
        </form>
      )}

      {tasks.length === 0 ? (
        <div className="tg-backlog-empty">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
          </svg>
          <p className="tg-backlog-empty-title">{t.empty.backlogTitle}</p>
          <p className="tg-backlog-empty-body">{t.empty.backlog}</p>
        </div>
      ) : (
        <ul className="tg-blist">
          {tasks.map((task) => {
            const group = task.groupId ? groups.get(task.groupId) : undefined;
            const meta = group || task.dueOn || task.effort || task.assignees.some((id) => members.has(id));
            const drag = dnd.card(task, "backlog", tasks);
            return (
              <li key={task.id} className="tg-brow" data-meta={meta || undefined} data-task-id={task.id}
                draggable={drag.enabled || undefined} data-dragging={drag.dragging || undefined}
                data-drop={drag.dropBefore ? "before" : drag.dropAfter ? "after" : undefined}
                onPointerDown={(e) => { (e.currentTarget as HTMLElement).dataset.pressControl = (e.target as Element).closest("[data-no-drag]") ? "1" : ""; }}
                onDragStart={drag.enabled ? (e) => {
                  if ((e.currentTarget as HTMLElement).dataset.pressControl) { e.preventDefault(); return; }
                  drag.onStart(e);
                } : undefined}
                onDragEnd={drag.enabled ? drag.onEnd : undefined}>
                <button type="button" className="tg-brow-open" onClick={() => onOpen(task)} aria-label={t.openTask(task.title)}>
                  <span className="tg-brow-title">{task.title}</span>
                </button>
                {meta && (
                  <span className="tg-brow-meta">
                    {group && <span className="tg-group">{group}</span>}
                    {task.dueOn && <DueText dueOn={task.dueOn} today={today} />}
                    {task.effort && <Effort value={task.effort} />}
                    <Assignees ids={task.assignees} members={members} size={20} />
                  </span>
                )}
                {!readOnly && (
                  <span className="tg-brow-actions" data-no-drag>
                    <button type="button" className="tg-commit" onClick={() => onCommit(task)} aria-label={t.commitAria(task.title)}>
                      {t.commit}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
                    </button>
                    <button type="button" className="tg-commit-to" aria-haspopup="menu" aria-label={`${t.commitTo} ${task.title}`}
                      onClick={(e) => onCommitTo(task, e.currentTarget)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
