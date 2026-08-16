"use client";
import { useState } from "react";
import { useHabits } from "@/components/store";
import { useT } from "@/lib/i18n/context";
import { moveWithin } from "@/lib/habits";
import { MAX_PRIORITIES } from "@/lib/types";
import type { DayPriority } from "@/lib/types";

/**
 * The day's post-it: the few things that matter most today.
 *
 * A sticky note, not a to-do application. Five lines at most, no dates, no
 * tags, no subtasks, no screen of its own — the cap is the feature, because
 * "what are the most important things today" stops being a useful question the
 * moment the answer can be twelve items long.
 *
 * It sits above the habit sections because it is written at the start of the
 * day, and it pairs with the starter habit "choose your top three priorities":
 * that habit is the intention, this is where it actually gets written down.
 *
 * Each day has its own note. Yesterday's is kept and reachable by stepping back
 * a day; today starts blank. Auto-saved, like the journal.
 *
 * Private user content: never read by an admin screen.
 */
export default function Priorities({ date }: { date: string }) {
  const { state, actions } = useHabits();
  const t = useT();
  const items = state.priorities[date] ?? [];
  const [draft, setDraft] = useState("");

  const commit = (next: DayPriority[]) => actions.setPriorities(date, next);

  const add = () => {
    const text = draft.trim();
    if (!text || items.length >= MAX_PRIORITIES) return;
    commit([...items, { text, done: false }]);
    setDraft("");
  };

  const toggle = (i: number) =>
    commit(items.map((it, n) => (n === i ? { ...it, done: !it.done } : it)));

  const remove = (i: number) => commit(items.filter((_, n) => n !== i));

  /** Same rule the habit list uses, so a reorder means one thing in this app. */
  const move = (i: number, delta: -1 | 1) => {
    const target = i + delta;
    if (target < 0 || target >= items.length) return;
    const order = moveWithin(items.map((_, n) => String(n)), String(i), String(target));
    commit(order.map((n) => items[Number(n)]));
  };

  const full = items.length >= MAX_PRIORITIES;

  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="eyebrow">📌 {t.priorities.title}</div>
        {items.length > 0 && (
          <span className="eyebrow">
            {t.common.of(items.filter((i) => i.done).length, items.length)}
          </span>
        )}
      </div>

      {items.length === 0 && (
        <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.5 }}>
          {t.priorities.empty}
        </p>
      )}

      <div className="flex flex-col gap-1 mt-2.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2.5 py-1">
            <span className="faint num" style={{ fontSize: 13, width: 14, flex: "none" }}>
              {i + 1}.
            </span>
            <button className="tick" data-on={item.done} onClick={() => toggle(i)}
              aria-pressed={item.done}
              aria-label={item.done ? t.priorities.uncheck(item.text) : t.priorities.check(item.text)}
              style={{ width: 22, height: 22, borderRadius: 7 }}>
              {item.done && (
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M4.5 10.5l3.6 3.6L15.5 6.8" stroke="var(--accent-ink)"
                    strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <span style={{
              flex: 1, fontSize: 15, minWidth: 0, overflowWrap: "anywhere",
              opacity: item.done ? 0.5 : 1,
              textDecoration: item.done ? "line-through" : undefined,
            }}>{item.text}</span>
            {/* Up/down rather than dragging: five items, and it works with a
                keyboard and a thumb without any of the machinery. */}
            <span className="flex items-center" style={{ flex: "none" }}>
              <button className="btn btn-quiet" style={{ padding: "1px 6px", fontSize: 13 }}
                disabled={i === 0} aria-label={t.priorities.moveUp(i + 1)}
                onClick={() => move(i, -1)}>↑</button>
              <button className="btn btn-quiet" style={{ padding: "1px 6px", fontSize: 13 }}
                disabled={i === items.length - 1} aria-label={t.priorities.moveDown(i + 1)}
                onClick={() => move(i, 1)}>↓</button>
              <button className="btn btn-quiet" style={{ padding: "1px 7px", fontSize: 14 }}
                aria-label={t.priorities.remove(item.text)}
                onClick={() => remove(i)}>×</button>
            </span>
          </div>
        ))}
      </div>

      {/* The field disappears at the cap rather than erroring — the limit is
          the point, and a form that cannot be over-filled needs no message. */}
      {!full ? (
        <div className="flex gap-2 mt-2.5">
          <input className="input" value={draft} placeholder={t.priorities.placeholder}
            aria-label={t.priorities.add} maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="btn" style={{ flex: "none" }} disabled={!draft.trim()}
            onClick={add}>{t.priorities.add}</button>
        </div>
      ) : (
        <p className="faint mt-2.5" style={{ fontSize: 12.5 }}>{t.priorities.full}</p>
      )}
    </section>
  );
}
