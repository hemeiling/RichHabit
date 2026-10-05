"use client";
import { useRef, useState, type KeyboardEvent } from "react";
import type { TaskSummary } from "@/lib/together/work";
import { BOARD_STAGES, type BoardStage } from "@/lib/together/stages";
import { useLocale, useT } from "@/lib/i18n/context";
import { dict } from "@/lib/i18n";
import TaskCard from "@/components/together/TaskCard";
import type { Person } from "@/components/together/shared";

/**
 * The board: To do, In progress, Waiting, Done.
 *
 * Wide, the four stages sit side by side as calm columns. Narrow — a phone, or
 * a tablet with the sidebar open — it is one stage at a time, chosen from a
 * four-part control, never four squeezed columns or a board that scrolls
 * sideways. It is one DOM either way: a container query decides, so the server
 * and the first paint agree and nothing jumps on load.
 */

export interface BoardProps {
  tasks: TaskSummary[];
  older: { tasks: TaskSummary[]; more: boolean } | null;
  doneOlder: number;
  today: string;
  members: Map<string, Person>;
  groups: Map<string, string>;
  readOnly: boolean;
  /** The stage shown when narrow; kept in the URL. */
  stage: BoardStage;
  onStage: (stage: BoardStage) => void;
  onAdd: (stage: BoardStage, title: string) => Promise<boolean>;
  onOpen: (task: TaskSummary) => void;
  onMove: (task: TaskSummary, anchor: HTMLElement) => void;
  onShowOlder: () => void;
}

/** A stage's name; in bilingual mode on two lines, where a single joined label would not fit. */
export function StageName({ stage }: { stage: BoardStage | "backlog" }) {
  const locale = useLocale();
  const t = useT().together.work;
  if (locale !== "both") return <>{t.stages[stage]}</>;
  return (
    <span className="tg-two">
      <span>{dict("en").together.work.stages[stage]}</span>
      <span className="tg-two-sub">{dict("zh").together.work.stages[stage]}</span>
    </span>
  );
}

/** "+ Add" that becomes a field. Enter adds and keeps it open for the next one; Escape (or leaving it empty) closes it. */
export function QuickAdd({ label, placeholder, hint, onAdd, autoOpen = false }: {
  label: string; placeholder: string; hint: string; onAdd: (title: string) => Promise<boolean>; autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); setValue(""); requestAnimationFrame(() => opener.current?.focus()); };
  const submit = async () => {
    const title = value.trim();
    if (!title || busy) return;
    setBusy(true);
    const ok = await onAdd(title);
    setBusy(false);
    if (ok) { setValue(""); field.current?.focus(); }
  };
  if (!open) {
    return (
      <button ref={opener} type="button" className="tg-add" onClick={() => setOpen(true)}>
        <span className="tg-add-plus" aria-hidden="true">+</span>{label}
      </button>
    );
  }
  return (
    <form className="tg-add-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <input ref={field} className="tg-add-input" autoFocus value={value} maxLength={200} aria-label={label}
        placeholder={placeholder} enterKeyHint="done" disabled={busy && !value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(); } }}
        onBlur={() => { if (!value.trim() && !busy) setOpen(false); }} />
      <p className="tg-add-hint" aria-hidden="true">{hint}</p>
    </form>
  );
}

export default function WorkBoard(p: BoardProps) {
  const t = useT().together.work;
  const byStage = new Map<BoardStage, TaskSummary[]>(BOARD_STAGES.map((s) => [s, []]));
  for (const task of p.tasks) if (task.stage !== "backlog") byStage.get(task.stage)!.push(task);
  const counts = (s: BoardStage) => byStage.get(s)!.length + (s === "done" ? p.doneOlder : 0);
  const shownOlder = p.older?.tasks.length ?? 0;
  const remaining = Math.max(0, p.doneOlder - shownOlder);

  // Arrow keys move between the stage tabs, as in any tab list.
  const onTabsKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = BOARD_STAGES.indexOf(p.stage);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? 3 : null;
    if (next === null) return;
    e.preventDefault();
    const stage = BOARD_STAGES[(next + 4) % 4];
    p.onStage(stage);
    requestAnimationFrame(() => document.getElementById(`tg-stage-tab-${stage}`)?.focus());
  };

  return (
    <div className="tg-work">
      <div className="tg-stagebar" role="tablist" aria-label={t.stagePicker} onKeyDown={onTabsKey}>
        {BOARD_STAGES.map((s) => (
          <button key={s} id={`tg-stage-tab-${s}`} type="button" role="tab" className="tg-stage"
            aria-selected={p.stage === s} aria-controls={`tg-col-${s}`} tabIndex={p.stage === s ? 0 : -1}
            aria-label={t.stageTab(s, counts(s))} onClick={() => p.onStage(s)}>
            <span className="tg-stage-name"><StageName stage={s} /></span>
            <span className="tg-stage-n" aria-hidden="true">{counts(s)}</span>
          </button>
        ))}
      </div>

      <div className="tg-cols">
        {BOARD_STAGES.map((s) => {
          const list = byStage.get(s)!;
          return (
            <section key={s} id={`tg-col-${s}`} className="tg-col" data-stage={s} data-current={p.stage === s || undefined}
              aria-labelledby={`tg-col-head-${s}`} role="region">
              <h3 className="tg-col-head" id={`tg-col-head-${s}`}>
                <span className="tg-col-name">{t.stages[s]}</span>
                <span className="tg-col-n">{counts(s)}</span>
              </h3>
              {!p.readOnly && (
                <QuickAdd label={t.addTo(s)} placeholder={t.addPlaceholder} hint={t.addHint}
                  onAdd={(title) => p.onAdd(s, title)} />
              )}
              {list.length > 0 ? (
                <ul className="tg-card-list">
                  {list.map((task) => (
                    <li key={task.id}>
                      <TaskCard task={task} today={p.today} members={p.members} groups={p.groups} readOnly={p.readOnly}
                        onOpen={() => p.onOpen(task)} onMove={(a) => p.onMove(task, a)} />
                    </li>
                  ))}
                </ul>
              ) : (s !== "done" || !p.doneOlder) && (
                <p className="tg-col-empty">{t.empty[s]}</p>
              )}
              {s === "done" && shownOlder > 0 && (
                <ul className="tg-card-list tg-older">
                  {p.older!.tasks.map((task) => (
                    <li key={task.id}>
                      <TaskCard task={task} today={p.today} members={p.members} groups={p.groups} readOnly={p.readOnly}
                        onOpen={() => p.onOpen(task)} onMove={(a) => p.onMove(task, a)} />
                    </li>
                  ))}
                </ul>
              )}
              {s === "done" && (shownOlder === 0 ? p.doneOlder > 0 : p.older!.more) && (
                <button type="button" className="tg-older-btn" onClick={p.onShowOlder}>
                  {shownOlder === 0 ? t.showOlder(p.doneOlder) : `${t.showMore} (${remaining})`}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
