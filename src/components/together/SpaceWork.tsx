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
import History from "@/components/together/History";
import TaskSheet from "@/components/together/TaskSheet";
import { DeletedSheet, GroupsSheet } from "@/components/together/SpaceSheets";
import { useFinePointer, useListDrag, type DropIntent } from "@/components/together/useListDrag";

/**
 * A space's work, on one surface: the Board ("what we're doing"), the Backlog
 * below it ("what we might do"), and History at the bottom ("what we've done").
 *
 * The server is the truth. A change is shown at once, sent, corrected (or put
 * back) from the reply, and then the space is re-read — after your own changes,
 * when you come back to the tab, on Refresh, and once at the moment the next
 * Done card turns 24 hours old. No live connection and no polling.
 *
 * Order: each list in `rank`, the server's order. Moves state intent — a stage
 * and a neighbour, or top/up/down/bottom — and the server decides the rank.
 */

const cache = new Map<string, WorkView>();
/** The last reading of a space, if this page has one — Members uses it to say who holds what. */
export const cachedWork = (boardId: string): WorkView | undefined => cache.get(boardId);
let toastSeq = 0;
const DAY = 24 * 60 * 60 * 1000;

/** The server's order within a list: rank (unranked first), then newest move, then id. */
export function compareInList(a: TaskSummary, b: TaskSummary): number {
  const ra = a.rank === null ? null : BigInt(a.rank);
  const rb = b.rank === null ? null : BigInt(b.rank);
  if (ra === null && rb !== null) return -1;
  if (rb === null && ra !== null) return 1;
  if (ra !== null && rb !== null && ra !== rb) return ra < rb ? -1 : 1;
  if (a.movedAt !== b.movedAt) return a.movedAt < b.movedAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}
/** A microsecond timestamp as milliseconds (Date keeps only those). */
const ms = (iso: string) => Date.parse(iso.replace(/(\.\d{3})\d*Z$/, "$1Z"));
const nowMicro = () => new Date().toISOString().replace("Z", "000Z");

type MenuState = { task: TaskSummary; anchor: HTMLElement; kind: "move" | "reopen" } | null;
type HistoryState = { tasks: TaskSummary[]; more: boolean; total: number };

export default function SpaceWork({ boardId, viewerId }: { boardId: string; viewerId: string }) {
  const tt = useT();
  const t = tt.together.work;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [work, setWork] = useState<WorkView | null>(() => cache.get(boardId) ?? null);
  const [history, setHistory] = useState<HistoryState | null>(() => cache.get(boardId)?.history ?? null);
  const [gone, setGone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [more, setMore] = useState<HTMLElement | null>(null);
  const [panel, setPanel] = useState<null | "groups" | "deleted">(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [announce, setAnnounce] = useState("");
  const [today, setToday] = useState(todayISO);
  /** How far the browser's clock is from the database's: Done's 24 hours are the server's. */
  const offset = useRef(0);
  const serverNow = () => Date.now() - offset.current;

  const stageParam = params.get("stage");
  const stage: BoardStage = (BOARD_STAGES as readonly string[]).includes(stageParam ?? "") ? (stageParam as BoardStage) : "todo";
  const setStage = useCallback((s: BoardStage) => {
    router.replace(`${pathname}${s === "todo" ? "" : `?stage=${s}`}`, { scroll: false });
  }, [router, pathname]);

  // Several re-reads can be in flight; only the latest one asked for may land.
  const reads = useRef(0);
  /** How many History rows are open, so a re-read brings the same number back. */
  const shownHistory = useRef(0);
  const load = useCallback(async () => {
    const mine = ++reads.current;
    try {
      const w = await call<WorkView>(`/api/together/boards/${boardId}/work`);
      if (mine !== reads.current) return;
      offset.current = Date.now() - ms(w.serverNow);
      cache.set(boardId, w);
      setWork(w);
      // History: the fresh first page — and, if older pages were open, those again
      // from the server (not kept from before: another member may have deleted
      // or reopened something in them).
      const shown = shownHistory.current;
      let tasks = w.history.tasks, more = w.history.more;
      while (more && tasks.length < shown && mine === reads.current) {
        const last = tasks[tasks.length - 1];
        const page = await call<{ tasks: TaskSummary[]; more: boolean }>(
          `/api/together/boards/${boardId}/tasks/history?cursor=${encodeURIComponent(`${last.movedAt}|${last.id}`)}`);
        tasks = [...tasks, ...page.tasks];
        more = page.more;
      }
      if (mine !== reads.current) return;
      setHistory({ tasks, more, total: w.history.total });
      setGone(null);
    } catch (e) {
      if (mine !== reads.current) return;
      const err = e as Error & { status?: number };
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

  // One scheduled re-read, for the moment the next Done card turns 24 hours old.
  useEffect(() => {
    if (!work) return;
    const due = work.tasks.filter((x) => x.stage === "done").map((x) => ms(x.movedAt) + DAY);
    if (!due.length) return;
    const wait = Math.min(...due) - (Date.now() - offset.current) + 1500;
    const timer = window.setTimeout(() => { if (document.visibilityState === "visible") load(); }, Math.min(Math.max(wait, 1000), 2 ** 31 - 1));
    return () => window.clearTimeout(timer);
  }, [work, load]);

  const say = useCallback((message: string, actions?: ToastState["actions"]) => {
    setToast({ id: ++toastSeq, message, actions });
  }, []);
  const clearToast = useCallback(() => setToast(null), []);

  /** Puts a task into place — or takes it out — without waiting for the re-read. */
  const put = useCallback((task: TaskSummary | null, removeId?: string) => {
    const id = task?.id ?? removeId;
    setWork((w) => {
      if (!w) return w;
      const rest = w.tasks.filter((x) => x.id !== id);
      const next = { ...w, tasks: task ? [...rest, task] : rest };
      cache.set(boardId, next);
      return next;
    });
    setHistory((h) => (h && h.tasks.some((x) => x.id === id)
      ? { ...h, tasks: h.tasks.filter((x) => x.id !== id), total: Math.max(0, h.total - 1) } : h));
  }, [boardId]);

  const fail = useCallback((e: unknown) => {
    setError((e as Error).message);
    load();   // whatever went wrong, show the server's truth
  }, [load]);

  /** The Board's and the Backlog's lists, in order. Done holds only its 24 hours. */
  const lists = useMemo(() => {
    const by = new Map<Stage, TaskSummary[]>();
    for (const s of ["backlog", ...BOARD_STAGES] as Stage[]) by.set(s, []);
    for (const x of work?.tasks ?? []) {
      if (x.stage === "done" && ms(x.movedAt) + DAY <= Date.now() - offset.current) continue;
      by.get(x.stage)?.push(x);
    }
    for (const list of by.values()) list.sort(compareInList);
    return by;
  }, [work]);

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

  /** A rank for showing a move before the server answers — display only; the reply replaces it. */
  const optimisticRank = (list: TaskSummary[], intent: DropIntent | { place: "bottom" }): string => {
    const ranks = list.map((x) => (x.rank === null ? 0n : BigInt(x.rank)));
    if ("place" in intent) return (intent.place === "bottom" ? (ranks.at(-1) ?? 0n) + 1n : (ranks[0] ?? 0n) - 1n).toString();
    const i = list.findIndex((x) => x.id === ("before" in intent ? intent.before : intent.after));
    if (i < 0) return ((ranks[0] ?? 0n) - 1n).toString();
    return ("before" in intent ? ranks[i] - 1n : ranks[i] + 1n).toString();
  };

  const move = useCallback(async (task: TaskSummary, to: Stage,
    intent: DropIntent | { place: "top" | "bottom" | "up" | "down" }, via: "drag" | "menu", undo = false) => {
    setError(null);
    const fromList = lists.get(task.stage) ?? [];
    const i = fromList.findIndex((x) => x.id === task.id);
    const back: DropIntent = i < 0 ? { place: "top" } : fromList[i + 1] ? { before: fromList[i + 1].id }
      : fromList[i - 1] ? { after: fromList[i - 1].id } : { place: "top" };
    const fromHistory = !undo && i < 0 && task.stage === "done";
    if (!("place" in intent) || intent.place === "top" || intent.place === "bottom") {
      const target = (lists.get(to) ?? []).filter((x) => x.id !== task.id);
      put({ ...task, stage: to, movedAt: to === task.stage ? task.movedAt : nowMicro(),
        rank: optimisticRank(target, intent as DropIntent | { place: "bottom" }) });
    }
    try {
      const { task: moved, unchanged } = await call<{ task: TaskSummary; unchanged: boolean }>(
        `/api/together/boards/${boardId}/tasks/${task.id}/move`, { method: "POST", body: JSON.stringify({ stage: to, ...intent, via }) });
      if (unchanged) { put(task); return; }
      put(moved);
      const after = [...(lists.get(to) ?? []).filter((x) => x.id !== task.id), moved].sort(compareInList);
      setAnnounce(t.movedAnnounce(to, after.findIndex((x) => x.id === moved.id) + 1, after.length));
      if (fromHistory) say(t.reopened(to));
      else if (to !== task.stage && !undo) {
        const actions: ToastState["actions"] = [{ label: t.undo, onClick: () => { move(moved, task.stage, back, via, true); } }];
        if (to !== "backlog" && to !== stage) actions.push({ label: t.show, onClick: () => setStage(to as BoardStage) });
        say(t.movedTo(to), actions);
      }
      load();
    } catch (e) {
      put(task);
      fail(e);
    }
  }, [boardId, lists, put, load, fail, say, t, stage, setStage]);

  const remove = useCallback(async (task: TaskSummary) => {
    setError(null);
    try {
      await call(`/api/together/boards/${boardId}/tasks/${task.id}`, { method: "DELETE" });
      setOpenId(null);
      put(null, task.id);
      say(t.deletedToast, [{ label: t.undo, onClick: async () => {
        try {
          const { task: restored } = await call<{ task: TaskSummary }>(`/api/together/boards/${boardId}/tasks/${task.id}/restore`, { method: "POST" });
          put(restored);
          load();
        } catch (e) { fail(e); }
      } }]);
      load();
    } catch (e) { fail(e); }
  }, [boardId, put, load, fail, say, t]);

  useEffect(() => { shownHistory.current = history?.tasks.length ?? 0; }, [history]);

  const showOlderHistory = useCallback(async () => {
    const last = history?.tasks.at(-1);
    if (!last) return;
    try {
      const page = await call<{ tasks: TaskSummary[]; more: boolean }>(
        `/api/together/boards/${boardId}/tasks/history?cursor=${encodeURIComponent(`${last.movedAt}|${last.id}`)}`);
      setHistory((h) => {
        const seen = new Set((h?.tasks ?? []).map((x) => x.id));
        return { tasks: [...(h?.tasks ?? []), ...page.tasks.filter((x) => !seen.has(x.id))], more: page.more, total: h?.total ?? 0 };
      });
    } catch (e) { fail(e); }
  }, [history, boardId, fail]);

  const members = useMemo(() => new Map<string, Person>((work?.members ?? []).map((m) => [m.id, m])), [work]);
  const groups = useMemo(() => new Map<string, string>((work?.groups ?? []).map((g) => [g.id, g.name])), [work]);

  const fine = useFinePointer();
  const readOnly = !!work?.space.archived;
  const dnd = useListDrag({
    enabled: fine && !readOnly,
    onDrop: (taskId, to, intent) => {
      const task = work?.tasks.find((x) => x.id === taskId);
      if (task) move(task, to, intent, "drag");
    },
  });

  const openMove = useCallback((task: TaskSummary, anchor: HTMLElement) => setMenu({ task, anchor, kind: "move" }), []);
  const openReopen = useCallback((task: TaskSummary, anchor: HTMLElement) => setMenu({ task, anchor, kind: "reopen" }), []);

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

  const inHistory = (task: TaskSummary) => task.stage === "done" && ms(task.movedAt) + DAY <= serverNow();
  const findTask = (id: string) => work.tasks.find((x) => x.id === id) ?? history?.tasks.find((x) => x.id === id);

  const menuItems = (task: TaskSummary, kind: "move" | "reopen"): MenuItem[] => {
    if (kind === "reopen") {
      return (["todo", "doing", "waiting"] as const).map((s) => ({
        key: s, label: t.stages[s], onSelect: () => move(task, s, { place: "top" }, "menu"),
      }));
    }
    const board: MenuItem[] = BOARD_STAGES.map((s) => ({
      key: s, label: t.stages[s], current: task.stage === s, onSelect: () => move(task, s, { place: "top" }, "menu"),
    }));
    const backlog: MenuItem = task.stage === "backlog"
      ? { key: "backlog", label: t.stages.backlog, current: true, divided: true, onSelect: () => {} }
      : { key: "backlog", label: t.backToBacklog, divided: true, onSelect: () => move(task, "backlog", { place: "top" }, "menu") };
    const list = lists.get(task.stage) ?? [];
    const i = list.findIndex((x) => x.id === task.id);
    const first = i <= 0, last = i < 0 || i === list.length - 1;
    const position: MenuItem[] = [
      { key: "top", label: t.toTop, divided: true, disabled: first, onSelect: () => move(task, task.stage, { place: "top" }, "menu") },
      { key: "up", label: t.up, disabled: first, onSelect: () => move(task, task.stage, { place: "up" }, "menu") },
      { key: "down", label: t.down, disabled: last, onSelect: () => move(task, task.stage, { place: "down" }, "menu") },
      { key: "bottom", label: t.toBottom, disabled: last, onSelect: () => move(task, task.stage, { place: "bottom" }, "menu") },
    ];
    return [...board, backlog, ...(list.length > 1 ? position : [])];
  };

  const moreItems: MenuItem[] = [
    // Also reachable by the avatars; named here so nobody has to guess that.
    { key: "members", label: tt.together.members, onSelect: () => router.push(`/together/b/${boardId}/members`) },
    { key: "groups", label: t.groups, divided: true, onSelect: () => setPanel("groups") },
    { key: "deleted", label: t.recentlyDeleted, onSelect: () => setPanel("deleted") },
    { key: "refresh", label: t.refresh, divided: true, onSelect: () => { setToday(todayISO()); load(); } },
  ];
  const open = openId ? findTask(openId) : undefined;

  return (
    <div className="tg-space" style={spaceStyle(work.space.id)}>
      <SpaceHeader id={work.space.id} name={work.space.name} members={work.members} view="work"
        canInvite={work.space.canInvite} onMore={setMore} />

      {readOnly && <p className="tg-archived mt-4" role="status">{t.readOnly}</p>}
      {error && (
        <div className="tg-inline-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-quiet tg-small" onClick={() => setError(null)}>{tt.common.dismiss}</button>
        </div>
      )}
      {dnd.dragging === null && fine && !readOnly && <p className="sr-only">{t.dragHint}</p>}

      <section className="tg-section" aria-labelledby="tg-h-board">
        <h2 className="tg-section-title" id="tg-h-board">{t.board}</h2>
        <WorkBoard lists={lists} today={today} members={members} groups={groups} readOnly={readOnly}
          stage={stage} onStage={setStage} onAdd={(s, title) => create(title, s)}
          onOpen={(task) => setOpenId(task.id)} onMove={openMove} dnd={dnd} />
      </section>

      <section className="tg-section tg-section-quiet" id="backlog" aria-labelledby="tg-h-backlog">
        <h2 className="tg-section-title" id="tg-h-backlog">{t.backlog}</h2>
        <Backlog tasks={lists.get("backlog") ?? []} today={today} members={members} groups={groups} readOnly={readOnly}
          onCapture={(title) => create(title, "backlog")} onOpen={(task) => setOpenId(task.id)}
          onCommit={(task) => move(task, "todo", { place: "top" }, "menu")} onCommitTo={openMove} dnd={dnd} />
      </section>

      <section className="tg-section tg-section-quiet" id="history" aria-labelledby="tg-h-history">
        <History heading="tg-h-history" history={history} today={today} members={members} groups={groups} readOnly={readOnly}
          onOpen={(task) => setOpenId(task.id)} onReopen={openReopen} onShowOlder={showOlderHistory} />
      </section>

      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {openId && (
        <TaskSheet key={openId} boardId={boardId} taskId={openId} live={open} spaceName={work.space.name}
          members={work.members} groups={work.groups} viewerId={viewerId} today={today} archived={readOnly}
          inHistory={!!open && inHistory(open)}
          onClose={() => setOpenId(null)} onChanged={(task) => put(task)} onMove={openMove} onReopen={openReopen} onDelete={remove}
          onRestored={(task) => { put(task); load(); }}
          onGroupCreated={(g: GroupView) => setWork((w) => (w && !w.groups.some((x) => x.id === g.id)
            ? { ...w, groups: [...w.groups, g].sort((a, b) => a.name.localeCompare(b.name)) } : w))} />
      )}

      {menu && (
        <Menu anchor={menu.anchor}
          title={menu.kind === "reopen" ? t.reopenTask(menu.task.title) : `${menu.task.stage === "backlog" ? t.commitTo : t.moveTo} ${menu.task.title}`}
          currentLabel={t.currentStage} items={menuItems(menu.task, menu.kind)} onClose={() => setMenu(null)} />
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
