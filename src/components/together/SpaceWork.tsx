"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { GroupView, HistoryPage, TaskSummary, WorkView } from "@/lib/together/work";
import { BOARD_STAGES, type BoardStage, type Stage } from "@/lib/together/stages";
import { filterParam, matchesGroup, type GroupFilter as GroupChoice } from "@/lib/together/progress";
import { todayISO } from "@/lib/dates";
import { deviceTimeZone } from "@/lib/zonedTime";
import { useT } from "@/lib/i18n/context";
import { TrashIcon, afterSpaceGone, call, type Person } from "@/components/together/shared";
import { Menu, Toast, type MenuItem, type ToastState } from "@/components/together/overlay";
import SpaceHeader, { spaceStyle } from "@/components/together/SpaceHeader";
import WorkBoard from "@/components/together/WorkBoard";
import Backlog from "@/components/together/Backlog";
import History, { type HistoryRows } from "@/components/together/History";
import { GroupFilter, sumPoints } from "@/components/together/Filters";
import TaskSheet from "@/components/together/TaskSheet";
import { DeleteSpaceDialog, DeletedSheet, GroupsSheet } from "@/components/together/SpaceSheets";
import AddMembers from "@/components/together/AddMembers";
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
 *
 * The group filter (`?group=`, kept in the address like `?stage=`, and carried
 * to Progress) narrows the Board, the Backlog and History alike. Groups are
 * labels, not walls: every member sees every group. A filter naming a group
 * that has since been deleted is dropped, and the person is told.
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

export default function SpaceWork({ boardId, viewerId }: { boardId: string; viewerId: string }) {
  const tt = useT();
  const t = tt.together.work;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [work, setWork] = useState<WorkView | null>(() => cache.get(boardId) ?? null);
  /** History's rows — read only while it is open. */
  const [history, setHistory] = useState<HistoryRows | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [gone, setGone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [more, setMore] = useState<HTMLElement | null>(null);
  const [panel, setPanel] = useState<null | "groups" | "deleted" | "add" | "delete">(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [announce, setAnnounce] = useState("");
  const [today, setToday] = useState(todayISO);
  /** How far the browser's clock is from the database's: Done's 24 hours are the server's. */
  const offset = useRef(0);
  const serverNow = () => Date.now() - offset.current;

  /** Changes some of the address's filters, keeping the rest. */
  const setParams = useCallback((changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k); else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, pathname, params]);

  const stageParam = params.get("stage");
  const stage: BoardStage = (BOARD_STAGES as readonly string[]).includes(stageParam ?? "") ? (stageParam as BoardStage) : "todo";
  const setStage = useCallback((s: BoardStage) => setParams({ stage: s === "todo" ? null : s }), [setParams]);

  // The group filter: one of the space's groups, "none" (ungrouped), or all. Judged only against this
  // visit's own reading of the space — a cached one may predate a group made since (on Progress, say).
  const [fresh, setFresh] = useState(false);
  const groupParam = filterParam(params.get("group"));
  const groupKnown = groupParam === "all" || groupParam === "none" || !work || !fresh || work.groups.some((g) => g.id === groupParam);
  const group: GroupChoice = groupKnown ? groupParam : "all";

  // History: collapsed unless this person opened it in this space before (this device remembers).
  const historyKey = `rh:tg-history:${viewerId}:${boardId}`;
  useEffect(() => {
    try { setHistoryOpen(localStorage.getItem(historyKey) === "open"); } catch { /* no storage: collapsed */ }
  }, [historyKey]);
  const tz = useMemo(() => deviceTimeZone() ?? "UTC", []);
  /** What History is showing, for reads that start later than the render that asked for them. */
  const historyView = useRef({ open: false, group: "all" as GroupChoice, search: "" });
  historyView.current = { open: historyOpen, group, search: historySearch.trim() };
  const historyUrl = useCallback((cursor?: string) => {
    const v = historyView.current;
    const q = new URLSearchParams({ tz });
    if (cursor) q.set("cursor", cursor);
    if (v.group !== "all") q.set("group", v.group);
    if (v.search) q.set("q", v.search);
    return `/api/together/boards/${boardId}/tasks/history?${q}`;
  }, [boardId, tz]);

  // Several re-reads can be in flight; only the latest one asked for may land.
  const reads = useRef(0);
  const historyReads = useRef(0);
  /** How many History rows are open, so a re-read brings the same number back. */
  const shownHistory = useRef(0);
  /** Whether History's rows have been asked for since it was opened — until then, opening it reads them. */
  const historyLoaded = useRef(false);
  /** The space's re-read, for History to call when its group turns out to be gone. */
  const reload = useRef<() => void>(() => {});
  /**
   * History for the filters in use, from the top — and, if older pages were
   * open, those again from the server (not kept from before: another member may
   * have deleted or reopened something in them).
   */
  const fillHistory = useCallback(async (shown: number) => {
    const mine = ++historyReads.current;
    const first = await call<HistoryPage>(historyUrl());
    let tasks = first.tasks, more = first.more;
    while (more && tasks.length < shown && mine === historyReads.current) {
      const last = tasks[tasks.length - 1];
      const page = await call<HistoryPage>(historyUrl(`${last.movedAt}|${last.id}`));
      tasks = [...tasks, ...page.tasks];
      more = page.more;
    }
    if (mine !== historyReads.current || !historyView.current.open) return;
    setHistory({ tasks, more, total: first.total ?? tasks.length, points: first.points ?? 0, months: first.months ?? [] });
    historyLoaded.current = true;
    // The server widened a group that no longer exists: re-read the space, which drops the filter and says so.
    if (first.dropped) reload.current();
  }, [historyUrl]);

  const load = useCallback(async () => {
    const mine = ++reads.current;
    try {
      const w = await call<WorkView>(`/api/together/boards/${boardId}/work`);
      if (mine !== reads.current) return;
      offset.current = Date.now() - ms(w.serverNow);
      cache.set(boardId, w);
      setWork(w);
      setFresh(true);
      setGone(null);
      if (historyView.current.open && historyLoaded.current) await fillHistory(shownHistory.current);
    } catch (e) {
      if (mine !== reads.current) return;
      const err = e as Error & { status?: number };
      if (err.status === 404) { cache.delete(boardId); setGone(err.message); } else setError(err.message);
    }
  }, [boardId, fillHistory]);
  useEffect(() => { reload.current = () => { void load(); }; }, [load]);

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

  // A filter naming a group that no longer exists (deleted, perhaps by someone else) is dropped, and said so.
  useEffect(() => {
    if (groupKnown) return;
    setParams({ group: null });
    say(tt.together.progress.groupGone);
  }, [groupKnown, setParams, say, tt]);

  // History's rows: read when it opens and whenever its filters change (typing waits a moment). Another
  // group's rows are not left on screen under this one's name meanwhile. A failed read is retried by the
  // space's next re-read (on returning to the tab, Refresh, or any change).
  const historyGroup = useRef(group);
  useEffect(() => {
    if (!historyOpen) { setHistory(null); historyLoaded.current = false; return; }
    if (historyGroup.current !== group) { historyGroup.current = group; setHistory(null); }
    const timer = window.setTimeout(() => {
      fillHistory(0).catch((e: unknown) => { historyLoaded.current = true; setError((e as Error).message); });
    }, historySearch.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [historyOpen, group, historySearch, fillHistory]);

  const toggleHistory = useCallback((open: boolean) => {
    setHistoryOpen(open);
    if (!open) setHistorySearch("");
    try {
      if (open) localStorage.setItem(historyKey, "open"); else localStorage.removeItem(historyKey);
    } catch { /* no storage: remembered for this visit only */ }
  }, [historyKey]);

  /** The Board's and the Backlog's lists, in order, for the group filter. Done holds only its 24 hours. */
  const lists = useMemo(() => {
    const by = new Map<Stage, TaskSummary[]>();
    for (const s of ["backlog", ...BOARD_STAGES] as Stage[]) by.set(s, []);
    for (const x of work?.tasks ?? []) {
      if (x.stage === "done" && ms(x.movedAt) + DAY <= Date.now() - offset.current) continue;
      if (!matchesGroup(x, group)) continue;
      by.get(x.stage)?.push(x);
    }
    for (const list of by.values()) list.sort(compareInList);
    return by;
  }, [work, group]);

  /** What History holds for the filters in use — known while collapsed, from the space's own read. */
  const historyHeld = useMemo(() => {
    if (historySearch.trim() && history) return { total: history.total, points: history.points };
    const all = work?.history;
    if (!all) return { total: 0, points: 0 };
    if (group === "all") return { total: all.total, points: all.points };
    const g = all.groups.find((x) => (group === "none" ? x.groupId === null : x.groupId === group));
    return { total: g?.tasks ?? 0, points: g?.points ?? 0 };
  }, [work, history, group, historySearch]);

  const create = useCallback(async (title: string, s: Stage) => {
    setError(null);
    try {
      // Filtered to a group, a new task joins it — so it stays in view where it was added.
      const into = group !== "all" && group !== "none" ? { groupId: group } : {};
      const { task } = await call<{ task: TaskSummary }>(`/api/together/boards/${boardId}/tasks`, {
        method: "POST", body: JSON.stringify({ title, stage: s, ...into }) });
      put(task);
      setAnnounce(`${t.added}: ${task.title}`);
      load();
      return true;
    } catch (e) { fail(e); return false; }
  }, [boardId, group, put, load, fail, t]);

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
    const mine = historyReads.current;
    try {
      const page = await call<HistoryPage>(historyUrl(`${last.movedAt}|${last.id}`));
      if (mine !== historyReads.current) return;   // the filters changed meanwhile: this page belongs to another list
      setHistory((h) => {
        if (!h) return h;
        const seen = new Set(h.tasks.map((x) => x.id));
        return { ...h, tasks: [...h.tasks, ...page.tasks.filter((x) => !seen.has(x.id))], more: page.more };
      });
    } catch (e) { fail(e); }
  }, [history, historyUrl, fail]);

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
    // Up and down are places in the whole list; with a group filter on, its neighbours may be out of sight.
    return [...board, backlog, ...(list.length > 1 && group === "all" ? position : [])];
  };

  /** A member leaves (the server refuses the owner), then lands on Overview, which says so. */
  const leaveSpace = async () => {
    if (!window.confirm(tt.together.confirmLeave)) return;
    try {
      const r = await call<{ together?: boolean }>(`/api/together/boards/${boardId}/leave`, { method: "POST" });
      afterSpaceGone(router, r.together, tt.together.left(work.space.name));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const moreItems: MenuItem[] = [
    // Also reachable by the avatars; named here so nobody has to guess that.
    { key: "members", label: tt.together.members, onSelect: () => router.push(`/together/b/${boardId}/members`) },
    { key: "groups", label: t.groups, divided: true, onSelect: () => setPanel("groups") },
    { key: "deleted", label: t.recentlyDeleted, onSelect: () => setPanel("deleted") },
    { key: "refresh", label: t.refresh, divided: true, onSelect: () => { setToday(todayISO()); load(); } },
    // Last and apart: the owner deletes the space; everyone else may leave it.
    work.space.role === "owner"
      ? { key: "delete", label: tt.together.deleteSpace, icon: <TrashIcon />, danger: true, divided: true,
        onSelect: () => setPanel("delete") }
      : { key: "leave", label: tt.together.leave, divided: true, onSelect: () => { void leaveSpace(); } },
  ];
  const open = openId ? findTask(openId) : undefined;
  const backlogTasks = lists.get("backlog") ?? [];

  return (
    <div className="tg-space" style={spaceStyle(work.space.id)}>
      <SpaceHeader id={work.space.id} name={work.space.name} members={work.members} view="work" group={group} onMore={setMore}
        onAddMembers={readOnly ? undefined : () => setPanel("add")} />

      {readOnly && <p className="tg-archived mt-4" role="status">{t.readOnly}</p>}
      {error && (
        <div className="tg-inline-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-quiet tg-small" onClick={() => setError(null)}>{tt.common.dismiss}</button>
        </div>
      )}
      {dnd.dragging === null && fine && !readOnly && <p className="sr-only">{t.dragHint}</p>}

      {/* One group filter for the Board, the Backlog and History — shown once the space has groups. */}
      {(work.groups.length > 0 || group !== "all") && (
        <div className="tg-filterbar">
          <GroupFilter groups={work.groups} value={group} onChange={(g) => setParams({ group: g === "all" ? null : g })} />
        </div>
      )}

      <section className="tg-section" aria-labelledby="tg-h-board">
        <h2 className="tg-section-title" id="tg-h-board">{t.board}</h2>
        <WorkBoard lists={lists} today={today} members={members} groups={groups} readOnly={readOnly}
          stage={stage} onStage={setStage} onAdd={(s, title) => create(title, s)}
          onOpen={(task) => setOpenId(task.id)} onMove={openMove} dnd={dnd} />
      </section>

      {/* Below the board: the Backlog, and History beside it on a wide screen — both quieter than the board. */}
      <div className="tg-lower-wrap"><div className="tg-lower">
      <section className="tg-section tg-section-quiet tg-lower-backlog" id="backlog" aria-labelledby="tg-h-backlog">
        <div className="tg-section-row">
          <h2 className="tg-section-title" id="tg-h-backlog">{t.backlog}</h2>
          {backlogTasks.length > 0 && (
            <span className="tg-history-count">{t.backlogCount(backlogTasks.length, sumPoints(backlogTasks).points)}</span>
          )}
        </div>
        <Backlog tasks={backlogTasks} today={today} members={members} groups={groups} readOnly={readOnly}
          onCapture={(title) => create(title, "backlog")} onOpen={(task) => setOpenId(task.id)}
          onCommit={(task) => move(task, "todo", { place: "top" }, "menu")} onCommitTo={openMove} dnd={dnd} />
      </section>

      <section className="tg-section tg-section-quiet tg-lower-history" id="history" aria-labelledby="tg-h-history">
        <History heading="tg-h-history" open={historyOpen} onToggle={toggleHistory} summary={historyHeld} rows={history}
          search={historySearch} onSearch={setHistorySearch} filtered={group !== "all"}
          members={members} groups={groups} readOnly={readOnly}
          onOpen={(task) => setOpenId(task.id)} onReopen={openReopen} onShowOlder={showOlderHistory} />
      </section>
      </div></div>

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

      {panel === "add" && (
        <AddMembers boardId={boardId} canInvite={work.space.canInvite} onClose={() => setPanel(null)} />
      )}
      {panel === "groups" && (
        <GroupsSheet boardId={boardId} groups={work.groups} readOnly={readOnly} onClose={() => setPanel(null)} onChanged={load} />
      )}
      {panel === "deleted" && (
        <DeletedSheet boardId={boardId} readOnly={readOnly} onClose={() => setPanel(null)}
          onRestored={(task) => { put(task); say(t.restoredToast); load(); }} />
      )}
      {panel === "delete" && (
        <DeleteSpaceDialog boardId={boardId} name={work.space.name} archived={readOnly} onClose={() => setPanel(null)} />
      )}

      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}
