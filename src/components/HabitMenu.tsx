"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui";
import { useT } from "@/lib/i18n/context";
import { CATEGORIES } from "@/lib/habits";
import { habitName } from "@/lib/templates";
import type { Category, Habit } from "@/lib/types";

/**
 * Everything you can do to a habit from Today (§14).
 *
 * It is a menu rather than controls on the row because the normal state of the
 * page is a checkbox and a name. Anything that is not ticking something off is
 * one tap away, not permanently in the way.
 *
 * The distinction this screen exists to protect is remove vs delete:
 *
 *   Remove  → status becomes `retired`. The row stays, every completion stays,
 *             Insights and the coach can still see what happened, and it can be
 *             put back. This is what people mean by "take it off my list".
 *   Delete  → the row and its history are erased. Offered only when there is no
 *             history to erase, which is the case it is actually for: a habit
 *             added by mistake a minute ago. Once a habit has been completed
 *             even once, the destructive option is replaced by an explanation.
 */
export default function HabitMenu({
  habit, daysRecorded, canMoveUp, canMoveDown,
  onLog, onEdit, onMove, onReorder, onStatus, onReplace, onDelete, onClose,
}: {
  habit: Habit;
  /** Distinct days with a completion. Decides whether erasing is on offer. */
  daysRecorded: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onLog: () => void;
  onEdit: () => void;
  onMove: (c: Category) => void;
  onReorder: (delta: -1 | 1) => void;
  onStatus: (status: Habit["status"]) => void;
  onReplace: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [confirm, setConfirm] = useState<"remove" | "delete" | null>(null);
  const name = habitName(habit, t);
  const erasable = daysRecorded === 0;

  const Item = ({ label, hint, onClick, danger }: {
    label: string; hint?: string; onClick: () => void; danger?: boolean;
  }) => (
    <button className="w-full text-left py-3" onClick={onClick}
      style={{ background: "none", border: "none", cursor: "pointer" }}>
      <span className="block" style={{ fontSize: 15, color: danger ? "#B3453B" : undefined }}>
        {label}
      </span>
      {hint && <span className="faint block mt-0.5" style={{ fontSize: 12.5 }}>{hint}</span>}
    </button>
  );

  if (confirm === "remove") {
    return (
      <Sheet
        open onClose={() => setConfirm(null)} title={t.customise.removeTitle}
        footer={
          <>
            <button className="btn" onClick={() => setConfirm(null)}>{t.common.cancel}</button>
            <button className="btn btn-primary"
              onClick={() => { onStatus("retired"); onClose(); }}>
              {t.customise.removeConfirm}
            </button>
          </>
        }
      >
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>
          {t.customise.removeBody(name)}
        </p>
      </Sheet>
    );
  }

  if (confirm === "delete") {
    return (
      <Sheet
        open onClose={() => setConfirm(null)} title={t.customise.deleteTitle}
        footer={
          <>
            <button className="btn" onClick={() => setConfirm(null)}>{t.common.cancel}</button>
            <button className="btn btn-danger" onClick={() => { onDelete(); onClose(); }}>
              {t.customise.deleteConfirm}
            </button>
          </>
        }
      >
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>
          {t.customise.deleteBody(name)}
        </p>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title={t.customise.menuTitle}>
      <p className="muted mb-1" style={{ fontSize: 14 }}>{name}</p>
      <div className="divide">
        <Item label={t.customise.logEntry} onClick={onLog} />
        <Item label={t.customise.edit} onClick={onEdit} />

        <div className="py-3">
          <div className="eyebrow mb-2">{t.customise.moveTo}</div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button key={c.id} className="chip" data-on={habit.category === c.id}
                disabled={habit.category === c.id}
                onClick={() => { onMove(c.id); onClose(); }}>
                {t.categories[c.id].label}
              </button>
            ))}
          </div>
          {/* The accessible half of reordering. Dragging is the shortcut, not
              the only way — these are keyboard-reachable and work on a phone. */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            <button className="chip" disabled={!canMoveUp} onClick={() => onReorder(-1)}>
              ↑ {t.customise.moveUp}
            </button>
            <button className="chip" disabled={!canMoveDown} onClick={() => onReorder(1)}>
              ↓ {t.customise.moveDown}
            </button>
          </div>
        </div>

        <Item
          label={habit.status === "paused" ? t.customise.resume : t.customise.pause}
          hint={t.customise.pauseHint}
          onClick={() => { onStatus(habit.status === "paused" ? "active" : "paused"); onClose(); }}
        />
        <Item label={t.customise.replace} hint={t.customise.replaceHint} onClick={onReplace} />
        <Item label={t.customise.remove} hint={t.customise.removeHint}
          onClick={() => setConfirm("remove")} />

        {erasable ? (
          <Item label={t.customise.deleteForever} hint={t.customise.deleteHint} danger
            onClick={() => setConfirm("delete")} />
        ) : (
          <p className="faint py-3" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            {t.customise.deleteUnavailable(daysRecorded)}
          </p>
        )}
      </div>
    </Sheet>
  );
}
