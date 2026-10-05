"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { GroupView, TaskSummary, WorkView } from "@/lib/together/work";
import { BOARD_STAGES, type BoardStage, type Stage } from "@/lib/together/stages";
import { todayISO } from "@/lib/dates";
import { useT } from "@/lib/i18n/context";
import { call, type Person } from "@/components/together/shared";
import { Menu, Toast, type MenuItem, type ToastState } from "@/components/together/overlay";
import SpaceHeader, { spaceStyle } from "@/components/together/SpaceHeader";
import WorkBoard from "@/components/together/WorkBoard";
import Backlog from "@/components/together/Backlog";
import TaskSheet from "@/components/together/TaskSheet";
import { DeletedSheet, GroupsSheet } from "@/components/together/SpaceSheets";

/**
 * A space's work: the Board and the Backlog, one component, two views.
 *
 * The server is the truth. Every change is sent, applied here from the reply,
 * and then the whole space is re-read — after your own changes, when you come
 * back to the tab, and on Refresh. There is no live connection and no polling:
 * a small space does not need one, and a re-read on return is what makes a
 * partner's changes appear.
 *
 * Each space's last reading is kept for this page's lifetime, so switching
 * between Board and Backlog shows the space at once and refreshes underneath.
 */

const cache = new Map<string, WorkView>();
/** The last reading of a space, if this page has one — Members uses it to say who holds what. */
export const cachedWork = (boardId: string): WorkView | undefined => cache.get(boardId);
let toastSeq = 0;

type MenuState = { task: TaskSummary; anchor: HTMLElement; title: string } | null;

export default function SpaceWork({ boardId, viewerId, view }: { boardId: string; viewerId: string; view: "board" | "backlog" }) {
  const tt = useT();
  const t = tt.together.work;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [work, setWork] = useState<WorkView | null>(() => cache.get(boardId) ?? null);
  const [gone, setGone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [older, setOlder] = useState<{ tasks: TaskSummary[]; more: boolean } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [more, setMore] = useState<HTMLElement | null>(null);
  const [panel, setPanel] = useState<null | "groups" | "deleted">(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [announce, setAnnounce] = useState("");
  const [today, setToday] = useState(todayISO);

  const stageParam = params.get("stage");
  const stage: BoardStage = (BOARD_STAGES as readonly string[]).includes(stageParam ?? "") ? (stageParam as BoardStage) : "todo";
  const setStage = useCallback((s: BoardStage) => {
    router.replace(`${pathname}${s === "todo" ? "" : `?stage=${s}`}`, { scroll: false });
  }, [router, pathname]);

  // Several re-reads can be in flight (after each change, on focus); only the
  // latest one asked for may land, or an older reply would undo a newer move.
  const reads = useRef(0);
  const load = useCallback(async () => {
    const mine = ++reads.current;
    try {
      const w = await call<WorkView>(`/api/together/boards/${boardId}/work`);
      if (mine !== reads.current) return;
      cache.set(boardId, w);
      setWork(w);
      setGone(null);
    } catch (e) {
      if (mine !== reads.current) return;
      const err = e as Error & { status?: number };
      // Removed, or the space went away while this tab was open: say so plainly.
      if (err.status === 404) { cache.delete(boardId); setGone(err.message); } else setError(err.message);
    }
  }, [boardId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      setToday(todayISO());
      load();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => { document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); };
  }, [load]);

  const say = useCallback((message: string, actions?: ToastState["actions"]) => {
    setToast({ id: ++toastSeq, message, actions });
  }, []);
  const clearToast = useCallback(() => setToast(null), []);

  /** Puts a task the server returned into place — or takes it out — without waiting for the re-read. */
  const put = useCallback((task: TaskSummary | null, removeId?: string) => {
    setWork((w) => {
      if (!w) return w;
      const rest = w.tasks.filter((x) => x.id !== (task?.id ?? removeId));
      // The server's order — moved_at desc, id desc — so editing never reorders and a move lands on top.
      const tasks = (task ? [task, ...rest] : rest).sort((a, b) =>
        a.movedAt === b.movedAt ? (a.id < b.id ? 1 : -1) : a.movedAt < b.movedAt ? 1 : -1);
      const next = { ...w, tasks };
      cache.set(boardId, next);
      return next;
    });
    setOlder((o) => (o ? { ...o, tasks: o.tasks.filter((x) => x.id !== (task?.id ?? removeId)) } : o));
  }, [boardId]);

  const fail = useCallback((e: unknown) => {
    const err = e as Error & { status?: number };
    setError(err.message);
    if (err.status === 404) load();
  }, [load]);

  const create = useCallback(async (title: string, s: Stage) => {
    setError(null);
    try {
      const { task } = await call<{ task: TaskSummary }>(`/api/together/boards/${boardId}/tasks`, {
        method: "POST", body: JSON.stringify({ title, stage: s }) });
      put(task);
      setAnnounce(`${t.added}: ${task.title}`);
      load();
      return true;
    } catch (e) { fail(e); return false; }
  }, [boardId, put, load, fail, t]);

  const move = useCallback(async (task: TaskSummary, to: Stage, undoable = true) => {
    if (task.stage === to) return;
    setError(null);
    try {
      const { task: moved } = await call<{ task: TaskSummary }>(`/api/together/boards/${boardId}/tasks/${task.id}`, {
        method: "PATCH", body: JSON.stringify({ stage: to }) });
      put(moved);
      if (undoable) {
        const actions: ToastState["actions"] = [{ label: t.undo, onClick: () => { move(moved, task.stage, false); } }];
        if (to !== "backlog" && (view === "backlog" || to !== stage)) {
          actions.push({ label: t.show, onClick: () => {
            const q = to === "todo" ? "" : `?stage=${to}`;
            router.push(`/together/b/${boardId}${q}`, { scroll: false });
          } });
        }
        say(t.movedTo(to), actions);
      }
      load();
    } catch (e) { fail(e); }
  }, [boardId, put, load, fail, say, t, view, stage, router]);

  const remove = useCallback(async (task: TaskSummary) => {
    setError(null);
    try {
      await call(`/api/together/boards/${boardId}/tasks/${task.id}`, { method: "DELETE" });
      setOpenId(null);
      put(null, task.id);
      say(t.deletedToast, [{ label: t.undo, onClick: async () => {
        try {
          const { task: back } = await call<{ task: TaskSummary }>(`/api/together/boards/${boardId}/tasks/${task.id}/restore`, { method: "POST" });
          put(back);
          load();
        } catch (e) { fail(e); }
      } }]);
      load();
    } catch (e) { fail(e); }
  }, [boardId, put, load, fail, say, t]);

  const showOlder = useCallback(async () => {
    if (!work) return;
    const shown = older?.tasks ?? [];
    const recent = work.tasks.filter((x) => x.stage === "done");
    const last = shown[shown.length - 1] ?? recent[recent.length - 1];
    try {
      const page = await call<{ tasks: TaskSummary[]; more: boolean }>(
        `/api/together/boards/${boardId}/tasks?cursor=${encodeURIComponent(last ? `${last.movedAt}|${last.id}` : "")}`);
      const seen = new Set([...recent, ...shown].map((x) => x.id));
      setOlder({ tasks: [...shown, ...page.tasks.filter((x) => !seen.has(x.id))], more: page.more });
    } catch (e) { fail(e); }
  }, [work, older, boardId, fail]);

  const members = useMemo(() => new Map<string, Person>((work?.members ?? []).map((m) => [m.id, m])), [work]);
  const groups = useMemo(() => new Map<string, string>((work?.groups ?? []).map((g) => [g.id, g.name])), [work]);

  const openMove = useCallback((task: TaskSummary, anchor: HTMLElement) => {
    setMenu({ task, anchor, title: task.stage === "backlog" ? t.commitTo : t.moveTo });
  }, [t]);

  if (gone) {
    return (
      <div className="card p-5" role="alert">
        <p style={{ fontSize: 14 }}>{gone}</p>
        <button className="btn mt-3" onClick={() => router.push("/together")}>← {tt.together.title}</button>
      </div>
    );
  }
  if (!work) {
    return error
      ? (
        <div className="card p-5" role="alert">
          <p style={{ fontSize: 14 }}>{error}</p>
          <button className="btn mt-3" onClick={() => { setError(null); load(); }}>{tt.together.retry}</button>
        </div>
      )
      : <div className="eyebrow py-10 text-center">{tt.common.loading}</div>;
  }

  const readOnly = work.space.archived;
  const backlog = work.tasks.filter((x) => x.stage === "backlog");
  const findTask = (id: string) => work.tasks.find((x) => x.id === id) ?? older?.tasks.find((x) => x.id === id);

  const menuItems = (task: TaskSummary): MenuItem[] => {
    const board: MenuItem[] = BOARD_STAGES.map((s) => ({
      key: s, label: t.stages[s], current: task.stage === s, onSelect: () => move(task, s),
    }));
    if (task.stage === "backlog") {
      return [...board, { key: "backlog", label: t.stages.backlog, current: true, divided: true, onSelect: () => {} }];
    }
    return [...board, { key: "backlog", label: t.backToBacklog, divided: true, onSelect: () => move(task, "backlog") }];
  };

  const moreItems: MenuItem[] = [
    { key: "groups", label: t.groups, onSelect: () => setPanel("groups") },
    { key: "deleted", label: t.recentlyDeleted, onSelect: () => setPanel("deleted") },
    { key: "refresh", label: t.refresh, divided: true, onSelect: () => { setToday(todayISO()); load(); } },
  ];

  return (
    <div className="tg-space" style={spaceStyle(work.space.id)}>
      <SpaceHeader id={work.space.id} name={work.space.name} members={work.members} view={view}
        backlogCount={backlog.length} onMore={setMore} />

      {readOnly && <p className="tg-archived mt-4" role="status">{t.readOnly}</p>}
      {error && (
        <div className="tg-inline-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-quiet tg-small" onClick={() => setError(null)}>{tt.common.dismiss}</button>
        </div>
      )}

      {view === "board" ? (
        <WorkBoard tasks={work.tasks} older={older} doneOlder={work.doneOlder} today={today}
          members={members} groups={groups} readOnly={readOnly} stage={stage} onStage={setStage}
          onAdd={(s, title) => create(title, s)} onOpen={(task) => setOpenId(task.id)} onMove={openMove}
          onShowOlder={showOlder} />
      ) : (
        <Backlog tasks={backlog} today={today} members={members} groups={groups} readOnly={readOnly}
          onCapture={(title) => create(title, "backlog")} onOpen={(task) => setOpenId(task.id)}
          onCommit={(task) => move(task, "todo")} onCommitTo={openMove} />
      )}

      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {openId && (
        <TaskSheet key={openId} boardId={boardId} taskId={openId} live={findTask(openId)} spaceName={work.space.name}
          members={work.members} groups={work.groups} viewerId={viewerId} today={today} archived={readOnly}
          onClose={() => setOpenId(null)} onChanged={(task) => put(task)} onMove={openMove} onDelete={remove}
          onRestored={(task) => { put(task); load(); }}
          onGroupCreated={(g: GroupView) => setWork((w) => (w && !w.groups.some((x) => x.id === g.id)
            ? { ...w, groups: [...w.groups, g].sort((a, b) => a.name.localeCompare(b.name)) } : w))} />
      )}

      {menu && (
        <Menu anchor={menu.anchor} title={`${menu.title} ${menu.task.title}`} currentLabel={t.currentStage}
          items={menuItems(menu.task)} onClose={() => setMenu(null)} />
      )}
      {more && <Menu anchor={more} title={t.more} currentLabel="" items={moreItems} onClose={() => setMore(null)} />}

      {panel === "groups" && (
        <GroupsSheet boardId={boardId} groups={work.groups} readOnly={readOnly} onClose={() => setPanel(null)} onChanged={load} />
      )}
      {panel === "deleted" && (
        <DeletedSheet boardId={boardId} readOnly={readOnly} onClose={() => setPanel(null)}
          onRestored={(task) => { put(task); say(t.restoredToast); load(); }} />
      )}

      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}
