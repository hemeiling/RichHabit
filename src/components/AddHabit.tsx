"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import HabitEditor from "@/components/HabitEditor";
import TemplateLibrary, { startBrowse, type Browse } from "@/components/TemplateLibrary";
import TemplateReview, { type Pick, type ReviewResult } from "@/components/TemplateReview";
import { Segmented, Sheet } from "@/components/ui";
import { useT } from "@/lib/i18n/context";
import type { AddOutcome } from "@/lib/addHabits";
import { blankHabit, scheduleProblem } from "@/lib/habits";
import { habitFromLibrary } from "@/lib/library";
import type { LibraryEntry, LibraryHabit } from "@/lib/library";
import { habitName } from "@/lib/templates";
import type { Category, Goal, Habit, HabitStatus } from "@/lib/types";

/**
 * Adding a habit from Today (§10/§12).
 *
 * Two ways in, because they are two different situations. Someone who does not
 * know what to track wants suggestions — Explore templates; someone who does
 * wants a blank form and no browsing. Both end at habits saved by the same
 * server endpoint, with its validation, ownership check and plan limit.
 *
 * Templates are chosen with a tick, from as many collections as the person
 * likes, then reviewed — renamed, rescheduled, re-prioritised — and only then
 * saved: to Today, or to the backlog. Nothing is added by browsing, and no
 * collection is ever added whole.
 */
export default function AddHabit({ section, habits, goals, onSave, onAddMany, onClose }: {
  section: Category;
  /** Everything the account has, for the duplicate check and the sort order. */
  habits: Habit[];
  goals: Goal[];
  onSave: (h: Habit) => void;
  onAddMany: (list: Habit[]) => Promise<AddOutcome>;
  onClose: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"library" | "own">("library");
  const [reviewing, setReviewing] = useState(false);
  const [browse, setBrowse] = useState<Browse>(startBrowse);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [own, setOwn] = useState<Habit | null>(null);
  const [duplicate, setDuplicate] = useState<LibraryEntry | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  // A new view starts at its top; the sheet is the scroll container.
  useEffect(() => {
    top.current?.closest(".sheet")?.scrollTo({ top: 0 });
  }, [reviewing, browse.open]);

  /**
   * What counts as "already have it": the same template, or the same words. A
   * user who typed "Read" themselves and then browses to the library entry
   * should still be warned. Retired habits are offered back on purpose.
   */
  const owned = useMemo(() => {
    const byKey = new Map<string, HabitStatus>();
    const byName = new Map<string, HabitStatus>();
    for (const h of habits) {
      if (h.status === "retired") continue;
      if (h.templateKey) byKey.set(h.templateKey, h.status);
      byName.set(habitName(h, t).trim().toLowerCase(), h.status);
    }
    return { byKey, byName };
  }, [habits, t]);
  const ownedStatus = (item: LibraryHabit): HabitStatus | null =>
    owned.byKey.get(item.key)
    ?? owned.byName.get((t.templates.habits[item.key] ?? "").trim().toLowerCase())
    ?? null;

  const isPicked = (key: string) => picks.some((p) => p.entry.item.key === key);

  /*
   * The draft — and with it the habit's id — is made once, when it is picked.
   * Every save and every retry sends that same id, so a retry updates the row
   * a lost reply already created instead of adding a second one.
   */
  const pick = (entries: LibraryEntry[]) => setPicks((ps) => [
    ...ps,
    ...entries.filter((e) => !ps.some((p) => p.entry.item.key === e.item.key)).map((e) => ({
      entry: e,
      // The everyday shelf lands in the tapped section; a collection habit keeps its own time of day.
      draft: habitFromLibrary(e.item, { category: e.collection ? e.category : section }),
    })),
  ]);
  const unpick = (keys: string[]) => setPicks((ps) => ps.filter((p) => !keys.includes(p.entry.item.key)));

  const toggle = (e: LibraryEntry) => {
    if (isPicked(e.item.key)) return unpick([e.item.key]);
    if (ownedStatus(e.item)) return setDuplicate(e);   // asked first, never silently doubled
    pick([e]);
  };

  /** Saves what is left in the review, in order, to Today ("active") or the backlog ("planned"). */
  const save = async (status: "active" | "planned") => {
    if (busy || !picks.length) return;
    setBusy(true);
    setResult(null);
    const next = new Map<Category, number>();
    const list = picks.map((p) => {
      const c = p.draft.category;
      const order = next.get(c)
        ?? Math.max(0, ...habits.filter((h) => h.category === c).map((h) => h.sortOrder)) + 1;
      next.set(c, order + 1);
      return { ...p.draft, status, active: status === "active", sortOrder: order };
    });
    const outcome = await onAddMany(list);
    const saved = new Set(outcome.added.map((h) => h.id));
    setPicks((ps) => ps.filter((p) => !saved.has(p.draft.id)));
    setBusy(false);
    // Everything on Today: the sheet's work is done, and the habits are already showing.
    if (status === "active" && !outcome.limited.length && !outcome.failed.length) return onClose();
    setResult({ ...outcome, status });
  };

  const valid = picks.every((p) => p.draft.name.trim() && !scheduleProblem(p.draft.frequency));

  if (own) {
    return (
      <HabitEditor
        habit={own} goals={goals} isNew
        onSave={(h) => { onSave(h); onClose(); }}
        onDelete={onClose}
        onClose={() => setOwn(null)}
      />
    );
  }

  if (editing != null && picks[editing]) {
    return (
      <HabitEditor
        habit={picks[editing].draft} goals={goals} isNew submitLabel={t.customise.doneEditing}
        onSave={(h) => {
          setPicks((ps) => ps.map((p, i) => (i === editing ? { ...p, draft: h } : p)));
          setEditing(null);
        }}
        onDelete={() => setEditing(null)}
        onClose={() => setEditing(null)}
      />
    );
  }

  const footer = reviewing ? (
    picks.length > 0 ? (
      <>
        <button className="btn" disabled={busy || !valid} onClick={() => save("planned")}>
          {busy ? t.customise.saving : t.customise.saveToBacklog(picks.length)}
        </button>
        <button className="btn btn-primary" disabled={busy || !valid} onClick={() => save("active")}>
          {busy ? t.customise.saving : t.customise.addToToday(picks.length)}
        </button>
      </>
    ) : (
      <button className="btn btn-primary" onClick={onClose}>{t.customise.doneEditing}</button>
    )
  ) : tab === "library" && picks.length > 0 ? (
    <>
      <span className="faint mr-auto self-center" style={{ fontSize: 13 }} aria-live="polite">
        {t.customise.selectedCount(picks.length)}
      </span>
      <button className="btn" onClick={() => setPicks([])}>{t.customise.clearSelected}</button>
      <button className="btn btn-primary" onClick={() => { setResult(null); setReviewing(true); }}>
        {t.customise.reviewSelected(picks.length)}
      </button>
    </>
  ) : undefined;

  return (
    <>
      <Sheet open onClose={onClose} footer={footer}
        title={reviewing && picks.length ? t.customise.reviewTitle(picks.length) : t.customise.addTo(t.categories[section].label)}>
        <div ref={top}>
          {reviewing ? (
            <TemplateReview
              picks={picks} result={result}
              onChange={(i, d) => setPicks((ps) => ps.map((p, j) => (j === i ? { ...p, draft: d } : p)))}
              onRemove={(i) => setPicks((ps) => ps.filter((_, j) => j !== i))}
              onAllOptions={setEditing}
              onBack={() => { setResult(null); setReviewing(false); }}
              onSaveRest={save}
            />
          ) : (
            <>
              <Segmented<"library" | "own"> value={tab} onChange={setTab}
                options={[
                  { value: "library", label: t.customise.fromLibrary },
                  { value: "own", label: t.customise.createOwn },
                ]} />
              {tab === "own" ? (
                <div className="mt-4">
                  <p className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
                    {t.habits.descriptionHint}
                  </p>
                  <button className="btn btn-primary mt-3"
                    onClick={() => setOwn({
                      ...blankHabit(), category: section,
                      sortOrder: Math.max(0, ...habits.filter((h) => h.category === section).map((h) => h.sortOrder)) + 1,
                    })}>
                    {t.customise.createOwn}
                  </button>
                </div>
              ) : (
                <TemplateLibrary
                  section={section} browse={browse} setBrowse={setBrowse}
                  ownedStatus={ownedStatus} isPicked={isPicked}
                  onToggle={toggle} onPickMany={pick} onUnpickMany={unpick}
                />
              )}
            </>
          )}
        </div>
      </Sheet>

      {/* Warned, not blocked: two rows for the same thing is usually a mistake,
          but it is the user's sheet. */}
      {duplicate && (
        <Sheet
          open onClose={() => setDuplicate(null)} title={t.customise.duplicateTitle}
          footer={
            <>
              <button className="btn" onClick={() => setDuplicate(null)}>{t.common.cancel}</button>
              <button className="btn btn-primary" onClick={() => {
                const e = duplicate;
                setDuplicate(null);
                pick([e]);           // still through the review, like any other choice
              }}>{t.customise.addAnyway}</button>
            </>
          }
        >
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>
            {t.customise.duplicateBody(t.templates.habits[duplicate.item.key] ?? duplicate.item.key)}
          </p>
        </Sheet>
      )}
    </>
  );
}
