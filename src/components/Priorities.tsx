"use client";
import { useState } from "react";
import { useHabits } from "@/components/store";
import { useLocale, useT } from "@/lib/i18n/context";
import { shortDateFor } from "@/lib/i18n";
import { moveWithin } from "@/lib/habits";
import { carriedFrom, doneOn, prioritiesOn } from "@/lib/priorities";

/**
 * The day's post-it: the few things that matter most today.
 *
 * A sticky note, not a to-do application: no tags, no subtasks, no screen of
 * its own. It used to cap the list at five, on the reasoning that "what are the
 * most important things today" stops being useful when the answer is twelve
 * items long. The reasoning still holds; the cap did not. Once unfinished lines
 * roll forward, a day can hold six before anybody types anything — so the limit
 * refused a seventh while showing all six, which is not a rule, it is a
 * confusing message. The nudge toward focus stays, as words rather than as a
 * refusal.
 *
 * It sits above the habit sections because it is written at the start of the
 * day, and it pairs with the starter habit "choose your top three priorities":
 * that habit is the intention, this is where it actually gets written down.
 *
 * What is on a given day is derived, not stored. Anything still unfinished
 * comes forward on its own until it is ticked or struck out, as the same
 * record it always was — so a line that has rolled says which day it came
 * from, both because that is the honest label and because a note that quietly
 * grows overnight with no explanation is a note people stop trusting.
 *
 * Private user content: never read by an admin screen.
 */
export default function Priorities({ date }: { date: string }) {
  const { state, actions } = useHabits();
  const t = useT();
  const locale = useLocale();
  const items = prioritiesOn(state.priorities, date);
  const [draft, setDraft] = useState("");

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    actions.addPriority(date, text);
    setDraft("");
  };

  /** Same rule the habit list uses, so a reorder means one thing in this app. */
  const move = (i: number, delta: -1 | 1) => {
    const target = i + delta;
    if (target < 0 || target >= items.length) return;
    actions.reorderPriorities(
      moveWithin(items.map((p) => p.id), items[i].id, items[target].id),
    );
  };

  const done = items.filter((p) => doneOn(p, date)).length;
  /** Where the list stops being a post-it and the gentle nudge is worth saying. */
  const long = items.length > 5;

  return (
    <section className="card p-5" aria-labelledby="todays-priorities-title">
      <div className="flex items-baseline justify-between gap-3">
        <div className="eyebrow" id="todays-priorities-title">📌 {t.priorities.title}</div>
        {/*
          * What the day actually holds, rather than progress towards a cap.
          * Not an `eyebrow`: that upper-cases its text, and "0 COMPLETED · 12
          * PRIORITIES" shouts a running total that is meant to be glanceable.
          */}
        {items.length > 0 && (
          <span className="faint num" style={{ fontSize: 12.5, textAlign: "right", flex: "none" }}>
            {t.priorities.count(done, items.length)}
          </span>
        )}
      </div>

      {items.length === 0 && (
        <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.5 }}>
          {t.priorities.empty}
        </p>
      )}

      <div className="flex flex-col gap-1 mt-2.5">
        {items.map((item, i) => {
          const checked = doneOn(item, date);
          const from = carriedFrom(item, date);
          return (
            <div key={item.id} className="flex items-center gap-2.5 py-1">
              <span className="faint num" style={{ fontSize: 13, width: 14, flex: "none" }}>
                {i + 1}.
              </span>
              <button className="tick" data-on={checked}
                onClick={() => actions.setPriorityDone(item.id, !checked, date)}
                aria-pressed={checked}
                aria-label={checked ? t.priorities.uncheck(item.text) : t.priorities.check(item.text)}
                style={{ width: 22, height: 22, borderRadius: 7 }}>
                {checked && (
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M4.5 10.5l3.6 3.6L15.5 6.8" stroke="var(--accent-ink)"
                      strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <span style={{
                flex: 1, fontSize: 15, minWidth: 0, overflowWrap: "anywhere",
                opacity: checked ? 0.5 : 1,
              }}>
                <span style={{ textDecoration: checked ? "line-through" : undefined }}>
                  {item.text}
                </span>
                {/* Not a badge and not a warning. It answers "why is this here
                    today?" for anyone who reads it and stays out of the way of
                    everyone who does not. */}
                {from && !checked && (
                  // The leading space is for screen readers: adjacent spans with
                  // only a margin between them are read as one run-on word.
                  <span className="faint" style={{ fontSize: 11.5, marginLeft: 7, whiteSpace: "nowrap" }}>
                    {" "}
                    {t.priorities.carriedFrom(shortDateFor(from, locale))}
                  </span>
                )}
              </span>
              {/* Up/down rather than dragging: it works with a keyboard and a
                  thumb without any of the machinery, and a long list moves a
                  line one step at a time rather than needing a drag across it. */}
              <span className="flex items-center" style={{ flex: "none" }}>
                <button className="btn btn-quiet" style={{ padding: "1px 6px", fontSize: 13 }}
                  disabled={i === 0} aria-label={t.priorities.moveUp(i + 1)}
                  onClick={() => move(i, -1)}>↑</button>
                <button className="btn btn-quiet" style={{ padding: "1px 6px", fontSize: 13 }}
                  disabled={i === items.length - 1} aria-label={t.priorities.moveDown(i + 1)}
                  onClick={() => move(i, 1)}>↓</button>
                <button className="btn btn-quiet" style={{ padding: "1px 7px", fontSize: 14 }}
                  aria-label={t.priorities.remove(item.text)}
                  onClick={() => actions.deletePriority(item.id)}>×</button>
              </span>
            </div>
          );
        })}
      </div>

      {/* Always available. Nothing the person can write is refused, and a list
          that has grown gets a word of guidance rather than a closed door. */}
      <div className="flex gap-2 mt-2.5">
        <input className="input" value={draft} placeholder={t.priorities.placeholder}
          aria-label={t.priorities.add} maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn" style={{ flex: "none" }} disabled={!draft.trim()}
          onClick={add}>{t.priorities.add}</button>
      </div>
      {long && (
        <p className="faint mt-2" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
          {t.priorities.focusHint}
        </p>
      )}
    </section>
  );
}
