"use client";
import { useState } from "react";
import { useHabits } from "@/components/store";
import { Empty, Field, Sheet } from "@/components/ui";
import { uid } from "@/lib/habits";
import type { Stack } from "@/lib/types";

const emptyStack = (): Stack => ({
  id: uid(), triggerHabitId: "", triggerText: "", newHabitId: "", newText: "", time: "", location: "",
});

export default function Stacks() {
  const { state, actions } = useHabits();
  const [draft, setDraft] = useState<Stack | null>(null);

  const label = (id: string, fallback: string) =>
    state.habits.find((h) => h.id === id)?.name ?? fallback ?? "…";
  const isExisting = (k: Stack) => state.stacks.some((x) => x.id === k.id);
  const complete = (k: Stack) =>
    (k.triggerHabitId || k.triggerText.trim()) && (k.newHabitId || k.newText.trim());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="muted" style={{ fontSize: 14, maxWidth: 420 }}>
          Attach something new to something you already do without thinking.
        </p>
        <button className="btn btn-primary" style={{ flex: "none" }} onClick={() => setDraft(emptyStack())}>New</button>
      </div>

      {state.stacks.length === 0 && (
        <Empty title="No stacks yet" body="Example: after I pour my morning coffee, I read for ten minutes." />
      )}

      {state.stacks.map((k) => (
        <button key={k.id} className="card p-5 text-left w-full" style={{ cursor: "pointer" }}
          onClick={() => setDraft(k)}>
          <p className="display" style={{ fontSize: 21, lineHeight: 1.35 }}>
            After I <span style={{ borderBottom: "1.5px solid var(--accent)" }}>{label(k.triggerHabitId, k.triggerText)}</span>,
            {" "}I will <span style={{ borderBottom: "1.5px solid var(--accent)" }}>{label(k.newHabitId, k.newText)}</span>.
          </p>
          {(k.time || k.location) && (
            <div className="faint flex gap-3 mt-2" style={{ fontSize: 12.5 }}>
              {k.time && <span className="num">{k.time}</span>}
              {k.location && <span>{k.location}</span>}
            </div>
          )}
        </button>
      ))}

      {draft && (
        <Sheet
          open onClose={() => setDraft(null)} title="Habit stack"
          footer={
            <>
              {isExisting(draft) && (
                <button className="btn btn-danger mr-auto"
                  onClick={() => { actions.deleteStack(draft.id); setDraft(null); }}>Delete</button>
              )}
              <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={!complete(draft)}
                onClick={() => { actions.saveStack(draft); setDraft(null); }}>Save stack</button>
            </>
          }
        >
          <Field label="Trigger — something you already do">
            <select className="select mb-2" value={draft.triggerHabitId}
              onChange={(e) => setDraft({ ...draft, triggerHabitId: e.target.value })}>
              <option value="">Write it in instead</option>
              {state.habits.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            {!draft.triggerHabitId && (
              <input className="input" placeholder="Pour my morning coffee" value={draft.triggerText}
                onChange={(e) => setDraft({ ...draft, triggerText: e.target.value })} />
            )}
          </Field>
          <Field label="New habit">
            <select className="select mb-2" value={draft.newHabitId}
              onChange={(e) => setDraft({ ...draft, newHabitId: e.target.value })}>
              <option value="">Write it in instead</option>
              {state.habits.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            {!draft.newHabitId && (
              <input className="input" placeholder="Read for ten minutes" value={draft.newText}
                onChange={(e) => setDraft({ ...draft, newText: e.target.value })} />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Time">
              <input className="input num" type="time" value={draft.time}
                onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
            </Field>
            <Field label="Place">
              <input className="input" placeholder="Kitchen table" value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
            </Field>
          </div>
        </Sheet>
      )}
    </div>
  );
}
