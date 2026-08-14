"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHabits } from "@/components/store";
import { Empty } from "@/components/ui";
import { uid } from "@/lib/habits";
import type { AwarenessEntry, Grade } from "@/lib/types";

const emptyDraft = () => ({ time: "", activity: "", duration: "", context: "", notes: "" });

export default function Awareness() {
  const { state, actions } = useHabits();
  const router = useRouter();
  const [draft, setDraft] = useState(emptyDraft);

  const entries = [...state.awareness].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const counts = entries.reduce<Record<Grade, number>>(
    (a, e) => ({ ...a, [e.grade]: (a[e.grade] ?? 0) + 1 }),
    { good: 0, bad: 0, neutral: 0 },
  );

  const add = () => {
    if (!draft.activity.trim()) return;
    actions.saveAwareness({ id: uid(), grade: "neutral", ...draft, activity: draft.activity.trim() });
    setDraft(emptyDraft());
  };

  const grade = (e: AwarenessEntry, g: Grade) =>
    actions.saveAwareness({ ...e, grade: e.grade === g ? "neutral" : g });

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="eyebrow">Step one</div>
        <h1 className="display mt-1" style={{ fontSize: 24, lineHeight: 1.2 }}>
          Write down the day you actually have
        </h1>
        <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.5 }}>
          Log an ordinary day hour by hour before judging any of it. Then mark each activity as good, bad,
          or neutral. The ones you mark become the raw material for the habits you keep and the ones you drop.
        </p>
        {entries.length > 0 && (
          <div className="flex gap-4 mt-3 num" style={{ fontSize: 13 }}>
            <span className="muted">{entries.length} logged</span>
            <span style={{ color: "var(--accent)" }}>{counts.good} good</span>
            <span style={{ color: "var(--warn)" }}>{counts.bad} bad</span>
            <span className="faint">{counts.neutral} neutral</span>
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-2.5">Add an activity</div>
        <div className="grid grid-cols-3 gap-2.5">
          <input className="input num" type="time" value={draft.time}
            onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
          <input className="input col-span-2" placeholder="Checked email" value={draft.activity}
            onChange={(e) => setDraft({ ...draft, activity: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && add()} />
          <input className="input" placeholder="20 min" value={draft.duration}
            onChange={(e) => setDraft({ ...draft, duration: e.target.value })} />
          <input className="input col-span-2" placeholder="Where / with whom" value={draft.context}
            onChange={(e) => setDraft({ ...draft, context: e.target.value })} />
        </div>
        <div className="flex justify-end mt-2.5">
          <button className="btn btn-primary" onClick={add}>Add to log</button>
        </div>
      </section>

      {entries.length === 0 ? (
        <Empty title="The log is empty"
          body="Start with when you woke up. Add the rest as the day goes — accuracy matters more than completeness." />
      ) : (
        <section className="card px-5 py-2">
          <div className="divide">
            {entries.map((e) => (
              <div key={e.id} className="py-3.5">
                <div className="flex items-baseline gap-3">
                  <span className="num faint" style={{ fontSize: 13, width: 52, flex: "none" }}>{e.time || "—"}</span>
                  <span className="flex-1" style={{ fontSize: 15 }}>{e.activity}</span>
                  <div className="flex gap-1" style={{ flex: "none" }}>
                    <button className="chip" data-on={e.grade === "good"} style={{ padding: "4px 10px" }}
                      onClick={() => grade(e, "good")}>Good</button>
                    <button className="chip" data-on={e.grade === "bad"} style={{ padding: "4px 10px" }}
                      onClick={() => grade(e, "bad")}>Bad</button>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-1 faint" style={{ fontSize: 12, paddingLeft: 64 }}>
                  {e.duration && <span>{e.duration}</span>}
                  {e.context && <span>{e.context}</span>}
                  <button className="btn btn-quiet" style={{ padding: "2px 8px", fontSize: 12 }}
                    onClick={() => router.push(`/habits?from=${encodeURIComponent(e.activity)}`)}>
                    Make a habit
                  </button>
                  <button className="btn btn-quiet" style={{ padding: "2px 8px", fontSize: 12 }}
                    onClick={() => actions.deleteAwareness(e.id)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
          <div className="h-2" />
        </section>
      )}
    </div>
  );
}
