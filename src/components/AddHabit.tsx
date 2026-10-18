"use client";
import { useMemo, useState } from "react";
import HabitEditor from "@/components/HabitEditor";
import { Field, Segmented, Sheet } from "@/components/ui";
import { useT } from "@/lib/i18n/context";
import { blankHabit } from "@/lib/habits";
import { LIBRARY, habitFromLibrary } from "@/lib/library";
import { habitDescription, habitName, habitSource } from "@/lib/templates";
import type { CollectionKey, LibraryHabit } from "@/lib/library";
import type { Category, Goal, Habit } from "@/lib/types";
import type { Dict } from "@/lib/i18n/en";

/**
 * Adding a habit from Today (§10/§12).
 *
 * Two ways in, because they are two different situations. Someone who does not
 * know what to track wants suggestions; someone who does wants a blank form and
 * no browsing. Both end at the same `Habit`, saved by the same action.
 *
 * The library tab opens filtered to the section that was tapped — the point of
 * "+ Add habit" under Morning is a morning habit — but the filter can be
 * dropped, because a habit's time of day is the user's decision and not the
 * catalogue's.
 */

/** Matching is on the displayed name, so searching works in either language. */
function matches(item: LibraryHabit, needle: string, t: Dict): boolean {
  if (!needle) return true;
  return (t.templates.habits[item.key] ?? item.key).toLowerCase().includes(needle);
}

/*
 * Building the habit itself lives in lib/library (`habitFromLibrary`), shared
 * with Refine — one definition of what adopting a template means, carrying
 * the template's own frequency rather than a hard-coded one.
 */

export default function AddHabit({
  section, habits, goals, nextSortOrder, onSave, onClose,
}: {
  section: Category;
  /** Everything the account has, for the duplicate check. */
  habits: Habit[];
  goals: Goal[];
  nextSortOrder: number;
  onSave: (h: Habit) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"library" | "own">("library");
  const [search, setSearch] = useState("");
  const [everywhere, setEverywhere] = useState(false);
  const [shelf, setShelf] = useState<"all" | CollectionKey>("all");
  const [own, setOwn] = useState<Habit | null>(null);
  const [duplicate, setDuplicate] = useState<{ item: LibraryHabit; name: string } | null>(null);

  /**
   * What counts as "already have it": the same template, or the same words. A
   * user who typed "Read" themselves and then browses to the library entry
   * should still be warned.
   */
  const onSheet = useMemo(() => {
    const keys = new Set<string>();
    const names = new Set<string>();
    habits.forEach((h) => {
      if (h.status === "retired") return;   // removed on purpose; offering it back is the point
      if (h.templateKey) keys.add(h.templateKey);
      names.add(habitName(h, t).trim().toLowerCase());
    });
    return { keys, names };
  }, [habits, t]);

  const has = (item: LibraryHabit) =>
    onSheet.keys.has(item.key)
    || onSheet.names.has((t.templates.habits[item.key] ?? "").trim().toLowerCase());

  const needle = search.trim().toLowerCase();
  /*
   * The everyday shelf keeps the section filter — "+ Add habit" under Morning
   * means a morning habit. A named collection spans the whole day by design
   * (Franklin's questions bracket it), so choosing one shows all of it.
   */
  const shown = LIBRARY.filter((item) =>
    (shelf === "all"
      ? !item.collection && (everywhere || item.category === section)
      : item.collection === shelf)
    && matches(item, needle, t));

  /**
   * §10: picking an item opens the pre-filled form — nothing is added
   * silently, and everything (time of day, target, schedule) can be adjusted
   * before it joins the sheet. The everyday shelf lands in the tapped
   * section; a collection item keeps its own time of day.
   */
  const review = (item: LibraryHabit) =>
    setOwn(habitFromLibrary(item, {
      category: item.collection ? item.category : section,
      sortOrder: nextSortOrder,
    }));

  const add = (item: LibraryHabit) => {
    if (has(item)) {
      setDuplicate({ item, name: t.templates.habits[item.key] ?? item.key });
      return;
    }
    review(item);
  };

  /** The whole shelf into the backlog as Planned — only what is not already theirs. */
  const addCollection = (items: LibraryHabit[]) => {
    items.forEach((item, i) =>
      onSave(habitFromLibrary(item, { status: "planned", sortOrder: nextSortOrder + i })));
    onClose();
  };

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

  return (
    <>
      <Sheet open onClose={onClose} title={t.customise.addTo(t.categories[section].label)}>
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
              onClick={() => setOwn({ ...blankHabit(), category: section, sortOrder: nextSortOrder })}>
              {t.customise.createOwn}
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <Field label={t.customise.searchPlaceholder}>
              <input className="input" autoFocus value={search} placeholder={t.customise.searchPlaceholder}
                onChange={(e) => setSearch(e.target.value)} />
            </Field>
            {/* The shelves: the everyday set, and the named collections. */}
            <Segmented<"all" | CollectionKey> value={shelf} onChange={setShelf} small
              options={(["all", "franklin", "history"] as const).map((s) => ({
                value: s, label: t.customise.shelves[s],
              }))} />
            {shelf === "all" ? (
              <Segmented<boolean> value={everywhere} onChange={setEverywhere} small
                options={[
                  { value: false, label: t.customise.showSection(t.categories[section].label) },
                  { value: true, label: t.customise.showAll },
                ]} />
            ) : (
              <div className="mt-3">
                {(() => {
                  const fresh = shown.filter((i) => !has(i));
                  return fresh.length ? (
                    <>
                      <button className="btn" style={{ fontSize: 13 }} onClick={() => addCollection(fresh)}>
                        + {t.customise.addCollection(fresh.length)}
                      </button>
                      <p className="faint mt-1.5" style={{ fontSize: 12, lineHeight: 1.45 }}>
                        {t.customise.collectionHint}
                      </p>
                    </>
                  ) : (
                    <p className="faint" style={{ fontSize: 12.5 }}>{t.customise.collectionAllTaken}</p>
                  );
                })()}
              </div>
            )}

            <div className="divide mt-3">
              {shown.length === 0 && (
                <p className="muted py-4" style={{ fontSize: 14 }}>{t.customise.noMatches}</p>
              )}
              {shown.map((item) => {
                const taken = has(item);
                return (
                  <button key={item.key} className="w-full text-left py-3 flex items-center gap-3"
                    style={{ background: "none", border: "none", cursor: "pointer" }}
                    onClick={() => add(item)}>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="block" style={{ fontSize: 15 }}>
                        {/* §10. The catalogue carries habits to drop as well as
                            habits to build; hiding those would leave half the
                            work with no entry point. */}
                        {item.kind === "avoid" && (
                          <span className="faint">{t.customise.avoid} · </span>
                        )}
                        {t.templates.habits[item.key] ?? item.key}
                      </span>
                      {/* A collection item explains itself and names its source. */}
                      {item.collection && t.templates.descriptions[item.key] && (
                        <span className="muted block mt-0.5" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                          {t.templates.descriptions[item.key]}
                        </span>
                      )}
                      <span className="faint block mt-0.5" style={{ fontSize: 12 }}>
                        {t.categories[item.category].label}
                        {taken && ` · ${t.customise.alreadyOnSheet}`}
                        {item.source && habitSource(item.key, t)
                          && ` · ${t.customise.sourcePrefix}${habitSource(item.key, t)}`}
                      </span>
                    </span>
                    <span className="faint" style={{ fontSize: 17, flex: "none" }}>
                      {taken ? "✓" : "+"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
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
                const item = duplicate.item;
                setDuplicate(null);
                review(item);           // still through the form, like any other add
              }}>{t.customise.addAnyway}</button>
            </>
          }
        >
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>
            {t.customise.duplicateBody(duplicate.name)}
          </p>
        </Sheet>
      )}
    </>
  );
}
