"use client";
import { useMemo, useState } from "react";
import { useHabits } from "@/components/store";
import { useLocale, useT } from "@/lib/i18n/context";
import { shortDateFor } from "@/lib/i18n";
import { carriedFrom, doneOn, prioritiesOn } from "@/lib/priorities";
import type { Priority, PriorityCategory } from "@/lib/types";

const QUADRANTS: PriorityCategory[] = [
  "urgent_important",
  "urgent_not_important",
  "important_not_urgent",
  "not_important_not_urgent",
];

const quadrantId = (category: PriorityCategory) => category;

function PriorityCard({ item, date, locale, t, onToggle, onDelete }: {
  item: Priority;
  date: string;
  locale: string;
  t: any;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const checked = doneOn(item, date);
  const from = carriedFrom(item, date);

  return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 shadow-sm" draggable onDragStart={(e) => {
      e.dataTransfer.setData("text/plain", item.id);
      e.dataTransfer.effectAllowed = "move";
    }}>
      <span className="drag-handle faint" style={{ cursor: "grab", fontSize: 12, userSelect: "none" }} aria-hidden="true">⋮⋮</span>
      <button className="tick" data-on={checked}
        onClick={() => onToggle(item.id)}
        aria-pressed={checked}
        aria-label={checked ? t.priorities.uncheck(item.text) : t.priorities.check(item.text)}
        style={{ width: 22, height: 22, borderRadius: 7 }}>
        {checked && (
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M4.5 10.5l3.6 3.6L15.5 6.8" stroke="var(--accent-ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, overflowWrap: "anywhere", textDecoration: checked ? "line-through" : undefined, opacity: checked ? 0.55 : 1 }}>
          {item.text}
        </div>
        {from && !checked && (
          <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
            {t.priorities.carriedFrom(shortDateFor(from, locale as any))}
          </div>
        )}
      </div>
      <button className="btn btn-quiet" style={{ padding: "1px 7px", fontSize: 14 }} aria-label={t.priorities.remove(item.text)} onClick={() => onDelete(item.id)}>×</button>
    </div>
  );
}

export default function Priorities({ date }: { date: string }) {
  const { state, actions } = useHabits();
  const t = useT();
  const locale = useLocale();
  const allItems = prioritiesOn(state.priorities, date);
  const [draft, setDraft] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    actions.addPriority(date, text);
    setDraft("");
  };

  const groups = useMemo(() => {
    const base: Record<PriorityCategory, Priority[]> = {
      unsorted: allItems.filter((item) => item.category === "unsorted"),
      urgent_important: allItems.filter((item) => item.category === "urgent_important"),
      urgent_not_important: allItems.filter((item) => item.category === "urgent_not_important"),
      important_not_urgent: allItems.filter((item) => item.category === "important_not_urgent"),
      not_important_not_urgent: allItems.filter((item) => item.category === "not_important_not_urgent"),
    };
    for (const key of Object.keys(base) as Array<keyof typeof base>) {
      base[key].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }
    return base;
  }, [allItems]);

  const handleDrop = (category: PriorityCategory) => {
    if (!draggedId) return;
    const next = allItems.map((item) => ({
      id: item.id,
      category: item.id === draggedId ? category : item.category,
      sortOrder: item.id === draggedId ? (groups[category]?.length ?? 0) : item.sortOrder,
    }));
    const reordered = next.slice().sort((a, b) => {
      if (a.category !== b.category) return 0;
      return a.sortOrder - b.sortOrder;
    });
    actions.updatePriorityLayout(reordered);
    setDraggedId(null);
  };

  const moveWithinCategory = (category: PriorityCategory, dragId: string, targetId: string) => {
    if (dragId === targetId) return;
    const items = [...(groups[category] ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const sourceIndex = items.findIndex((item) => item.id === dragId);
    const targetIndex = items.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = items.splice(sourceIndex, 1);
    items.splice(targetIndex, 0, moved);
    const layout = allItems.map((item) => {
      const index = items.findIndex((entry) => entry.id === item.id);
      return {
        id: item.id,
        category: item.category,
        sortOrder: index >= 0 ? index : item.sortOrder ?? 0,
      };
    });
    actions.updatePriorityLayout(layout.map((entry) => ({
      ...entry,
      category: entry.id === dragId ? category : entry.category,
    })));
  };

  const done = allItems.filter((p) => doneOn(p, date)).length;
  const total = allItems.length;

  return (
    <section className="card p-5" aria-labelledby="todays-priorities-title">
      <div className="flex items-baseline justify-between gap-3">
        <div className="eyebrow" id="todays-priorities-title">📌 {t.priorities.title}</div>
        {total > 0 && <span className="faint num" style={{ fontSize: 12.5, textAlign: "right", flex: "none" }}>{t.priorities.count(done, total)}</span>}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {([
          { key: "unsorted", category: "unsorted" },
          { key: "urgent_important", category: "urgent_important" },
          { key: "urgent_not_important", category: "urgent_not_important" },
          { key: "important_not_urgent", category: "important_not_urgent" },
          { key: "not_important_not_urgent", category: "not_important_not_urgent" },
        ] as const).map(({ key, category }) => {
          const items: Priority[] = groups[category] ?? [];
          const label = t.priorities.quadrants[category];
          return (
            <div key={key} className="rounded-2xl border border-[var(--line)] bg-[var(--raise)] p-2.5 min-h-[160px]"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleDrop(category); }}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{label.title}</div>
                  <div className="faint" style={{ fontSize: 11.5 }}>{label.subtitle}</div>
                </div>
                <span className="num faint" style={{ fontSize: 12 }}>{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--line)] px-2.5 py-3 text-center faint" style={{ fontSize: 12 }}>{t.priorities.emptyQuadrant}</div>
                ) : items.map((item) => (
                  <div key={item.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveWithinCategory(category, draggedId ?? item.id, item.id); }}>
                    <PriorityCard item={item} date={date} locale={locale} t={t} onToggle={(id) => actions.setPriorityDone(id, !doneOn(item, date), date)} onDelete={(id) => actions.deletePriority(id)} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 mt-3">
        <input className="input" value={draft} placeholder={t.priorities.placeholder} aria-label={t.priorities.add} maxLength={200} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn" style={{ flex: "none" }} disabled={!draft.trim()} onClick={add}>{t.priorities.add}</button>
      </div>

      {total === 0 && (
        <p className="muted mt-3" style={{ fontSize: 14, lineHeight: 1.5 }}>{t.priorities.empty}</p>
      )}
    </section>
  );
}
