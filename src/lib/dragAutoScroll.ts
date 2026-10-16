"use client";

/**
 * Auto-scroll while a native HTML5 drag is held near the edge of a scrollable
 * area, so a card can travel through a list taller than the screen.
 *
 * The browser's own drag-and-drop never scrolls nested containers (and the
 * window only unreliably), yet it keeps firing `dragover` with pointer
 * coordinates the whole time. This module listens to those coordinates on the
 * window (capture phase, so a card's stopPropagation cannot starve it) and
 * runs one requestAnimationFrame loop: each frame it finds the innermost
 * scrollable container under the pointer, and if the pointer sits inside an
 * edge band of it, scrolls it — gently at the band's rim, faster toward the
 * very edge (a squared ramp). If that container cannot scroll further in the
 * wanted direction the next scrollable ancestor takes over, ending at the
 * page itself; one container per frame, so nothing ever jumps.
 *
 * The drag image stays attached to the pointer by nature — the browser
 * anchors it there — and drop indicators keep up because the browser re-fires
 * `dragover` on its own clock even under a motionless pointer.
 *
 * An element marked `data-drag-autoscroll="skip"` is never scrolled (the
 * sidebar: dragging a card across it must not wiggle the navigation), but its
 * ancestors — the page — still are, so crossing the sidebar never traps a
 * drag. There is no touch path to consider: every drag surface in the app is
 * native HTML5 drag-and-drop, which touch does not start (Move to… serves
 * there), and keyboard moving never comes through here. Reduced motion keeps
 * the feature (it is function, not decoration) at half the ceiling speed.
 *
 * Callers: `startDragAutoScroll()` in dragstart, `stopDragAutoScroll()` in
 * the drag's end funnel. A window-level dragend/drop listener stops the loop
 * as well, so a surface unmounting mid-drag cannot leave it running.
 */

/** The band, in px from a scrollable edge, where auto-scroll engages. */
const EDGE = 56;
/** Fastest step in px per frame (~1400 px/s), reached at the very edge. */
const MAX_STEP = 24;
const REDUCED_STEP = 12;

let raf = 0;
let x = -1;
let y = -1;
let seen = false;
let maxStep = MAX_STEP;

function onDragOver(e: globalThis.DragEvent) {
  x = e.clientX;
  y = e.clientY;
  seen = true;
}

function onDragFinished() {
  stopDragAutoScroll();
}

/** auto/scroll/overlay — the values that make an element its own scroller. */
const scrolls = (v: string) => v === "auto" || v === "scroll" || v === "overlay";

/** 0 outside the band; rises to 1 at the edge itself. */
const pull = (distanceIntoBand: number) => Math.min(1, Math.max(0, distanceIntoBand / EDGE));
const step = (t: number) => (t <= 0 ? 0 : Math.max(1, Math.round(maxStep * t * t)));

/**
 * Try to scroll one container toward the pointer's edge. Returns true if it
 * moved, false if the pointer is outside its bands or it is already at rest
 * against the wanted edge (then an ancestor may take over).
 */
function scrollOne(el: Element, rect: { top: number; bottom: number; left: number; right: number }): boolean {
  let moved = false;

  const upT = pull(rect.top + EDGE - y);
  const downT = pull(y - (rect.bottom - EDGE));
  if (upT > 0 && el.scrollTop > 0) {
    el.scrollTop -= step(upT);
    moved = true;
  } else if (downT > 0 && el.scrollTop < el.scrollHeight - el.clientHeight) {
    el.scrollTop += step(downT);
    moved = true;
  }

  const leftT = pull(rect.left + EDGE - x);
  const rightT = pull(x - (rect.right - EDGE));
  if (leftT > 0 && el.scrollLeft > 0) {
    el.scrollLeft -= step(leftT);
    moved = true;
  } else if (rightT > 0 && el.scrollLeft < el.scrollWidth - el.clientWidth) {
    el.scrollLeft += step(rightT);
    moved = true;
  }

  return moved;
}

function frame() {
  raf = requestAnimationFrame(frame);
  if (!seen) return;
  const under = document.elementFromPoint(x, y);
  if (!under) return;

  for (let el: Element | null = under; el; el = el.parentElement) {
    if (el.getAttribute("data-drag-autoscroll") === "skip") continue;
    if (el === document.scrollingElement || el === document.documentElement) break;
    const style = getComputedStyle(el);
    const canY = scrolls(style.overflowY) && el.scrollHeight > el.clientHeight;
    const canX = scrolls(style.overflowX) && el.scrollWidth > el.clientWidth;
    if (!canY && !canX) continue;
    // The band is measured on the part of the container actually on screen.
    const r = el.getBoundingClientRect();
    const rect = {
      top: Math.max(r.top, 0),
      bottom: Math.min(r.bottom, window.innerHeight),
      left: Math.max(r.left, 0),
      right: Math.min(r.right, window.innerWidth),
    };
    if (scrollOne(el, rect)) return;
  }

  // The page itself: bands at the viewport's own edges.
  const page = document.scrollingElement;
  if (page) scrollOne(page, { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth });
}

export function startDragAutoScroll(): void {
  if (raf) return;
  seen = false;
  maxStep = typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? REDUCED_STEP : MAX_STEP;
  window.addEventListener("dragover", onDragOver, true);
  window.addEventListener("dragend", onDragFinished, true);
  window.addEventListener("drop", onDragFinished, true);
  raf = requestAnimationFrame(frame);
}

export function stopDragAutoScroll(): void {
  if (!raf) return;
  cancelAnimationFrame(raf);
  raf = 0;
  window.removeEventListener("dragover", onDragOver, true);
  window.removeEventListener("dragend", onDragFinished, true);
  window.removeEventListener("drop", onDragFinished, true);
}
