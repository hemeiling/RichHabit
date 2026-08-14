"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHabits } from "@/components/store";
import { Empty } from "@/components/ui";
import { uid } from "@/lib/habits";
import { useT } from "@/lib/i18n/context";
import type { AwarenessEntry, Grade } from "@/lib/types";

const emptyDraft = () => ({ time: "", activity: "", duration: "", context: "", notes: "" });

export default function Awareness() {
  const { state, actions } = useHabits();
  const t = useT();
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
        <div className="eyebrow">{t.awareness.stepOne}</div>
        <h1 className="display mt-1" style={{ fontSize: 24, lineHeight: 1.2 }}>
          {t.awareness.heading}
        </h1>
        <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.5 }}>
          {t.awareness.intro}
        </p>
        {entries.length > 0 && (
          <div className="flex gap-4 mt-3 num" style={{ fontSize: 13 }}>
            <span className="muted">{t.awareness.logged(entries.length)}</span>
            <span style={{ color: "var(--accent)" }}>{t.awareness.goodCount(counts.good)}</span>
            <span style={{ color: "var(--warn)" }}>{t.awareness.badCount(counts.bad)}</span>
            <span className="faint">{t.awareness.neutralCount(counts.neutral)}</span>
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-2.5">{t.awareness.addActivity}</div>
        <div className="grid grid-cols-2 min-[360px]:grid-cols-3 gap-2.5">
          <input className="input num" type="time" value={draft.time}
            onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
          <input className="input col-span-2" placeholder={t.awareness.activityPlaceholder} value={draft.activity}
            onChange={(e) => setDraft({ ...draft, activity: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && add()} />
          <input className="input" placeholder={t.awareness.durationPlaceholder} value={draft.duration}
            onChange={(e) => setDraft({ ...draft, duration: e.target.value })} />
          <input className="input col-span-2" placeholder={t.awareness.contextPlaceholder} value={draft.context}
            onChange={(e) => setDraft({ ...draft, context: e.target.value })} />
        </div>
        <div className="flex justify-end mt-2.5">
          <button className="btn btn-primary" onClick={add}>{t.awareness.addToLog}</button>
        </div>
      </section>

      {entries.length === 0 ? (
        <Empty title={t.awareness.emptyTitle} body={t.awareness.emptyBody} />
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
                      onClick={() => grade(e, "good")}>{t.awareness.good}</button>
                    <button className="chip" data-on={e.grade === "bad"} style={{ padding: "4px 10px" }}
                      onClick={() => grade(e, "bad")}>{t.awareness.bad}</button>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-1 faint" style={{ fontSize: 12, paddingLeft: 64 }}>
                  {e.duration && <span>{e.duration}</span>}
                  {e.context && <span>{e.context}</span>}
                  <button className="btn btn-quiet" style={{ padding: "2px 8px", fontSize: 12 }}
                    onClick={() => router.push(`/habits?from=${encodeURIComponent(e.activity)}`)}>
                    {t.awareness.makeHabit}
                  </button>
                  <button className="btn btn-quiet" style={{ padding: "2px 8px", fontSize: 12 }}
                    onClick={() => actions.deleteAwareness(e.id)}>{t.common.remove}</button>
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
