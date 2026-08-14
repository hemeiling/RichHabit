"use client";
import { useState } from "react";
import { useHabits } from "@/components/store";
import { requestRecommendations } from "@/lib/db";
import { Empty, Field, Segmented } from "@/components/ui";
import { useT } from "@/lib/i18n/context";
import { blankHabit } from "@/lib/habits";
import { LIBRARY, type LibraryHabit } from "@/lib/library";
import { canonical, habitName } from "@/lib/templates";
import type { Dict } from "@/lib/i18n";
import type { Category, Habit, HabitKind } from "@/lib/types";

/**
 * The personalised habit selection workspace (reference §12).
 *
 * Four groups, kept apart because they mean different things (CLAUDE.md §8):
 *
 *   1. **Behaviours I want to change** — the user's own words, untracked.
 *   2. **Recommended** — the coach's proposals, awaiting a decision.
 *   3. **From the library** — templates they picked out but have not started.
 *   4. **My focus habits** — the manageable set they actually track.
 *
 * Movement between them is always the user's doing. Nothing here activates
 * itself, and §13's pacing advice is advice: it says the set is large, and
 * leaves the decision alone.
 */

/** §13. Above this, the workspace mentions pacing. It never enforces it. */
const CROWDED = 9;

function Group({
  title, note, count, children,
}: { title: string; note: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="eyebrow">{title}</div>
        {count != null && <span className="faint num" style={{ fontSize: 12 }}>{count}</span>}
      </div>
      <p className="faint mt-1" style={{ fontSize: 12, lineHeight: 1.45 }}>{note}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function BacklogRow({
  habit, t, behaviourFor, onActivate, onRemove,
}: {
  habit: Habit; t: Dict;
  behaviourFor: (id: string | null) => string | null;
  onActivate: (h: Habit) => void; onRemove: (id: string) => void;
}) {
  const replaces = behaviourFor(habit.replacesHabitId);
  return (
    <div className="py-3.5">
      <div style={{ fontSize: 15, lineHeight: 1.4 }}>
        {habit.type === "avoid" && (
          <span className="faint" style={{ fontWeight: 400 }}>{t.today.avoid} · </span>
        )}
        {habitName(habit, t)}
      </div>

      {/* §10. What it replaces is shown, not discarded — the pair is what makes
          a suggestion legible. */}
      {replaces && (
        <div className="faint mt-1" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
          {t.refine.replacesLabel(replaces)}
        </div>
      )}
      {habit.rationale && (
        <div className="flat p-3 mt-2" style={{ fontSize: 13, lineHeight: 1.5 }}>
          <span className="eyebrow" style={{ fontSize: 10 }}>{t.refine.whySuggested}</span>
          <p className="mt-1">{habit.rationale}</p>
        </div>
      )}

      <div className="faint flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5" style={{ fontSize: 12 }}>
        <span>{t.categories[habit.category].label}</span>
        <span>{[t.priority.low, t.priority.medium, t.priority.high][habit.weight - 1]}</span>
        {habit.target != null && (
          <span className="num">{habit.target} {habit.unit}</span>
        )}
        <button className="btn btn-quiet" style={{ padding: "2px 9px", fontSize: 12 }}
          onClick={() => onActivate(habit)}>{t.refine.activate}</button>
        <button className="btn btn-quiet" style={{ padding: "2px 9px", fontSize: 12 }}
          onClick={() => onRemove(habit.id)}>{t.refine.remove}</button>
      </div>
    </div>
  );
}

export default function Refine() {
  const { state, actions, reload } = useHabits();
  const t = useT();

  const [text, setText] = useState("");
  const [kind, setKind] = useState<HabitKind>("avoid");
  const [weight, setWeight] = useState<1 | 2 | 3>(2);
  const [category, setCategory] = useState<Category>("daytime");

  const [suggesting, setSuggesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState<Category>("morning");

  const candidates = state.habits.filter((h) => h.status === "candidate");
  const recommended = state.habits.filter((h) => h.status === "recommended");
  const planned = state.habits.filter((h) => h.status === "planned");
  const focus = state.habits.filter((h) => h.status === "active");

  const add = () => {
    const name = text.trim();
    if (!name) return;
    actions.saveHabit({
      ...blankHabit(),
      name,
      templateKey: null,   // their words, never translated
      type: kind,
      category,
      weight,
      status: "candidate",
      active: false,
    });
    setText("");
  };

  const activate = (h: Habit) =>
    actions.saveHabit({ ...h, status: "active", active: true });

  const pause = (h: Habit) =>
    actions.saveHabit({ ...h, status: "paused", active: false });

  /**
   * Adopting a library habit copies the template into the user's own row.
   * It lands as `planned`: chosen, but not yet something they are tracking.
   */
  const addFromLibrary = (item: LibraryHabit) => {
    actions.saveHabit({
      ...blankHabit(),
      // The English wording, not the key: `name` is the readable fallback, and
      // the validator keeps a template key only while the name still matches
      // the template in some language.
      name: canonical("habits", item.key),
      templateKey: item.key,
      category: item.category,
      type: item.kind,
      weight: item.weight,
      target: item.target,
      unit: item.unit ?? "",
      status: "planned",
      active: false,
    });
  };

  const suggest = async () => {
    setSuggesting(true);
    setNotice(null);
    try {
      const { proposals, reason } = await requestRecommendations();
      await reload();
      setNotice(reason === "nothing_to_propose" || proposals === 0
        ? t.refine.suggestNone
        : t.refine.suggested(proposals));
    } catch {
      // A failed suggestion must leave the backlog exactly as it was.
      setNotice(t.refine.suggestFailed);
    } finally {
      setSuggesting(false);
    }
  };

  const behaviourFor = (id: string | null) => {
    const source = id ? state.habits.find((h) => h.id === id) : null;
    return source ? habitName(source, t) : null;
  };

  /** A template already taken is not offered again. */
  const taken = new Map(state.habits.filter((h) => h.templateKey)
    .map((h) => [h.templateKey!, h.status]));

  const shownLibrary = LIBRARY.filter((h) => h.category === libraryFilter);
  const unit = (u: string | null) => (u ? t.templates.units[u] ?? u : "");

  return (
    <div className="flex flex-col gap-4">
      {/* ── capture ─────────────────────────────────────────────────────── */}
      <section className="card p-5">
        <div className="eyebrow">{t.refine.stepBehaviours}</div>
        <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.5 }}>{t.refine.intro}</p>

        <div className="mt-4">
          <textarea
            className="textarea" rows={2} value={text}
            placeholder={t.refine.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); }
            }}
          />
          <div className="faint mt-1" style={{ fontSize: 12 }}>{t.refine.capturedAs}</div>
        </div>

        <div className="mt-3">
          <Field label={t.refine.kindLabel}>
            <Segmented<HabitKind> value={kind} onChange={setKind} small
              options={[
                { value: "avoid", label: t.refine.kindAvoid },
                { value: "good", label: t.refine.kindGood },
              ]} />
          </Field>
          <Field label={t.habits.fieldTimeOfDay}>
            <Segmented<Category> value={category} onChange={setCategory} small
              options={(["morning", "daytime", "nighttime"] as Category[])
                .map((c) => ({ value: c, label: t.categories[c].label }))} />
          </Field>
          <Field label={t.refine.importance}>
            <Segmented<1 | 2 | 3> value={weight} onChange={setWeight} small
              options={[
                { value: 1, label: t.priority.low },
                { value: 2, label: t.priority.medium },
                { value: 3, label: t.priority.high },
              ]} />
          </Field>
        </div>

        <div className="flex justify-end">
          <button className="btn btn-primary" disabled={!text.trim()} onClick={add}>
            {t.refine.add}
          </button>
        </div>
      </section>

      {/* ── 1. behaviours ───────────────────────────────────────────────── */}
      <Group title={t.refine.groupBehaviours} note={t.refine.groupBehavioursNote}
        count={candidates.length}>
        {candidates.length === 0 ? (
          <p className="muted" style={{ fontSize: 14 }}>{t.refine.groupEmpty}</p>
        ) : (
          <div className="divide">
            {candidates.map((h) => (
              <BacklogRow key={h.id} habit={h} t={t} behaviourFor={behaviourFor}
                onActivate={activate} onRemove={actions.deleteHabit} />
            ))}
          </div>
        )}

        <div className="flat p-3.5 mt-3">
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>{t.refine.suggestNote}</p>
          <div className="flex items-center justify-between gap-3 mt-2.5">
            <span className="faint" style={{ fontSize: 12, lineHeight: 1.4 }}>{notice}</span>
            <button className="btn" style={{ flex: "none" }}
              disabled={suggesting || candidates.length === 0} onClick={suggest}>
              {suggesting ? t.refine.suggesting : t.refine.suggest}
            </button>
          </div>
        </div>
      </Group>

      {/* ── 2. recommendations ──────────────────────────────────────────── */}
      <Group title={t.refine.groupRecommended} note={t.refine.groupRecommendedNote}
        count={recommended.length}>
        {recommended.length === 0 ? (
          <p className="muted" style={{ fontSize: 14 }}>{t.refine.groupEmpty}</p>
        ) : (
          <div className="divide">
            {recommended.map((h) => (
              <BacklogRow key={h.id} habit={h} t={t} behaviourFor={behaviourFor}
                onActivate={activate} onRemove={actions.deleteHabit} />
            ))}
          </div>
        )}
      </Group>

      {/* ── 3. library picks ────────────────────────────────────────────── */}
      <Group title={t.refine.groupLibrary} note={t.refine.groupLibraryNote} count={planned.length}>
        {planned.length === 0 ? (
          <p className="muted" style={{ fontSize: 14 }}>{t.refine.groupEmpty}</p>
        ) : (
          <div className="divide">
            {planned.map((h) => (
              <BacklogRow key={h.id} habit={h} t={t} behaviourFor={behaviourFor}
                onActivate={activate} onRemove={actions.deleteHabit} />
            ))}
          </div>
        )}

        <div className="mt-3">
          <button className="btn" onClick={() => setBrowsing((b) => !b)}>
            {browsing ? t.refine.libraryHide : t.refine.libraryBrowse}
          </button>
        </div>

        {browsing && (
          <div className="mt-3">
            <p className="faint" style={{ fontSize: 12, lineHeight: 1.45 }}>{t.refine.libraryNote}</p>
            <div className="mt-2.5">
              <Segmented<Category> value={libraryFilter} onChange={setLibraryFilter} small
                options={(["morning", "daytime", "nighttime"] as Category[])
                  .map((c) => ({ value: c, label: t.categories[c].label }))} />
            </div>
            <div className="divide mt-1">
              {shownLibrary.map((item) => {
                const status = taken.get(item.key);
                const onSheet = status === "active";
                const inBacklog = status != null && !onSheet;
                return (
                  <div key={item.key} className="flex items-start justify-between gap-3 py-3">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, lineHeight: 1.35 }}>
                        {t.templates.habits[item.key] ?? item.key}
                      </div>
                      <div className="faint flex flex-wrap gap-x-2.5 mt-0.5" style={{ fontSize: 11.5 }}>
                        <span>{t.refine.domains[item.lifeDomain] ?? item.lifeDomain}</span>
                        {/* §20. The minimum is what still counts on a bad day. */}
                        {item.minimum != null && item.target != null ? (
                          <span className="num">
                            {t.refine.libraryMinTarget(
                              `${item.minimum} ${unit(item.unit)}`.trim(),
                              `${item.target} ${unit(item.unit)}`.trim())}
                          </span>
                        ) : item.target != null ? (
                          <span className="num">
                            {t.refine.libraryTargetOnly(`${item.target} ${unit(item.unit)}`.trim())}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ flex: "none" }}>
                      {onSheet ? (
                        <span className="faint" style={{ fontSize: 11.5 }}>{t.refine.libraryOnSheet}</span>
                      ) : inBacklog ? (
                        <span className="faint" style={{ fontSize: 11.5 }}>{t.refine.libraryAdded}</span>
                      ) : (
                        <button className="btn btn-quiet" style={{ padding: "3px 10px", fontSize: 12.5 }}
                          onClick={() => addFromLibrary(item)}>{t.refine.libraryAdd}</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Group>

      {/* ── 4. focus ────────────────────────────────────────────────────── */}
      <Group title={t.refine.groupFocus} note={t.refine.groupFocusNote} count={focus.length}>
        {focus.length === 0 ? (
          <Empty title={t.refine.emptyTitle} body={t.refine.emptyBody} />
        ) : (
          <div className="divide">
            {focus.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3 py-3">
                <span style={{ fontSize: 14.5, lineHeight: 1.35 }}>{habitName(h, t)}</span>
                <button className="btn btn-quiet" style={{ padding: "2px 9px", fontSize: 12, flex: "none" }}
                  onClick={() => pause(h)}>{t.habits.statusPaused}</button>
              </div>
            ))}
          </div>
        )}

        {/* §13. Pacing is advice. It says the set is large and then leaves it alone. */}
        {focus.length > CROWDED && (
          <div className="flat p-3.5 mt-3">
            <div className="eyebrow" style={{ fontSize: 10 }}>{t.refine.tooManyTitle}</div>
            <p className="mt-1" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
              {t.refine.tooMany(focus.length)}
            </p>
          </div>
        )}
      </Group>
    </div>
  );
}
