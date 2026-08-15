"use client";
import { useMemo, useState } from "react";
import HabitEditor from "@/components/HabitEditor";
import { Field, Segmented, Sheet } from "@/components/ui";
import { useT } from "@/lib/i18n/context";
import { blankHabit } from "@/lib/habits";
import { LIBRARY } from "@/lib/library";
import { canonical, habitName } from "@/lib/templates";
import type { LibraryHabit } from "@/lib/library";
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

/** A library entry, as a habit this account owns. */
function fromLibrary(item: LibraryHabit, category: Category, sortOrder: number): Habit {
  return {
    ...blankHabit(),
    // Keyed, not copied as text: it follows the reader's language until renamed.
    name: canonical("habits", item.key),
    templateKey: item.key,
    category,
    type: item.kind,
    tracking: item.tracking,
    minimum: item.minimum,
    target: item.target,
    unit: item.unit ?? "",
    weight: item.weight,
    frequency: {
      mode: item.frequency,
      days: [0, 1, 2, 3, 4, 5, 6],
      timesPerWeek: item.frequency === "times" ? 3 : 3,
    },
    sortOrder,
  };
}

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
  const shown = LIBRARY.filter((item) =>
    (everywhere || item.category === section) && matches(item, needle, t));

  const add = (item: LibraryHabit) => {
    if (has(item)) {
      setDuplicate({ item, name: t.templates.habits[item.key] ?? item.key });
      return;
    }
    onSave(fromLibrary(item, section, nextSortOrder));
    onClose();
  };

  if (own) {
    return (
      <HabitEditor
        habit={own} goals={goals}
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
            <Segmented<boolean> value={everywhere} onChange={setEverywhere} small
              options={[
                { value: false, label: t.customise.showSection(t.categories[section].label) },
                { value: true, label: t.customise.showAll },
              ]} />

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
                      <span className="faint block mt-0.5" style={{ fontSize: 12 }}>
                        {t.categories[item.category].label}
                        {taken && ` · ${t.customise.alreadyOnSheet}`}
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
                onSave(fromLibrary(duplicate.item, section, nextSortOrder));
                onClose();
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
