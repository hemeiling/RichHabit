"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHabits } from "@/components/store";
import { useLocale, useT } from "@/lib/i18n/context";
import { shortDateFor } from "@/lib/i18n";
import {
  QUADRANTS, carriedFrom, cueFor, doneOn, isPlanOverdue, layoutAfterMove, prioritiesOn,
  quadrantFor,
} from "@/lib/priorities";
import { normalizePriorityCategory, type Priority, type PriorityCategory } from "@/lib/types";

type T = ReturnType<typeof useT>;

/**
 * §9. Today's priorities as the four-box matrix.
 *
 * Two ways to file a line, deliberately. Dragging is the direct one and reads
 * best with a mouse; the small control on each card is the one that works on a
 * phone, from a keyboard and with a screen reader — which makes it the primary
 * path for most people, not the fallback. Both end in `layoutAfterMove`, so
 * "where does everything sit now" is answered once.
 *
 * Native HTML5 drag events are used rather than a library. They do not fire on
 * touch, which is why the grip is hidden on devices without a fine pointer:
 * showing a handle that cannot be dragged is worse than showing none, and the
 * category control already covers that case properly.
 *
 * Exactly four boxes. `unsorted` is a stored value from before the matrix and
 * is resolved on the way in; nothing renders it as a fifth place to put things.
 */

/* One viewer's "not today" for the nudge line. Never account data. */
const NUDGE_KEY = "rh_priority_nudge_dismissed_on";

const QUADRANT_COLOR: Record<PriorityCategory, string> = {
  urgent_important: "var(--q-urgent-important)",
  urgent_not_important: "var(--q-urgent-not-important)",
  important_not_urgent: "var(--q-important-not-urgent)",
  not_important_not_urgent: "var(--q-not-important-not-urgent)",
  unsorted: "var(--q-important-not-urgent)",
};

/**
 * The shell both card menus live in: a sheet from the bottom on a phone, an
 * anchored popover on a pointer device.
 *
 * Rendered into <body>, for the reason `Sheet` in ui.tsx is. `<main>` carries
 * `.fade-in`, and an animation with `fill-mode: both` leaves a computed identity
 * matrix rather than `none` — enough to make main the containing block for
 * anything `position: fixed`. Laid out in place, the phone sheet was positioned
 * against the whole scrolling page instead of the viewport and landed thousands
 * of pixels below the fold. A portal puts it out of reach of any ancestor's
 * transform, which is also why the desktop position is measured from the anchor
 * rather than inherited from it.
 */
function Popover({ anchor, label, role, onClose, children }: {
  anchor: HTMLElement | null;
  label: string;
  role: "menu" | "dialog";
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setMounted(true), []);

  /*
   * Placed from the trigger's own box, before paint, so a menu that has to open
   * upward never appears downward first. The sheet needs none of this: CSS pins
   * it to the viewport.
   *
   * Re-placed on scroll and resize rather than closed. Opening a menu can itself
   * scroll its card into view, so closing on scroll shuts the menu the moment it
   * appears — and following the anchor is what someone expects anyway.
   */
  const place = useCallback(() => {
    if (!anchor) return;
    if (!window.matchMedia("(min-width: 640px)").matches) { setPos(null); return; }
    const a = anchor.getBoundingClientRect();
    const height = ref.current?.offsetHeight ?? 0;
    const below = a.bottom + 5;
    const fits = below + height <= window.innerHeight - 8;
    setPos({ top: fits ? below : Math.max(8, a.top - 5 - height), left: a.left });
  }, [anchor]);

  useLayoutEffect(() => { if (mounted) place(); }, [mounted, place]);

  useEffect(() => {
    if (!mounted) return;
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [mounted, place]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (anchor?.contains(e.target as Node)) return;   // the trigger toggles itself
      onClose();
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [onClose, anchor]);

  if (!mounted) return null;

  return createPortal((
    <div className="qmenu-wrap" data-anchored={pos ? "true" : undefined}
      style={pos ? { top: pos.top, left: pos.left } : undefined}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="qmenu-scrim" aria-hidden="true" onClick={onClose} />
      <div className="qmenu" ref={ref} role={role} aria-label={label}>{children}</div>
    </div>
  ), document.body);
}

/**
 * The four choices. A sheet from the bottom on a phone and an anchored popover
 * on a pointer device — one component, the shape decided in CSS.
 *
 * Roving focus with the arrow keys, Escape to leave, and the current quadrant
 * carried as `aria-checked`, so the control announces where the line is now
 * before offering to move it.
 */
function CategoryMenu({ current, anchor, t, onPick, onClose }: {
  current: PriorityCategory;
  anchor: HTMLElement | null;
  t: T;
  onPick: (category: PriorityCategory) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(() => Math.max(0, QUADRANTS.indexOf(current)));
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelectorAll<HTMLButtonElement>(".qmenu-item")[active]?.focus();
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step) {
      e.preventDefault();
      setActive((i) => (i + step + QUADRANTS.length) % QUADRANTS.length);
    }
    if (e.key === "Home") { e.preventDefault(); setActive(0); }
    if (e.key === "End") { e.preventDefault(); setActive(QUADRANTS.length - 1); }
  };

  return (
    <Popover anchor={anchor} role="menu" label={t.priorities.categoryHeading} onClose={onClose}>
      <div ref={listRef} onKeyDown={onKeyDown}>
        <div className="qmenu-head">{t.priorities.categoryHeading}</div>
        {QUADRANTS.map((category) => {
          const label = t.priorities.quadrants[category];
          return (
            <button
              key={category} type="button" className="qmenu-item"
              role="menuitemradio" aria-checked={category === current} tabIndex={-1}
              onClick={() => onPick(category)}
            >
              <span className="quad-dot" aria-hidden="true"
                style={{ background: QUADRANT_COLOR[category], marginTop: 6 }} />
              <span style={{ minWidth: 0 }}>
                <span className="qmenu-title" style={{ display: "block" }}>{label.title}</span>
                <span className="qmenu-sub" style={{ display: "block" }}>{label.subtitle}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

/**
 * "When will you do this?" — the whole of Q2 scheduling.
 *
 * A native date field, because it brings the platform's own picker to every
 * device for nothing, and one Clear. There is no calendar here, no recurrence
 * and no reminder: the point is to answer the question, not to run a diary.
 */
function PlanMenu({ value, anchor, t, onPick, onClose }: {
  value: string | null;
  anchor: HTMLElement | null;
  t: T;
  onPick: (plannedOn: string | null) => void;
  onClose: () => void;
}) {
  const fieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => { fieldRef.current?.focus(); }, []);

  return (
    <Popover anchor={anchor} role="dialog" label={t.priorities.planHeading} onClose={onClose}>
      <div className="qmenu-head">{t.priorities.planHeading}</div>
      <div style={{ padding: "0 6px 6px" }}>
        <input
          ref={fieldRef} className="input" type="date" value={value ?? ""}
          aria-label={t.priorities.planHeading}
          onChange={(e) => onPick(e.target.value || null)}
        />
        {value && (
          <button type="button" className="btn btn-quiet" style={{ marginTop: 8, width: "100%" }}
            onClick={() => onPick(null)}>
            {t.priorities.planClear}
          </button>
        )}
      </div>
    </Popover>
  );
}

function PriorityCard({
  item, category, date, locale, t, dragging, over, settling, menuOpen, planOpen,
  onToggle, onDelete, onSetCategory, onMenu, onPlanMenu, onSetPlan,
  onDragStart, onDragEnd, onDragOverCard, onDropOnCard,
}: {
  item: Priority;
  category: PriorityCategory;
  date: string;
  locale: string;
  t: T;
  dragging: boolean;
  over: boolean;
  settling: boolean;
  menuOpen: boolean;
  planOpen: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onSetCategory: (category: PriorityCategory) => void;
  onMenu: (open: boolean) => void;
  onPlanMenu: (open: boolean) => void;
  onSetPlan: (plannedOn: string | null) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverCard: () => void;
  onDropOnCard: () => void;
}) {
  const checked = doneOn(item, date);
  const from = carriedFrom(item, date);
  const label = t.priorities.quadrants[category];
  /*
   * Amber, and nothing else. No word, no icon, no banner: the date having
   * passed is the whole message, and a line already ticked is never marked —
   * finishing late is still finishing.
   */
  const overdue = isPlanOverdue(item, date);
  const cardRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLButtonElement>(null);
  const planRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      ref={cardRef} className="pcard"
      data-dragging={dragging || undefined}
      data-over={over || undefined}
      data-settling={settling || undefined}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; onDragOverCard(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropOnCard(); }}
    >
      {/* Pointer devices only, as with a habit row. Dragging the grip carries
          the whole card as the drag image, so what you pick up is what you see. */}
      <span
        className="drag-handle faint" draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", item.id);
          // What you pick up is the card, not the grip. Without this the drag
          // image is the 13px handle alone, which gives no sense of what is
          // moving or where it would land.
          const card = cardRef.current;
          if (card) {
            const box = card.getBoundingClientRect();
            e.dataTransfer.setDragImage(card, e.clientX - box.left, e.clientY - box.top);
          }
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        aria-hidden="true" title={t.priorities.drag(item.text)}
        style={{ cursor: "grab", fontSize: 13, lineHeight: 1, userSelect: "none", marginTop: 5 }}
      >⠿</span>

      <button
        className="tick" data-on={checked} onClick={onToggle} aria-pressed={checked}
        aria-label={checked ? t.priorities.uncheck(item.text) : t.priorities.check(item.text)}
        style={{ width: 22, height: 22, borderRadius: 7, marginTop: 1 }}
      >
        {checked && (
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M4.5 10.5l3.6 3.6L15.5 6.8" stroke="var(--accent-ink)" strokeWidth="2.6"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* The line itself, and the only thing at full strength. `anywhere`
            wraps an unbroken English URL and a run of Chinese alike. */}
        <div className="pcard-text" style={{
          fontSize: 14.5, lineHeight: 1.4, overflowWrap: "anywhere",
          textDecoration: checked ? "line-through" : undefined, opacity: checked ? 0.5 : 1,
        }}>
          {item.text}
        </div>

        {/* Metadata and the quadrant control share a line, at the same weight:
            where it sits and where it came from are the same kind of fact. */}
        <div className="flex flex-wrap items-center" style={{ gap: "0 6px", marginTop: 2 }}>
          <button
            ref={categoryRef}
            type="button" className="qpill"
            aria-haspopup="menu" aria-expanded={menuOpen}
            aria-label={t.priorities.setCategory(item.text, label.title)}
            onClick={() => onMenu(!menuOpen)}
          >
            <span className="quad-dot" aria-hidden="true" style={{ background: QUADRANT_COLOR[category] }} />
            <span>{label.short}</span>
          </button>
          {/*
            * Q2 only. The quadrant the method says to protect is the one where
            * "when?" is the question that stops it becoming Q1, and it is the
            * only quadrant where the question earns a control. A Q2 line with
            * no day is completely ordinary — nothing here is required.
            */}
          {category === "important_not_urgent" && (
            <button
              ref={planRef}
              type="button" className="qpill"
              aria-haspopup="dialog" aria-expanded={planOpen}
              aria-label={item.plannedOn
                ? t.priorities.plannedFor(item.text, shortDateFor(item.plannedOn, locale as any))
                : t.priorities.planFor(item.text)}
              onClick={() => onPlanMenu(!planOpen)}
              style={overdue ? { color: "var(--warn)" } : undefined}
            >
              <span>{item.plannedOn
                ? shortDateFor(item.plannedOn, locale as any)
                : `+ ${t.priorities.plan}`}</span>
            </button>
          )}
          {from && !checked && (
            <span className="faint" style={{ fontSize: 11.5 }}>
              {t.priorities.carriedFrom(shortDateFor(from, locale as any))}
            </span>
          )}
        </div>
      </div>

      <button className="pcard-x" aria-label={t.priorities.remove(item.text)} onClick={onDelete}>×</button>

      {menuOpen && (
        <CategoryMenu current={category} anchor={categoryRef.current} t={t}
          onPick={onSetCategory} onClose={() => onMenu(false)} />
      )}
      {planOpen && (
        <PlanMenu value={item.plannedOn} anchor={planRef.current} t={t}
          onPick={onSetPlan} onClose={() => onPlanMenu(false)} />
      )}
    </div>
  );
}

export default function Priorities({ date }: { date: string }) {
  const { state, actions } = useHabits();
  const t = useT();
  const locale = useLocale();
  const allItems = prioritiesOn(state.priorities, date);

  const [draft, setDraft] = useState("");
  /*
   * The two answers. `null` is "not answered yet", which is distinct from "no"
   * — that distinction is the entire point of the change, so it cannot be a
   * boolean with a default.
   */
  const [important, setImportant] = useState<boolean | null>(null);
  const [urgent, setUrgent] = useState<boolean | null>(null);
  const [planFor, setPlanFor] = useState<string | null>(null);
  const [nudgeAllowed, setNudgeAllowed] = useState(false);
  const [cueGone, setCueGone] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCard, setOverCard] = useState<string | null>(null);
  const [overQuad, setOverQuad] = useState<PriorityCategory | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [settling, setSettling] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(settleTimer.current), []);

  /*
   * Whether a nudge is allowed today. Read after mount, never during render, so
   * the server and the client agree on the first paint.
   *
   * `localStorage` rather than a column: this is one viewer's "not now", not
   * something the account needs to remember or another device needs to know.
   * Every access is guarded, because a private window throws on the property
   * itself and a nudge is never worth a blank screen.
   */
  useEffect(() => {
    try {
      setNudgeAllowed(window.localStorage.getItem(NUDGE_KEY) !== date);
    } catch { setNudgeAllowed(false); }
  }, [date]);

  const dismissCue = () => {
    setCueGone(true);
    try { window.localStorage.setItem(NUDGE_KEY, date); } catch { /* nothing to do */ }
  };

  const answered = important !== null && urgent !== null;

  const add = () => {
    const text = draft.trim();
    if (!text || !answered) return;
    actions.addPriority(date, text, quadrantFor(important, urgent));
    setDraft("");
    setImportant(null);
    setUrgent(null);
  };

  /*
   * Clearing the box clears the answers. The next line starts unclassified,
   * rather than inheriting a judgement made about a different thing.
   */
  const setText = (value: string) => {
    setDraft(value);
    if (!value.trim()) { setImportant(null); setUrgent(null); }
  };

  const groups = useMemo(() => {
    const base = Object.fromEntries(QUADRANTS.map((q) => [q, [] as Priority[]])) as
      Record<PriorityCategory, Priority[]>;
    for (const item of allItems) base[normalizePriorityCategory(item.category)].push(item);
    for (const q of QUADRANTS) base[q].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return base;
  }, [allItems]);

  /**
   * Every move, however it was started. The record is never recreated: only
   * `category` and `sortOrder` are sent, so the id, the text and both dates
   * come through a rearrangement untouched.
   */
  const move = useCallback((id: string, to: PriorityCategory, beforeId: string | null) => {
    const layout = layoutAfterMove(allItems, id, to, beforeId);
    if (!layout.length) return;
    actions.updatePriorityLayout(layout);

    const moved = allItems.find((p) => p.id === id);
    if (moved) setAnnounce(t.priorities.movedTo(moved.text, t.priorities.quadrants[to].title));

    setSettling(id);
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setSettling(null), 240);
  }, [allItems, actions, t]);

  const endDrag = () => { setDragId(null); setOverCard(null); setOverQuad(null); };

  const done = allItems.filter((p) => doneOn(p, date)).length;
  const total = allItems.length;
  /* At most one line, and never both kinds. */
  const cue = useMemo(() => cueFor(allItems, date, nudgeAllowed), [allItems, date, nudgeAllowed]);

  return (
    <section className="card p-5" aria-labelledby="todays-priorities-title">
      <div className="flex items-baseline justify-between gap-3">
        <div className="eyebrow" id="todays-priorities-title">📌 {t.priorities.title}</div>
        {total > 0 && (
          <span className="faint num" style={{ fontSize: 12.5, textAlign: "right", flex: "none" }}>
            {t.priorities.count(done, total)}
          </span>
        )}
      </div>

      {cue && !cueGone && (
        <div className="pcue">
          <span>
            {cue.kind === "nudge"
              ? t.priorities.nudge[cue.quadrant]
              : cue.key === "protect"
                ? t.priorities.insight.protect(cue.count)
                : t.priorities.insight.mostlyUrgent()}
          </span>
          <button type="button" className="pcue-x" aria-label={t.priorities.dismiss}
            onClick={dismissCue}>×</button>
        </div>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {QUADRANTS.map((category) => {
          const items = groups[category];
          const label = t.priorities.quadrants[category];
          return (
            <div
              key={category} className="quad"
              data-over={(overQuad === category && dragId) || undefined}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOverQuad(category); setOverCard(null);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setOverQuad((q) => (q === category ? null : q));
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) move(dragId, category, null);
                endDrag();
              }}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex items-start gap-2" style={{ minWidth: 0 }}>
                  <span className="quad-dot" aria-hidden="true"
                    style={{ background: QUADRANT_COLOR[category], marginTop: 6 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>{label.title}</div>
                    <div className="faint" style={{ fontSize: 11, lineHeight: 1.3, marginTop: 1 }}>{label.subtitle}</div>
                  </div>
                </div>
                <span className="num faint" style={{ fontSize: 12, flex: "none" }}>{items.length}</span>
              </div>

              <div className="space-y-1.5">
                {items.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--line)] px-2.5 py-3 text-center faint"
                    style={{ fontSize: 11.5 }}>
                    {dragId ? t.priorities.dropHere : t.priorities.emptyQuadrant}
                  </div>
                ) : items.map((item) => (
                  <PriorityCard
                    key={item.id} item={item} category={category} date={date} locale={locale} t={t}
                    dragging={dragId === item.id}
                    over={overCard === item.id && dragId !== null && dragId !== item.id}
                    settling={settling === item.id}
                    menuOpen={menuFor === item.id}
                    planOpen={planFor === item.id}
                    onToggle={() => actions.setPriorityDone(item.id, !doneOn(item, date), date)}
                    onDelete={() => actions.deletePriority(item.id)}
                    onMenu={(open) => setMenuFor(open ? item.id : null)}
                    onPlanMenu={(open) => setPlanFor(open ? item.id : null)}
                    onSetPlan={(plannedOn) => {
                      setPlanFor(null);
                      actions.setPriorityPlannedOn(item.id, plannedOn);
                    }}
                    onSetCategory={(next) => {
                      setMenuFor(null);
                      if (next !== category) move(item.id, next, null);
                    }}
                    onDragStart={() => setDragId(item.id)}
                    onDragEnd={endDrag}
                    onDragOverCard={() => { setOverCard(item.id); setOverQuad(category); }}
                    onDropOnCard={() => { if (dragId) move(dragId, category, item.id); endDrag(); }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3">
        <div className="flex gap-2">
          <input className="input" value={draft} placeholder={t.priorities.placeholder}
            aria-label={t.priorities.add} maxLength={200}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="btn" style={{ flex: "none" }}
            disabled={!draft.trim() || !answered} onClick={add}>
            {t.priorities.add}
          </button>
        </div>

        {/*
          * The two questions, and nothing else. They appear with the text and
          * disappear with it, so the resting state of this screen is still a
          * box and a button.
          *
          * Add stays disabled until both are answered. There is no default
          * because there is no honest one: every value this could fall back to
          * would be the app deciding what matters to someone, which is the one
          * thing it must not do.
          */}
        {draft.trim() && (
          <div className="pask">
            <span className="pask-q">
              <span className="faint">{t.priorities.askImportant}</span>
              <button type="button" className="chip" data-on={important === true}
                onClick={() => setImportant(true)}>{t.priorities.yes}</button>
              <button type="button" className="chip" data-on={important === false}
                onClick={() => setImportant(false)}>{t.priorities.no}</button>
            </span>
            <span className="pask-q">
              <span className="faint">{t.priorities.askUrgent}</span>
              <button type="button" className="chip" data-on={urgent === true}
                onClick={() => setUrgent(true)}>{t.priorities.yes}</button>
              <button type="button" className="chip" data-on={urgent === false}
                onClick={() => setUrgent(false)}>{t.priorities.no}</button>
            </span>
            {/* The derived quadrant, shown the moment it is decided. */}
            {answered && (
              <span className="pask-derived">
                <span className="quad-dot" aria-hidden="true"
                  style={{ background: QUADRANT_COLOR[quadrantFor(important, urgent)] }} />
                <span>{t.priorities.quadrants[quadrantFor(important, urgent)].short}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {total === 0 && (
        <p className="muted mt-3" style={{ fontSize: 14, lineHeight: 1.5 }}>{t.priorities.empty}</p>
      )}

      {/* A move made from the keyboard or the category control changes nothing
          a screen reader would otherwise notice. This says what happened. */}
      <p aria-live="polite" className="sr-only" style={{
        position: "absolute", width: 1, height: 1, overflow: "hidden",
        clip: "rect(0 0 0 0)", whiteSpace: "nowrap",
      }}>{announce}</p>
    </section>
  );
}
