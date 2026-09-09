"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useHabits } from "@/components/store";
import { useLocale, useT } from "@/lib/i18n/context";
import { shortDateFor } from "@/lib/i18n";
import { QUADRANTS, carriedFrom, doneOn, layoutAfterMove, prioritiesOn } from "@/lib/priorities";
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

const QUADRANT_COLOR: Record<PriorityCategory, string> = {
  urgent_important: "var(--q-urgent-important)",
  urgent_not_important: "var(--q-urgent-not-important)",
  important_not_urgent: "var(--q-important-not-urgent)",
  not_important_not_urgent: "var(--q-not-important-not-urgent)",
  unsorted: "var(--q-important-not-urgent)",
};

/**
 * The four choices. A sheet from the bottom on a phone and an anchored popover
 * on a pointer device — one component, the shape decided in CSS.
 *
 * Roving focus with the arrow keys, Escape to leave, and the current quadrant
 * carried as `aria-checked`, so the control announces where the line is now
 * before offering to move it.
 */
function CategoryMenu({ current, t, onPick, onClose }: {
  current: PriorityCategory;
  t: T;
  onPick: (category: PriorityCategory) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => Math.max(0, QUADRANTS.indexOf(current)));
  const [up, setUp] = useState(false);

  /*
   * A card near the bottom of the window would open its menu below the fold.
   * Measured once, before paint, so the menu appears in its final place rather
   * than jumping. The bottom sheet is fixed to the viewport and never needs it,
   * which is what the position check distinguishes.
   */
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || getComputedStyle(wrap).position !== "absolute") return;
    setUp(wrap.getBoundingClientRect().bottom > window.innerHeight - 8);
  }, []);

  useEffect(() => {
    const items = ref.current?.querySelectorAll<HTMLButtonElement>(".qmenu-item");
    items?.[active]?.focus();
  }, [active]);

  // Anywhere outside closes it, and so does Escape. `pointerdown` rather than
  // click: a press that starts outside is already a decision to leave.
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step) {
      e.preventDefault();
      setActive((i) => (i + step + QUADRANTS.length) % QUADRANTS.length);
    }
    if (e.key === "Home") { e.preventDefault(); setActive(0); }
    if (e.key === "End") { e.preventDefault(); setActive(QUADRANTS.length - 1); }
  };

  return (
    <div className="qmenu-wrap" ref={wrapRef} data-up={up || undefined} onKeyDown={onKeyDown}>
      <div className="qmenu-scrim" aria-hidden="true" />
      <div className="qmenu" ref={ref} role="menu" aria-label={t.priorities.categoryHeading}>
        <div className="qmenu-head">{t.priorities.categoryHeading}</div>
        {QUADRANTS.map((category) => {
          const label = t.priorities.quadrants[category];
          const on = category === current;
          return (
            <button
              key={category} type="button" className="qmenu-item"
              role="menuitemradio" aria-checked={on} tabIndex={-1}
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
    </div>
  );
}

function PriorityCard({
  item, category, date, locale, t, dragging, over, settling, menuOpen,
  onToggle, onDelete, onSetCategory, onMenu, onDragStart, onDragEnd, onDragOverCard, onDropOnCard,
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
  onToggle: () => void;
  onDelete: () => void;
  onSetCategory: (category: PriorityCategory) => void;
  onMenu: (open: boolean) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverCard: () => void;
  onDropOnCard: () => void;
}) {
  const checked = doneOn(item, date);
  const from = carriedFrom(item, date);
  const label = t.priorities.quadrants[category];
  const cardRef = useRef<HTMLDivElement>(null);

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
            type="button" className="qpill"
            aria-haspopup="menu" aria-expanded={menuOpen}
            aria-label={t.priorities.setCategory(item.text, label.title)}
            onClick={() => onMenu(!menuOpen)}
          >
            <span className="quad-dot" aria-hidden="true" style={{ background: QUADRANT_COLOR[category] }} />
            <span>{label.short}</span>
          </button>
          {from && !checked && (
            <span className="faint" style={{ fontSize: 11.5 }}>
              {t.priorities.carriedFrom(shortDateFor(from, locale as any))}
            </span>
          )}
        </div>
      </div>

      <button className="pcard-x" aria-label={t.priorities.remove(item.text)} onClick={onDelete}>×</button>

      {menuOpen && (
        <CategoryMenu current={category} t={t} onPick={onSetCategory} onClose={() => onMenu(false)} />
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
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCard, setOverCard] = useState<string | null>(null);
  const [overQuad, setOverQuad] = useState<PriorityCategory | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [settling, setSettling] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(settleTimer.current), []);

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    actions.addPriority(date, text);
    setDraft("");
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
                    onToggle={() => actions.setPriorityDone(item.id, !doneOn(item, date), date)}
                    onDelete={() => actions.deletePriority(item.id)}
                    onMenu={(open) => setMenuFor(open ? item.id : null)}
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

      <div className="flex gap-2 mt-3">
        <input className="input" value={draft} placeholder={t.priorities.placeholder}
          aria-label={t.priorities.add} maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn" style={{ flex: "none" }} disabled={!draft.trim()} onClick={add}>
          {t.priorities.add}
        </button>
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
