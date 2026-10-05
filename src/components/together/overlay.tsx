"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * Together's overlays: a dialog (the task sheet and the space's small sheets), a
 * menu (Move to…) and a toast (with Undo).
 *
 * Each takes focus when it opens, keeps Tab inside itself, closes on Escape and
 * gives focus back to whatever opened it — so a keyboard never gets lost behind
 * a scrim. They are portalled to <body>; the theme is also set on <html>, so
 * dark mode reaches them.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Open overlays, innermost last. Only the innermost answers Escape and the
 * arrow keys, so a menu opened from the task sheet closes alone. An inline panel
 * inside a sheet (the group picker, a rename field) takes Escape for itself by
 * calling preventDefault — not stopPropagation, which cannot stop a listener on
 * the same node as React's own (both are on the document).
 */
const stack: number[] = [];
let nextLayer = 1;
function useLayer(active: boolean) {
  const id = useRef(0);
  if (!id.current) id.current = nextLayer++;
  useEffect(() => {
    if (!active) return;
    const me = id.current;
    stack.push(me);
    return () => { const i = stack.lastIndexOf(me); if (i >= 0) stack.splice(i, 1); };
  }, [active]);
  // Stable, so effects that use it run once per opening — not on every render.
  return useCallback(() => stack[stack.length - 1] === id.current, []);
}

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** Focus in on open (`[data-autofocus]` first), Tab kept inside, Escape out, focus back on close. */
function useFocusTrap(ref: RefObject<HTMLElement>, onClose: () => void, active: boolean) {
  const isTop = useLayer(active);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!active) return;
    const before = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (!isTop() || e.defaultPrevented) return;
      if (e.key === "Escape") { close.current(); return; }
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const [head, tail] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [active, ref, isTop]);
}

/** A sheet: from the bottom on a phone, centred above that. */
export function Dialog({ label, onClose, children, footer, wide }: {
  label: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const mounted = useMounted();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose, mounted);
  if (!mounted) return null;
  return createPortal((
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={label}>
      <div className="scrim" onClick={onClose} />
      <div ref={ref} tabIndex={-1} className={`sheet tg-dialog fade-in${wide ? " tg-dialog-wide" : ""}`}>
        {children}
        {footer && <div className="sheet-actions tg-dialog-foot">{footer}</div>}
      </div>
    </div>
  ), document.body);
}

export interface MenuItem {
  key: string;
  label: string;
  /** The current choice: shown checked and not selectable. */
  current?: boolean;
  /** Starts a new section with a hairline above. */
  divided?: boolean;
  onSelect: () => void;
}

/**
 * A short list of choices. Beside its button on a wide screen; a sheet from the
 * bottom on a phone, with targets a thumb can hit. Arrow keys move between
 * items; Enter chooses; Escape or Tab closes.
 */
export function Menu({ anchor, title, items, onClose, currentLabel }: {
  anchor: HTMLElement | null; title: string; items: MenuItem[]; onClose: () => void; currentLabel: string;
}) {
  const mounted = useMounted();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const isTop = useLayer(mounted);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    if (!mounted || !ref.current) return;
    const narrow = window.matchMedia("(max-width: 639px)").matches;
    setSheet(narrow);
    if (narrow || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    const below = a.bottom + 6 + m.height <= window.innerHeight - 8;
    setPos({
      top: below ? a.bottom + 6 : Math.max(8, a.top - 6 - m.height),
      left: Math.min(Math.max(8, a.right - m.width), window.innerWidth - m.width - 8),
    });
  }, [mounted, anchor]);

  // A menu closes on Tab rather than trapping it: it is a choice, not a form.
  useEffect(() => {
    if (!mounted) return;
    const before = document.activeElement as HTMLElement | null;
    const list = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]:not([disabled])") ?? [])];
    // Next frame: by then the menu has been placed beside its button.
    const frame = requestAnimationFrame(() => list()[0]?.focus({ preventScroll: true }));
    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return;
      const all = list();
      const at = all.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); close.current(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); all[(at + 1) % all.length]?.focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); all[(at - 1 + all.length) % all.length]?.focus(); }
      if (e.key === "Home") { e.preventDefault(); all[0]?.focus(); }
      if (e.key === "End") { e.preventDefault(); all[all.length - 1]?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [mounted, isTop]);

  if (!mounted) return null;
  return createPortal((
    <div className="tg-menu-wrap" data-sheet={sheet || undefined}>
      <div className="tg-menu-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="menu" aria-label={title} className="tg-menu fade-in"
        style={sheet ? undefined : pos ? { top: pos.top, left: pos.left } : { opacity: 0, top: 0, left: 0 }}>
        <p className="tg-menu-title" aria-hidden="true">{title}</p>
        {items.map((item) => (
          <div key={item.key}>
            {item.divided && <div className="tg-menu-sep" role="separator" />}
            <button type="button" role="menuitemradio" aria-checked={!!item.current} disabled={item.current}
              className="tg-menu-item" onClick={() => { onClose(); item.onSelect(); }}>
              <span className="tg-menu-check" aria-hidden="true">{item.current ? "✓" : ""}</span>
              <span className="tg-menu-label">{item.label}</span>
              {item.current && <span className="tg-menu-current">{currentLabel}</span>}
            </button>
          </div>
        ))}
      </div>
    </div>
  ), document.body);
}

export interface ToastState {
  id: number;
  message: string;
  actions?: { label: string; onClick: () => void }[];
}

/** One quiet line at the bottom, with Undo where there is something to undo. Pauses while hovered or focused. */
export function Toast({ toast, onDone }: { toast: ToastState | null; onDone: () => void }) {
  const mounted = useMounted();
  const [paused, setPaused] = useState(false);
  const done = useCallback(onDone, [onDone]);
  useEffect(() => {
    if (!toast || paused) return;
    const timer = window.setTimeout(done, 7000);
    return () => window.clearTimeout(timer);
  }, [toast, paused, done]);
  if (!mounted) return null;
  return createPortal((
    <div className="tg-toast-wrap" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className="tg-toast fade-in"
          onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
          <span className="tg-toast-text">{toast.message}</span>
          {toast.actions?.map((a) => (
            <button key={a.label} type="button" className="tg-toast-action" onClick={() => { a.onClick(); done(); }}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  ), document.body);
}
