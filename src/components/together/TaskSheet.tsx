"use client";
import { useEffect, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import type { GroupView, TaskDetail, TaskSummary } from "@/lib/together/work";
import { EFFORT_CHOICES, type BoardStage, type Stage } from "@/lib/together/stages";
import { quickDue } from "@/lib/together/due";
import { useT } from "@/lib/i18n/context";
import { Avatar, call, type Person } from "@/components/together/shared";
import { Dialog } from "@/components/together/overlay";
import { StageName } from "@/components/together/WorkBoard";

/**
 * A task's sheet: everything about it, revealed only when someone opens it.
 *
 * Small fields — people, group, effort, due date — save the moment they change,
 * each on its own, so two people changing different things both win. The title
 * and description save when you leave them, and carry the version they were
 * edited from: if someone else changed the words meanwhile, the server refuses,
 * and this sheet shows both versions and lets you choose. Your draft is never
 * dropped without you choosing — the sheet will not close over an unresolved
 * conflict.
 */

type Field = "title" | "description";
/** How a save of the words ended: only "ok" lets the sheet close. */
type Outcome = "ok" | "conflict" | "error";
interface Conflict { fields: Partial<Record<Field, string>>; theirs: TaskDetail }

function AutoGrow(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} />;
}

const errorOf = (e: unknown) => e as Error & { status?: number };

export default function TaskSheet({
  boardId, taskId, live, spaceName, members, groups, viewerId, today, archived, inHistory,
  onClose, onChanged, onMove, onReopen, onDelete, onRestored, onGroupCreated,
}: {
  boardId: string;
  taskId: string;
  /** The board's copy of this task, so a move made from the menu shows here at once. */
  live: TaskSummary | undefined;
  spaceName: string;
  members: Person[];
  groups: GroupView[];
  viewerId: string;
  today: string;
  archived: boolean;
  /** Done for more than 24 hours: shown in History, and only Reopen moves it. */
  inHistory: boolean;
  onClose: () => void;
  onChanged: (task: TaskSummary) => void;
  onMove: (task: TaskSummary, anchor: HTMLElement) => void;
  onReopen: (task: TaskSummary, anchor: HTMLElement) => void;
  onDelete: (task: TaskSummary) => void;
  onRestored: (task: TaskSummary) => void;
  onGroupCreated: (group: GroupView) => void;
}) {
  const tt = useT();
  const t = tt.together.work;
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [conflict, setConflictState] = useState<Conflict | null>(null);
  // Also in a ref: closing reads it after awaiting saves, past any render.
  const conflictNow = useRef<Conflict | null>(null);
  const setConflict = (c: Conflict | null) => { conflictNow.current = c; setConflictState(c); };
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [picking, setPicking] = useState(false);
  const current = useRef<TaskDetail | null>(null);
  current.current = detail;
  const conflictRef = useRef<HTMLDivElement>(null);
  /**
   * Saves go out one at a time, in the order they were made, and each reply
   * updates only the fields its own request changed. Typing a description and
   * then tapping a person are two requests; the description's reply carries
   * the whole task as it was *before* the tap, and adopting all of it would put
   * the old people back on screen — and the next tap would build on that.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  /**
   * The text version the words on screen were edited from. Moved only by a
   * text save's reply or a fresh reading — never by a small field's reply,
   * which may carry someone else's newer version: adopting that would let the
   * next save silently overwrite their words.
   */
  const version = useRef(0);
  const inOrder = <R,>(fn: () => Promise<R>): Promise<R> => {
    const next = queue.current.then(fn, fn);
    queue.current = next.catch(() => {});
    return next;
  };
  const base = `/api/together/boards/${boardId}/tasks/${taskId}`;

  const fetchDetail = () => call<TaskDetail>(base);
  const adopt = (d: TaskDetail) => { version.current = d.textVersion; setDetail(d); setTitle(d.title); setDescription(d.description); };

  useEffect(() => {
    let alive = true;
    fetchDetail().then((d) => { if (alive) adopt(d); }).catch((e) => { if (alive) setLoadError(errorOf(e).message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // A move made from the menu (or elsewhere on the board) shows here at once.
  useEffect(() => {
    if (live && detail && (live.stage !== detail.stage || live.movedAt !== detail.movedAt)) {
      setDetail({ ...detail, stage: live.stage, movedAt: live.movedAt });
    }
  }, [live, detail]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(0), 1800);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const readOnly = archived || !!detail?.deletedAt;

  const send = async (body: Record<string, unknown>): Promise<TaskSummary> => {
    const { task } = await call<{ task: TaskSummary }>(base, { method: "PATCH", body: JSON.stringify(body) });
    onChanged(task);
    setSaved(Date.now());
    return task;
  };

  /** Title and description: from the version they were edited on. */
  const saveText = (fields: Partial<Record<Field, string>>, baseVersion?: number) => inOrder(async (): Promise<Outcome> => {
    // Read when this save goes out, not when it was queued: an earlier save of
    // my own (the title, a moment before the description) has moved it on.
    const from = baseVersion ?? version.current;
    setError(null);
    try {
      const task = await send({ ...fields, textVersion: from });
      // Adopt the version only if it is ours: one step on (this save changed the
      // words) or unchanged (it changed nothing). Anything else means someone
      // else changed the words meanwhile, unseen here — keeping the old version
      // makes the next real edit meet them as a conflict instead of erasing them.
      if (task.textVersion === from + 1 || task.textVersion === from) {
        version.current = task.textVersion;
        setDetail((d) => (d ? {
          ...d, title: task.title, textVersion: task.textVersion, hasDescription: task.hasDescription,
          ...(fields.description !== undefined ? { description: fields.description } : {}),
        } : d));
      }
      return "ok";
    } catch (e) {
      const err = errorOf(e);
      if (err.status === 409 || err.status === 410) {
        const theirs = await fetchDetail().catch(() => null);
        if (theirs?.deletedAt) { setDetail(theirs); setError(err.message); return "error"; }
        if (theirs && theirs.textVersion !== from) {
          setConflict({ fields, theirs });
          requestAnimationFrame(() => conflictRef.current?.focus());
          return "conflict";
        }
      }
      setError(err.message);
      return "error";
    }
  });

  const flushText = async (): Promise<Outcome> => {
    const d = current.current;
    if (conflictNow.current) return "conflict";
    if (!d || readOnly) return "ok";
    const fields: Partial<Record<Field, string>> = {};
    const cleanTitle = title.replace(/\s+/g, " ").trim();
    if (!cleanTitle) setTitle(d.title);
    else if (cleanTitle !== d.title) fields.title = cleanTitle;
    if (description.replace(/\s+$/, "") !== d.description) fields.description = description;
    return Object.keys(fields).length ? saveText(fields) : "ok";
  };

  /** One small field, shown at once and put back if the server refuses. */
  const saveField = (body: Record<string, unknown>, optimistic: Partial<TaskDetail>) => {
    const before = current.current;
    if (!before) return Promise.resolve();
    setError(null);
    setDetail({ ...before, ...optimistic });
    return inOrder(async () => {
      try {
        const task = await send(body);
        // Only what this request changed.
        const own = Object.fromEntries(Object.keys(optimistic).map((k) => [k, task[k as keyof TaskSummary]]));
        setDetail((d) => (d ? { ...d, ...own } : d));
      } catch (e) {
        // Put back what this change replaced, keeping anything changed since.
        setDetail((d) => (d ? { ...d, ...Object.fromEntries(Object.keys(optimistic).map((k) => [k, before[k as keyof TaskDetail]])) } : d));
        setError(errorOf(e).message);
        if (errorOf(e).status === 410) fetchDetail().then(adopt).catch(() => {});
      }
    });
  };

  /**
   * Closes only once the words are safely saved. A conflict, or a save that
   * failed, keeps the sheet open with the draft in it — closing would lose it.
   */
  const requestClose = async () => {
    const outcome = conflictNow.current ? "conflict" : await flushText();
    if (outcome === "ok") onClose();
    else if (outcome === "conflict") conflictRef.current?.focus();
  };

  const keepMine = async () => {
    if (!conflict) return;
    const { fields, theirs } = conflict;
    setConflict(null);
    // Their version of everything, then my words only where I chose to keep them:
    // a field I did not edit must show (and later save) theirs, never my stale copy.
    version.current = theirs.textVersion;
    setDetail(theirs);
    setTitle(fields.title ?? theirs.title);
    setDescription(fields.description ?? theirs.description);
    await saveText(fields, theirs.textVersion);
  };
  const useTheirs = () => {
    if (!conflict) return;
    adopt(conflict.theirs);
    setConflict(null);
  };

  const restore = async () => {
    try {
      const { task } = await call<{ task: TaskSummary }>(`${base}/restore`, { method: "POST" });
      adopt(await fetchDetail());
      onRestored(task);
    } catch (e) { setError(errorOf(e).message); }
  };

  const createGroup = async (name: string) => {
    try {
      const { group } = await call<{ group: GroupView }>(`/api/together/boards/${boardId}/groups`, {
        method: "POST", body: JSON.stringify({ name }) });
      onGroupCreated(group);
      await saveField({ groupId: group.id }, { groupId: group.id });
    } catch (e) { setError(errorOf(e).message); }
  };

  if (loadError) {
    return (
      <Dialog label={t.task} onClose={onClose}>
        <p role="alert" style={{ fontSize: 14 }}>{loadError}</p>
        <button className="btn mt-4" onClick={onClose} data-autofocus>{tt.common.close}</button>
      </Dialog>
    );
  }
  if (!detail) {
    return (
      <Dialog label={t.task} onClose={onClose}>
        <p className="eyebrow py-8 text-center">{tt.common.loading}</p>
      </Dialog>
    );
  }

  const stage: Stage = detail.stage;
  const groupName = groups.find((g) => g.id === detail.groupId)?.name;
  const quick = quickDue(today);

  return (
    <Dialog label={detail.title || t.task} onClose={requestClose} wide>
      <div className="tg-sheet-top">
        <button type="button" className="tg-stage-pill" data-stage={stage} aria-haspopup="menu" disabled={readOnly || inHistory}
          aria-label={inHistory ? `${t.stage}: ${t.history}` : `${t.stage}: ${t.stages[stage]}. ${t.moveTo}`}
          onClick={(e) => onMove(live ?? detail, e.currentTarget)}>
          <span className="tg-stage-dot" aria-hidden="true" />
          <StageName stage={stage as BoardStage | "backlog"} />
          {inHistory && <span className="tg-pill-sub">· {t.history}</span>}
          {!readOnly && !inHistory && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          )}
        </button>
        {inHistory && !readOnly && (
          <button type="button" className="btn tg-small tg-reopen-btn" aria-haspopup="menu"
            onClick={(e) => onReopen(live ?? detail, e.currentTarget)}>{t.reopen}</button>
        )}
        <span className="tg-saved" role="status">{saved ? t.saved : ""}</span>
        <button type="button" className="btn btn-quiet tg-sheet-close" onClick={requestClose}>{tt.common.close}</button>
      </div>

      {detail.deletedAt && (
        <div className="tg-sheet-note" role="status">
          <span>{t.deletedNotice(detail.deletedBy?.name ?? null)}</span>
          {!archived && <button type="button" className="btn tg-small" onClick={restore}>{t.restore}</button>}
        </div>
      )}
      {archived && !detail.deletedAt && <p className="tg-sheet-note" role="status">{t.readOnly}</p>}

      {conflict && (
        <div ref={conflictRef} tabIndex={-1} className="tg-conflict" role="alert">
          <p className="tg-conflict-title">{t.conflict(conflict.theirs.updatedBy?.name ?? null)}</p>
          {(Object.keys(conflict.fields) as Field[]).map((f) => (
            <div key={f} className="tg-conflict-theirs">
              <span className="eyebrow">{t.theirVersion} · {f === "title" ? t.titleLabel : t.description}</span>
              <p>{conflict.theirs[f] || "—"}</p>
            </div>
          ))}
          <div className="flex gap-2 flex-wrap mt-3">
            <button type="button" className="btn btn-primary tg-small" onClick={keepMine}>{t.keepMine}</button>
            <button type="button" className="btn tg-small" onClick={useTheirs}>{t.useTheirs}</button>
          </div>
        </div>
      )}

      <AutoGrow className="tg-title-input" value={title} maxLength={200} aria-label={t.titleLabel} readOnly={readOnly}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
        onBlur={() => { if (!conflict) flushText(); }} />
      <AutoGrow className="tg-desc-input" value={description} maxLength={10000} aria-label={t.description}
        placeholder={readOnly ? "" : t.descriptionPlaceholder} readOnly={readOnly}
        onChange={(e) => setDescription(e.target.value)} onBlur={() => { if (!conflict) flushText(); }} />

      {error && <p className="tg-sheet-error" role="alert">{error}</p>}

      <dl className="tg-fields">
        <div className="tg-field">
          <dt className="tg-field-label" id="tg-f-people">{t.assignees}</dt>
          <dd className="tg-field-value">
            <div className="tg-people-pick" role="group" aria-labelledby="tg-f-people">
              {members.map((m) => {
                const on = detail.assignees.includes(m.id);
                return (
                  <button key={m.id} type="button" className="chip tg-person-chip" data-on={on} aria-pressed={on} disabled={readOnly}
                    onClick={() => {
                      const next = on ? detail.assignees.filter((id) => id !== m.id) : [...detail.assignees, m.id];
                      saveField({ assignees: next }, { assignees: next });
                    }}>
                    <Avatar name={m.name} size={20} />
                    <span>{m.name}{m.id === viewerId && <span className="tg-chip-you"> ({t.you})</span>}</span>
                  </button>
                );
              })}
            </div>
          </dd>
        </div>

        <div className="tg-field">
          <dt className="tg-field-label" id="tg-f-group">{t.group}</dt>
          <dd className="tg-field-value">
            {picking ? (
              <GroupPicker groups={groups} current={detail.groupId}
                onPick={(id) => { setPicking(false); if (id !== detail.groupId) saveField({ groupId: id }, { groupId: id }); }}
                onCreate={(name) => { setPicking(false); createGroup(name); }}
                onCancel={() => setPicking(false)} />
            ) : (
              <button type="button" className="tg-select" aria-labelledby="tg-f-group tg-f-group-v" disabled={readOnly}
                onClick={() => setPicking(true)}>
                <span id="tg-f-group-v" className={groupName ? undefined : "faint"}>{groupName ?? t.noGroup}</span>
                {!readOnly && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                )}
              </button>
            )}
          </dd>
        </div>

        <div className="tg-field">
          <dt className="tg-field-label" id="tg-f-effort">{t.effort}</dt>
          <dd className="tg-field-value">
            <div className="tg-choices" role="group" aria-labelledby="tg-f-effort">
              {EFFORT_CHOICES.map((n) => (
                <button key={n} type="button" className="tg-choice num" aria-pressed={detail.effort === n} data-on={detail.effort === n}
                  disabled={readOnly} onClick={() => saveField({ effort: detail.effort === n ? null : n }, { effort: detail.effort === n ? null : n })}>
                  {n}
                </button>
              ))}
              {detail.effort !== null && !readOnly && (
                <button type="button" className="tg-clear" onClick={() => saveField({ effort: null }, { effort: null })}>{t.clear}</button>
              )}
            </div>
          </dd>
        </div>

        <div className="tg-field">
          <dt className="tg-field-label"><label htmlFor="tg-f-due">{t.dueDate}</label></dt>
          <dd className="tg-field-value">
            <div className="tg-due-row">
              <input id="tg-f-due" type="date" className="input tg-date" value={detail.dueOn ?? ""} disabled={readOnly}
                min="2000-01-01" max="2100-12-31"
                onChange={(e) => {
                  const v = e.target.value || null;
                  if (v === detail.dueOn) return;
                  if (v === null || /^\d{4}-\d{2}-\d{2}$/.test(v)) saveField({ dueOn: v }, { dueOn: v });
                }} />
              {!readOnly && (
                <span className="tg-choices">
                  {([["today", tt.together.work.due.today], ["tomorrow", tt.together.work.due.tomorrow], ["nextWeek", t.nextWeek]] as const).map(([k, label]) => (
                    <button key={k} type="button" className="tg-choice tg-choice-text" data-on={detail.dueOn === quick[k]}
                      aria-pressed={detail.dueOn === quick[k]} onClick={() => saveField({ dueOn: quick[k] }, { dueOn: quick[k] })}>
                      {label}
                    </button>
                  ))}
                  {detail.dueOn && (
                    <button type="button" className="tg-clear" onClick={() => saveField({ dueOn: null }, { dueOn: null })}>{t.clear}</button>
                  )}
                </span>
              )}
            </div>
          </dd>
        </div>
      </dl>

      <div className="tg-sheet-foot">
        <p className="tg-sheet-meta">
          <span>{t.addedBy(detail.createdBy?.name ?? null, detail.createdAt, detail.createdBy?.id === viewerId)}</span>
          {detail.updatedAt !== detail.createdAt && <span> · {t.editedAt(detail.updatedAt)}</span>}
        </p>
        {!readOnly && !confirming && (
          <button type="button" className="btn btn-quiet tg-delete" onClick={() => setConfirming(true)}>{t.delete}</button>
        )}
      </div>
      {confirming && (
        <div className="tg-confirm" role="group" aria-label={t.delete}>
          <p className="tg-confirm-q">{t.confirmDelete(spaceName)}</p>
          <p className="tg-confirm-note">{t.confirmDeleteNote}</p>
          <div className="flex gap-2 flex-wrap mt-3 justify-end">
            <button type="button" className="btn tg-small" data-autofocus onClick={() => setConfirming(false)}>{tt.common.cancel}</button>
            <button type="button" className="btn tg-small tg-danger" onClick={() => onDelete(live ?? detail)}>{t.delete}</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Pick a group, or type a new one and create it — one field, no separate errand. */
function GroupPicker({ groups, current, onPick, onCreate, onCancel }: {
  groups: GroupView[]; current: string | null;
  onPick: (id: string | null) => void; onCreate: (name: string) => void; onCancel: () => void;
}) {
  const t = useT().together.work;
  const [q, setQ] = useState("");
  const name = q.replace(/\s+/g, " ").trim();
  const shown = groups.filter((g) => g.name.toLowerCase().includes(name.toLowerCase()));
  const exact = groups.some((g) => g.name.toLowerCase() === name.toLowerCase());
  return (
    <div className="tg-picker" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}>
      <input className="input tg-picker-input" autoFocus value={q} maxLength={40} aria-label={t.findOrCreateGroup}
        placeholder={t.findOrCreateGroup} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (name && !exact) onCreate(name);
          else if (shown.length) onPick(shown.find((g) => g.name.toLowerCase() === name.toLowerCase())?.id ?? shown[0].id);
        }} />
      <ul className="tg-picker-list">
        {!name && (
          <li><button type="button" className="tg-picker-item" aria-pressed={current === null} onClick={() => onPick(null)}>
            <span className="tg-menu-check" aria-hidden="true">{current === null ? "✓" : ""}</span>{t.noGroup}
          </button></li>
        )}
        {shown.map((g) => (
          <li key={g.id}><button type="button" className="tg-picker-item" aria-pressed={current === g.id} onClick={() => onPick(g.id)}>
            <span className="tg-menu-check" aria-hidden="true">{current === g.id ? "✓" : ""}</span>{g.name}
          </button></li>
        ))}
        {name && !exact && (
          <li><button type="button" className="tg-picker-item tg-picker-create" onClick={() => onCreate(name)}>
            <span className="tg-menu-check" aria-hidden="true">+</span>{t.createGroup(name)}
          </button></li>
        )}
      </ul>
    </div>
  );
}
