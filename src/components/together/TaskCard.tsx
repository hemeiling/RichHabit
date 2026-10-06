"use client";
import { useRef, type DragEvent } from "react";
import type { TaskSummary } from "@/lib/together/work";
import { dueState, isWarm } from "@/lib/together/due";
import { useT } from "@/lib/i18n/context";
import { Avatar, type Person } from "@/components/together/shared";

/**
 * One task on the board or in the Backlog.
 *
 * The title is the card. Beneath it, one quiet line carries only what helps
 * decide what to do next: the group, the due date (warm when it is today or
 * past, never red), who has it, and its effort as a small number. Nothing is
 * shown when there is nothing to say — except on work that is under way or
 * waiting, where a faint dashed circle asks who has it.
 *
 * The whole card opens the task (a stretched button, so it is one keyboard
 * stop); Move to… is a separate button above it.
 *
 * On a desktop the whole card can also be dragged — no handle. A press that
 * moves becomes a drag (the browser's own threshold); a press that does not is
 * a click and opens the task. A press that starts on a control (Move to…) never
 * becomes a drag.
 */

export interface CardDrag {
  enabled: boolean;
  /** This card is the one being dragged: it stays as a calm placeholder. */
  dragging: boolean;
  /** The drop would land just above / just below this card. */
  dropBefore: boolean;
  dropAfter: boolean;
  onStart: (e: DragEvent<HTMLElement>) => void;
  onEnd: () => void;
}

export function DueText({ dueOn, today, done }: { dueOn: string; today: string; done?: boolean }) {
  const t = useT().together.work;
  const state = dueState(dueOn, today);
  const label = state === "today" ? t.due.today : state === "tomorrow" ? t.due.tomorrow
    : state === "overdue" ? t.due.overdue(dueOn) : state === "soon" ? t.due.soon(dueOn) : t.due.later(dueOn);
  // Done work has no due treatment: it is finished, whenever it was due.
  const shown = done ? t.due.later(dueOn) : label;
  return (
    <span className="tg-due" data-state={done ? "later" : state} data-warm={!done && isWarm(state) || undefined}
      aria-label={`${t.dueDate}: ${shown}`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>
      {shown}
    </span>
  );
}

export function Assignees({ ids, members, size = 22, max = 2 }: { ids: string[]; members: Map<string, Person>; size?: number; max?: number }) {
  const t = useT().together.work;
  const people = ids.map((id) => members.get(id)).filter((p): p is Person => !!p);
  if (!people.length) return null;
  const shown = people.slice(0, max);
  return (
    <span className="tg-avatars tg-assignees" role="img" aria-label={t.assignedTo(people.map((p) => p.name).join(", "))}>
      {shown.map((p) => <Avatar key={p.id} name={p.name} size={size} />)}
      {people.length > shown.length && (
        <span className="tg-avatar tg-more" style={{ width: size, height: size }} aria-hidden="true">+{people.length - shown.length}</span>
      )}
    </span>
  );
}

export function Effort({ value }: { value: number }) {
  const t = useT().together.work;
  return <span className="tg-effort" role="img" aria-label={t.effortValue(value)}>{value}</span>;
}

export default function TaskCard({ task, today, members, groups, readOnly, onOpen, onMove, drag }: {
  task: TaskSummary;
  today: string;
  members: Map<string, Person>;
  groups: Map<string, string>;
  readOnly: boolean;
  onOpen: () => void;
  onMove: (anchor: HTMLElement) => void;
  drag?: CardDrag;
}) {
  const t = useT().together.work;
  const pressedControl = useRef(false);
  const done = task.stage === "done";
  const group = task.groupId ? groups.get(task.groupId) : undefined;
  const assigned = task.assignees.some((id) => members.has(id));
  const askWho = !assigned && (task.stage === "doing" || task.stage === "waiting");
  const hasMeta = group || task.dueOn || assigned || askWho || task.effort || task.hasDescription;
  return (
    <article className="tg-card" data-done={done || undefined} data-movable={!readOnly || undefined} data-task-id={task.id}
      draggable={drag?.enabled || undefined} data-dragging={drag?.dragging || undefined}
      data-drop={drag?.dropBefore ? "before" : drag?.dropAfter ? "after" : undefined}
      onPointerDown={(e) => { pressedControl.current = !!(e.target as Element).closest("[data-no-drag]"); }}
      onDragStart={drag?.enabled ? (e) => { if (pressedControl.current) { e.preventDefault(); return; } drag.onStart(e); } : undefined}
      onDragEnd={drag?.enabled ? drag.onEnd : undefined}>
      <button type="button" className="tg-card-open" onClick={onOpen} aria-label={t.openTask(task.title)}>
        {done && (
          <svg className="tg-card-tick" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        )}
        <span className="tg-card-title">{task.title}</span>
      </button>
      {hasMeta && (
        <div className="tg-card-meta">
          <span className="tg-card-info">
            {group && <span className="tg-group">{group}</span>}
            {task.dueOn && <DueText dueOn={task.dueOn} today={today} done={done} />}
            {task.hasDescription && (
              <svg className="tg-has-notes" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9" /></svg>
            )}
          </span>
          {task.effort && <Effort value={task.effort} />}
          {assigned
            ? <Assignees ids={task.assignees} members={members} />
            : askWho && <span className="tg-nobody" role="img" aria-label={t.nobodyYet} />}
        </div>
      )}
      {/* In the corner, not in the line beneath: that line is for the task's own signals. */}
      {!readOnly && (
        <button type="button" className="tg-card-move" data-no-drag aria-label={t.moveTask(task.title)} aria-haspopup="menu"
          onClick={(e) => onMove(e.currentTarget)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
        </button>
      )}
    </article>
  );
}
