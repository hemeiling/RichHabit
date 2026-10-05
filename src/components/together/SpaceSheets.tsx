"use client";
import { useEffect, useState } from "react";
import type { DeletedTask, GroupView, TaskSummary } from "@/lib/together/work";
import { useT } from "@/lib/i18n/context";
import { call } from "@/components/together/shared";
import { Dialog } from "@/components/together/overlay";

/**
 * The space's two small housekeeping sheets, from ⋯: Groups and Recently
 * deleted. Both are read-only in an archived space.
 */

export function GroupsSheet({ boardId, groups, readOnly, onClose, onChanged }: {
  boardId: string; groups: GroupView[]; readOnly: boolean; onClose: () => void; onChanged: () => void;
}) {
  const tt = useT();
  const t = tt.together.work;
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<GroupView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/together/boards/${boardId}/groups`;
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); onChanged(); return true; } catch (e) { setError((e as Error).message); return false; }
  };

  return (
    <Dialog label={t.groups} onClose={onClose}>
      <div className="tg-sheet-top">
        <h2 className="display" style={{ fontSize: 24 }}>{t.groups}</h2>
        <button type="button" className="btn btn-quiet tg-sheet-close" onClick={onClose}>{tt.common.close}</button>
      </div>
      <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>{t.groupsIntro}</p>
      {error && <p className="tg-sheet-error" role="alert">{error}</p>}
      {groups.length === 0 ? (
        <p className="faint mt-4" style={{ fontSize: 13.5 }}>{t.noGroups}</p>
      ) : (
        <ul className="tg-members mt-3">
          {groups.map((g) => (
            <li key={g.id} className="tg-member">
              {editing?.id === g.id ? (
                <form className="flex gap-2 flex-wrap items-center" style={{ flex: "1 1 100%" }} onSubmit={(e) => {
                  e.preventDefault();
                  run(() => call(`${base}/${g.id}`, { method: "PATCH", body: JSON.stringify({ name: editing.name }) }))
                    .then((ok) => { if (ok) setEditing(null); });
                }}>
                  <input className="input" autoFocus maxLength={40} value={editing.name} aria-label={t.groupName}
                    style={{ flex: "1 1 180px" }}
                    onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditing(null); } }}
                    onChange={(e) => setEditing({ id: g.id, name: e.target.value })} />
                  <button className="btn btn-primary tg-small" type="submit">{tt.common.save}</button>
                  <button className="btn tg-small" type="button" onClick={() => setEditing(null)}>{tt.common.cancel}</button>
                </form>
              ) : deleting?.id === g.id ? (
                <div style={{ flex: "1 1 100%" }}>
                  <p style={{ fontSize: 14 }}>{t.confirmDeleteGroup(g.name)}</p>
                  <div className="flex gap-2 justify-end mt-2">
                    <button className="btn tg-small" type="button" data-autofocus onClick={() => setDeleting(null)}>{tt.common.cancel}</button>
                    <button className="btn tg-small tg-danger" type="button" onClick={() =>
                      run(() => call(`${base}/${g.id}`, { method: "DELETE" })).then(() => setDeleting(null))}>
                      {t.deleteGroup}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="tg-member-name">{g.name}</span>
                  {!readOnly && (
                    <>
                      <button className="btn btn-quiet tg-small" type="button" onClick={() => setEditing({ id: g.id, name: g.name })}>
                        {tt.together.rename}
                      </button>
                      <button className="btn btn-quiet tg-small" type="button" onClick={() => setDeleting(g)}>{t.delete}</button>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form className="flex gap-2 flex-wrap mt-4" onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run(() => call(base, { method: "POST", body: JSON.stringify({ name }) })).then((ok) => { if (ok) setName(""); });
        }}>
          <input className="input" maxLength={40} value={name} placeholder={t.groupName} aria-label={t.newGroup}
            style={{ flex: "1 1 200px" }} onChange={(e) => setName(e.target.value)} />
          <button className="btn" type="submit" disabled={!name.trim()}>{t.newGroup}</button>
        </form>
      )}
    </Dialog>
  );
}

export function DeletedSheet({ boardId, readOnly, onClose, onRestored }: {
  boardId: string; readOnly: boolean; onClose: () => void; onRestored: (task: TaskSummary) => void;
}) {
  const tt = useT();
  const t = tt.together.work;
  const [items, setItems] = useState<DeletedTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<DeletedTask[]>(`/api/together/boards/${boardId}/tasks/deleted`).then(setItems).catch((e) => setError((e as Error).message));
  }, [boardId]);

  return (
    <Dialog label={t.recentlyDeleted} onClose={onClose}>
      <div className="tg-sheet-top">
        <h2 className="display" style={{ fontSize: 24 }}>{t.recentlyDeleted}</h2>
        <button type="button" className="btn btn-quiet tg-sheet-close" onClick={onClose}>{tt.common.close}</button>
      </div>
      {error && <p className="tg-sheet-error" role="alert">{error}</p>}
      {!items ? (
        !error && <p className="eyebrow py-6 text-center">{tt.common.loading}</p>
      ) : items.length === 0 ? (
        <p className="faint" style={{ fontSize: 13.5 }}>{t.nothingDeleted}</p>
      ) : (
        <ul className="tg-members">
          {items.map((d) => (
            <li key={d.id} className="tg-member">
              <span className="tg-member-name">
                <span style={{ display: "block", overflowWrap: "anywhere" }}>{d.title}</span>
                <span className="faint" style={{ fontSize: 12.5 }}>{t.stages[d.stage]} · {t.deletedBy(d.deletedBy?.name ?? null, d.deletedAt)}</span>
              </span>
              {!readOnly && (
                <button className="btn tg-small" type="button" onClick={async () => {
                  setError(null);
                  try {
                    const { task } = await call<{ task: TaskSummary }>(`/api/together/boards/${boardId}/tasks/${d.id}/restore`, { method: "POST" });
                    setItems((list) => (list ?? []).filter((x) => x.id !== d.id));
                    onRestored(task);
                  } catch (e) { setError((e as Error).message); }
                }}>{t.restore}</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
