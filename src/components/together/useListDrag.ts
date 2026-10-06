"use client";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type { TaskSummary } from "@/lib/together/work";
import type { Stage } from "@/lib/together/stages";
import type { CardDrag } from "@/components/together/TaskCard";

/**
 * Desktop drag-and-drop for a space's lists — the Backlog and the four board
 * stages. History is never a drop target, and nothing here decides an order: a
 * drop becomes an intent ("before this task", "after that one") that the server
 * turns into a rank.
 *
 * Built on the browser's own drag-and-drop, as Priority Compass is: no library,
 * and the browser's movement threshold is what separates a click (open the
 * task) from a drag. Only offered with a fine pointer that can hover (a mouse or
 * trackpad) — on touch, Move to… is the way, and nothing competes with scrolling.
 *
 * While dragging, the card stays in place as a calm placeholder, each list that
 * can take it is tinted, and a thin line shows exactly where it would land. No
 * element is inserted into a list, so nothing jumps.
 */

export type DropIntent = { before: string } | { after: string } | { place: "top" };

/** A mouse or trackpad: a pointer that is precise and can hover. */
export function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setFine(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  return fine;
}

const TYPE = "application/x-together-task";

/** Where in a list a pointer at `y` would drop: before the first card whose middle is below it. */
function indexAt(list: HTMLElement, y: number, dragged: string): number {
  const cards = [...list.querySelectorAll<HTMLElement>("[data-task-id]")].filter((c) => c.dataset.taskId !== dragged);
  const i = cards.findIndex((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
  return i < 0 ? cards.length : i;
}

export function useListDrag({ enabled, onDrop }: {
  enabled: boolean;
  onDrop: (taskId: string, stage: Stage, intent: DropIntent) => void;
}) {
  const [drag, setDrag] = useState<{ id: string; from: Stage } | null>(null);
  const [over, setOver] = useState<{ stage: Stage; index: number } | null>(null);
  // Which card is being dragged, known from the very first dragover. The visual
  // state (`drag`) follows a frame later, after the browser has taken its picture
  // of the card — but a quick drag must not lose its first moments.
  const current = useRef<{ id: string; from: Stage } | null>(null);
  const token = useRef(0);
  const drop = useRef(onDrop);
  drop.current = onDrop;

  const end = useCallback(() => { token.current++; current.current = null; setDrag(null); setOver(null); }, []);

  const card = (task: TaskSummary, stage: Stage, items: TaskSummary[]): CardDrag => {
    const others = items.filter((t) => t.id !== drag?.id);
    const k = drag && over && over.stage === stage ? over.index : -1;
    return {
      enabled,
      dragging: drag?.id === task.id,
      dropBefore: k >= 0 && others[k]?.id === task.id,
      dropAfter: k >= 0 && k === others.length && others[others.length - 1]?.id === task.id,
      onStart: (e: DragEvent<HTMLElement>) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(TYPE, task.id);
        // After the browser has taken its picture of the card, so the picture is the card, not the placeholder.
        const mine = ++token.current;
        current.current = { id: task.id, from: task.stage };
        requestAnimationFrame(() => { if (token.current === mine) setDrag({ id: task.id, from: task.stage }); });
      },
      onEnd: end,
    };
  };

  /*
   * A list accepts both dragenter and dragover. Accepting dragenter is what makes
   * it the browser's current drop target (the HTML drag-and-drop model; Firefox
   * holds to it strictly) — without it, dragover can keep going to whatever
   * accepted last.
   */
  const accept = (stage: Stage) => (e: DragEvent<HTMLElement>) => {
    const d = current.current;
    if (!d || !e.dataTransfer.types.includes(TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const index = indexAt(e.currentTarget, e.clientY, d.id);
    setOver((o) => (o && o.stage === stage && o.index === index ? o : { stage, index }));
  };

  const list = (stage: Stage, items: TaskSummary[]) => ({
    "data-drop-target": drag ? (over?.stage === stage ? "over" : "ready") : undefined,
    "data-drop-empty": drag && over?.stage === stage && !items.some((t) => t.id !== drag.id) ? "" : undefined,
    onDragEnter: accept(stage),
    onDragOver: accept(stage),
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o?.stage === stage ? null : o));
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      const d = current.current;
      if (!d) return;
      e.preventDefault();
      const index = indexAt(e.currentTarget, e.clientY, d.id);
      const others = items.filter((t) => t.id !== d.id);
      const intent: DropIntent = index < others.length ? { before: others[index].id }
        : others.length ? { after: others[others.length - 1].id } : { place: "top" };
      end();
      drop.current(d.id, stage, intent);
    },
  });

  return { dragging: drag, card, list, end };
}
