"use client";
import Link from "next/link";
import { useState } from "react";
import { useHabits } from "@/components/store";
import { Segmented, Sheet } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { recordSuggestionEvent, suggestForIntention } from "@/lib/db";
import { CATEGORIES, blankHabit } from "@/lib/habits";
import { shortDateFor } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/context";
import {
  LIST_PREVIEW, linkHabits, linkPriorities, linkedHabits, linkedPriorities, plannedDates,
  unlinkHabit, unlinkPriority,
} from "@/lib/intention";
import { isPlanOverdue, quadrantFor } from "@/lib/priorities";
import { habitName } from "@/lib/templates";
import type { Category, Habit, Intention, Priority, SuggestionKind } from "@/lib/types";

/**
 * The records an intention points to: habits and priorities.
 *
 * Every one is an ordinary RichHabit record. Adding one uses the same actions
 * the habit sheet and Priority Compass use; linking an existing one records its
 * id and copies nothing; removing a link never deletes the record. There is no
 * limit on how many — the cards show five and "Show all" reveals the rest.
 *
 * Suggestions are drafts. Claude proposes them; the person edits, adds or
 * dismisses each one, and nothing becomes a record until they press Add. For a
 * priority the person still answers Important? and Urgent? themselves.
 */

type Change = (next: Intention) => void;

const HIDDEN_HABIT_STATUSES = new Set(["candidate", "recommended", "retired"]);

function Check({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.5 10.5l3.6 3.6L15.5 6.8" stroke="var(--accent-ink)" strokeWidth="2.8"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ───────────────────────────── small pieces ───────────────────────────── */

function Actions({ adding, suggesting, onAdd, onLink, onSuggest }: {
  adding: boolean; suggesting: boolean; onAdd: () => void; onLink: () => void; onSuggest: () => void;
}) {
  const t = useT();
  return (
    <div className="ilist-actions">
      <button type="button" className="ilink" aria-expanded={adding} onClick={onAdd}>
        <span aria-hidden="true">+</span>{t.intention.links.add}
      </button>
      <button type="button" className="ilink" onClick={onLink}>{t.intention.links.linkExisting}</button>
      <button type="button" className="ilink" data-ai="true" disabled={suggesting} onClick={onSuggest}>
        <span aria-hidden="true">✨</span>{t.intention.links.suggest}
      </button>
    </div>
  );
}

function RowOptions({ name, open, onToggle }: { name: string; open: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <button type="button" className="ilist-opt" aria-expanded={open}
      aria-label={t.intention.links.options(name)} onClick={onToggle}>
      <span aria-hidden="true">⋯</span>
    </button>
  );
}

function RemoveLink({ onRemove }: { onRemove: () => void }) {
  const t = useT();
  return (
    <div className="ilist-menu fade-in">
      <button type="button" className="pcard-edit-btn" onClick={onRemove}>{t.intention.links.remove}</button>
      <span className="faint">{t.intention.links.removeNote}</span>
    </div>
  );
}

function ShowAll({ total, all, onToggle }: { total: number; all: boolean; onToggle: () => void }) {
  const t = useT();
  if (total <= LIST_PREVIEW) return null;
  return (
    <button type="button" className="intent-more" aria-expanded={all} onClick={onToggle}>
      {all ? t.intention.links.showFewer : t.intention.links.showAll(total)}
      <span aria-hidden="true">{all ? "↑" : "↓"}</span>
    </button>
  );
}

/** The two questions every priority is asked. Never answered on the person's behalf. */
function Classify({ important, urgent, onChange }: {
  important: boolean | null; urgent: boolean | null;
  onChange: (next: { important?: boolean; urgent?: boolean }) => void;
}) {
  const t = useT();
  return (
    <div className="pask">
      <span className="pask-q">
        <span className="faint">{t.intention.action.askImportant}</span>
        <button type="button" className="chip" data-on={important === true}
          onClick={() => onChange({ important: true })}>{t.priorities.yes}</button>
        <button type="button" className="chip" data-on={important === false}
          onClick={() => onChange({ important: false })}>{t.priorities.no}</button>
      </span>
      <span className="pask-q">
        <span className="faint">{t.intention.action.askUrgent}</span>
        <button type="button" className="chip" data-on={urgent === true}
          onClick={() => onChange({ urgent: true })}>{t.priorities.yes}</button>
        <button type="button" className="chip" data-on={urgent === false}
          onClick={() => onChange({ urgent: false })}>{t.priorities.no}</button>
      </span>
    </div>
  );
}

function HabitForm({ onAdd, onClose }: { onAdd: (name: string, when: Category) => void; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [when, setWhen] = useState<Category>("morning");
  const add = () => {
    const text = name.trim();
    if (!text) return;
    onAdd(text, when);
    setName("");
  };
  return (
    <div className="iform fade-in">
      <input className="input" autoFocus value={name} maxLength={200}
        placeholder={t.intention.action.habitPlaceholder} aria-label={t.intention.action.habitsTitle}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") onClose(); }} />
      <div className="iform-row">
        <span className="faint" style={{ fontSize: 12.5 }}>{t.intention.action.whenTitle}</span>
        <Segmented<Category> small value={when} onChange={setWhen}
          options={CATEGORIES.map((c) => ({ value: c.id, label: t.categories[c.id].label }))} />
      </div>
      <div className="iform-row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-quiet" onClick={onClose}>{t.intention.links.cancel}</button>
        <button type="button" className="btn" disabled={!name.trim()} onClick={add}>
          {t.intention.action.addHabit}
        </button>
      </div>
    </div>
  );
}

function PriorityForm({ onAdd, onClose }: {
  onAdd: (text: string, important: boolean, urgent: boolean) => void; onClose: () => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [important, setImportant] = useState<boolean | null>(null);
  const [urgent, setUrgent] = useState<boolean | null>(null);
  const ready = text.trim() !== "" && important !== null && urgent !== null;
  const add = () => {
    if (!ready) return;
    onAdd(text.trim(), important!, urgent!);
    setText(""); setImportant(null); setUrgent(null);
  };
  return (
    <div className="iform fade-in">
      <input className="input" autoFocus value={text} maxLength={200}
        placeholder={t.intention.action.priorityPlaceholder} aria-label={t.intention.action.priorityTitle}
        onChange={(e) => {
          setText(e.target.value);
          // A cleared line starts unclassified, as on the compass.
          if (!e.target.value.trim()) { setImportant(null); setUrgent(null); }
        }}
        onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") onClose(); }} />
      {text.trim() && (
        <Classify important={important} urgent={urgent}
          onChange={(next) => {
            if (next.important !== undefined) setImportant(next.important);
            if (next.urgent !== undefined) setUrgent(next.urgent);
          }} />
      )}
      <div className="iform-row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-quiet" onClick={onClose}>{t.intention.links.cancel}</button>
        <button type="button" className="btn" disabled={!ready} onClick={add}>
          {t.intention.action.addPriority}
        </button>
      </div>
    </div>
  );
}

/** Choosing records the person already has. Only ids are linked; nothing is copied. */
function LinkSheet({ title, items, onLink, onClose }: {
  title: string;
  items: { id: string; label: string; meta?: string }[];
  onLink: (ids: string[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? items.filter((i) => i.label.toLowerCase().includes(needle)) : items;
  const toggle = (id: string) =>
    setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));

  return (
    <Sheet open onClose={onClose} title={title}
      footer={(
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose}>{t.intention.links.cancel}</button>
          <button type="button" className="btn btn-primary" disabled={picked.length === 0}
            onClick={() => onLink(picked)}>
            {t.intention.links.linkCount(picked.length)}
          </button>
        </>
      )}>
      {items.length === 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>{t.intention.links.nothingToLink}</p>
      ) : (
        <>
          <input className="input" type="search" value={q} placeholder={t.intention.links.search}
            aria-label={t.intention.links.search} onChange={(e) => setQ(e.target.value)} />
          <div className="link-list" role="group" aria-label={title}>
            {shown.map((item) => {
              const on = picked.includes(item.id);
              return (
                <button key={item.id} type="button" role="checkbox" aria-checked={on}
                  className="link-row" onClick={() => toggle(item.id)}>
                  <span className="link-box" aria-hidden="true">{on && <Check />}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ overflowWrap: "anywhere" }}>{item.label}</span>
                    {item.meta && <span className="faint" style={{ display: "block", fontSize: 12 }}>{item.meta}</span>}
                  </span>
                </button>
              );
            })}
            {shown.length === 0 && (
              <p className="faint" style={{ fontSize: 13.5, padding: "10px 2px" }}>{t.intention.links.noMatch}</p>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ───────────────────────────── suggestions ───────────────────────────── */

interface Draft {
  key: string;
  text: string;
  /** What Claude proposed, to tell an accepted draft from an edited one. */
  original: string;
  category: Category | null;
  editing: boolean;
  classifying: boolean;
  important: boolean | null;
  urgent: boolean | null;
}

function useSuggestions(kind: SuggestionKind) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const request = async () => {
    setOpen(true); setLoading(true); setError(null); setEmpty(false);
    try {
      const { suggestions } = await suggestForIntention(kind, drafts.map((d) => d.text));
      const stamp = Date.now();
      const fresh = suggestions.map((s, at): Draft => ({
        key: `${stamp}-${at}`, text: s.text, original: s.text, category: s.category,
        editing: false, classifying: false, important: null, urgent: null,
      }));
      setDrafts((now) => [...now, ...fresh]);
      setEmpty(fresh.length === 0);
    } catch (e) {
      // A network failure has no server sentence to show; everything else does.
      setError(e instanceof TypeError ? t.intention.ai.failed : (e as Error).message || t.intention.ai.failed);
    } finally {
      setLoading(false);
    }
  };

  return {
    open, loading, error, empty, drafts, request,
    patch: (key: string, next: Partial<Draft>) =>
      setDrafts((now) => now.map((d) => (d.key === key ? { ...d, ...next } : d))),
    drop: (key: string) => setDrafts((now) => now.filter((d) => d.key !== key)),
    close: () => { setOpen(false); setDrafts([]); setError(null); setEmpty(false); },
  };
}

type Suggestions = ReturnType<typeof useSuggestions>;

function DraftCard({ kind, draft, s, onAdd }: {
  kind: SuggestionKind; draft: Draft; s: Suggestions; onAdd: (draft: Draft) => void;
}) {
  const t = useT();
  const text = draft.text.trim();
  const needsAnswers = kind === "priorities" && draft.classifying
    && (draft.important === null || draft.urgent === null);

  const add = () => {
    if (!text) return;
    // A priority is classified by the person before it exists.
    if (kind === "priorities" && !draft.classifying) {
      s.patch(draft.key, { classifying: true, editing: false });
      return;
    }
    onAdd({ ...draft, text });
    s.drop(draft.key);
  };

  return (
    <div className="ai-card">
      {draft.editing ? (
        <input className="input" autoFocus value={draft.text} maxLength={200}
          aria-label={t.intention.ai.field}
          onChange={(e) => s.patch(draft.key, { text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); s.patch(draft.key, { editing: false }); }
          }} />
      ) : (
        <p className="ai-card-text">{draft.text}</p>
      )}

      {kind === "habits" && draft.editing && (
        <div className="iform-row" style={{ marginTop: 8 }}>
          <Segmented<Category> small value={draft.category ?? "morning"}
            onChange={(category) => s.patch(draft.key, { category })}
            options={CATEGORIES.map((c) => ({ value: c.id, label: t.categories[c.id].label }))} />
        </div>
      )}
      {kind === "habits" && !draft.editing && draft.category && (
        <div className="ilist-meta">{t.categories[draft.category].label}</div>
      )}
      {kind === "priorities" && draft.classifying && (
        <Classify important={draft.important} urgent={draft.urgent}
          onChange={(next) => s.patch(draft.key, next)} />
      )}

      <div className="ai-card-actions">
        <button type="button" className="pcard-edit-btn"
          onClick={() => s.patch(draft.key, { editing: !draft.editing })}>
          {draft.editing ? t.intention.ai.doneEditing : t.intention.ai.edit}
        </button>
        <button type="button" className="pcard-edit-btn" data-primary
          disabled={!text || needsAnswers} onClick={add}>
          {kind === "habits" ? t.intention.ai.addHabit : t.intention.ai.addPriority}
        </button>
        <button type="button" className="ilist-opt" aria-label={t.intention.ai.dismiss(draft.text)}
          onClick={() => s.drop(draft.key)}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}

function SuggestionTray({ kind, s, onAdd }: { kind: SuggestionKind; s: Suggestions; onAdd: (draft: Draft) => void }) {
  const t = useT();
  if (!s.open) return null;
  return (
    <div className="ai-tray fade-in" role="region" aria-label={t.intention.ai.title}>
      <div className="ai-tray-head">
        <span className="icard-label"><span aria-hidden="true">✨ </span>{t.intention.ai.title}</span>
        <button type="button" className="ilist-opt" aria-label={t.intention.ai.close} onClick={s.close}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p className="ai-note">{t.intention.ai.disclosure}</p>
      <div className="ai-cards" aria-live="polite" aria-busy={s.loading}>
        {s.drafts.map((draft) => (
          <DraftCard key={draft.key} kind={kind} draft={draft} s={s} onAdd={onAdd} />
        ))}
        {s.loading && (
          <>
            <div className="ai-skel" />
            <div className="ai-skel" />
            <p className="faint" style={{ fontSize: 12.5 }}>{t.intention.ai.loading}</p>
          </>
        )}
      </div>
      {s.error && <p className="ai-error" role="alert">{s.error}</p>}
      {s.empty && !s.loading && !s.error && (
        <p className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>{t.intention.ai.none}</p>
      )}
      {!s.loading && (
        <button type="button" className="ilink" data-ai="true" onClick={s.request}>
          <span aria-hidden="true">✨</span>{t.intention.ai.more}
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────── the cards ─────────────────────────────── */

export function HabitsCard({ reflection, onChange, onOpenHabit }: {
  reflection: Intention; onChange: Change; onOpenHabit: (habit: Habit) => void;
}) {
  const { state, actions } = useHabits();
  const t = useT();
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const s = useSuggestions("habits");

  const linked = linkedHabits(reflection, state.habits);
  const shown = all ? linked : linked.slice(0, LIST_PREVIEW);
  const titleId = `${reflection.id}-habits`;

  /* An ordinary habit: `blankHabit()` and `saveHabit`, exactly as the habit sheet. */
  const create = (name: string, category: Category) => {
    const habit: Habit = {
      ...blankHabit(),
      name,
      category,
      sortOrder: Math.max(0, ...state.habits.filter((h) => h.category === category).map((h) => h.sortOrder)) + 1,
    };
    actions.saveHabit(habit);
    onChange(linkHabits(reflection, [habit.id]));
  };

  const candidates = state.habits
    .filter((h) => !reflection.habitIds.includes(h.id) && !HIDDEN_HABIT_STATUSES.has(h.status))
    .map((h) => ({ id: h.id, label: habitName(h, t), meta: t.categories[h.category]?.label }));

  return (
    <section className="card ilist" aria-labelledby={titleId}>
      <div className="ilist-head">
        <h2 className="icard-label" id={titleId}>{t.intention.card.habits}</h2>
        {linked.length > 0 && <span className="faint num" style={{ fontSize: 12 }}>{linked.length}</span>}
      </div>

      {linked.length === 0 ? (
        <p className="faint" style={{ fontSize: 14, marginTop: 10 }}>{t.intention.card.noHabits}</p>
      ) : (
        <ul className="ilist-rows">
          {shown.map((habit) => {
            const name = habitName(habit, t);
            return (
              <li className="ilist-row" key={habit.id}>
                <span className="icard-bullet" aria-hidden="true" />
                <div className="ilist-main">
                  <button type="button" className="ilist-title" onClick={() => onOpenHabit(habit)}
                    aria-label={t.intention.action.openHabit(name)}>{name}</button>
                  <div className="ilist-meta"><span>{t.categories[habit.category]?.label}</span></div>
                  {menu === habit.id && (
                    <RemoveLink onRemove={() => { onChange(unlinkHabit(reflection, habit.id)); setMenu(null); }} />
                  )}
                </div>
                <RowOptions name={name} open={menu === habit.id}
                  onToggle={() => setMenu(menu === habit.id ? null : habit.id)} />
              </li>
            );
          })}
        </ul>
      )}

      <ShowAll total={linked.length} all={all} onToggle={() => setAll((open) => !open)} />
      <Actions adding={adding} suggesting={s.loading}
        onAdd={() => setAdding((open) => !open)} onLink={() => setLinking(true)} onSuggest={s.request} />
      {adding && <HabitForm onAdd={create} onClose={() => setAdding(false)} />}
      <SuggestionTray kind="habits" s={s}
        onAdd={(draft) => {
          create(draft.text, draft.category ?? "morning");
          recordSuggestionEvent("accepted", "habits");
          if (draft.text !== draft.original.trim()) recordSuggestionEvent("edited", "habits");
        }} />
      {linking && (
        <LinkSheet title={t.intention.links.linkHabitsTitle} items={candidates}
          onLink={(ids) => { onChange(linkHabits(reflection, ids)); setLinking(false); }}
          onClose={() => setLinking(false)} />
      )}
    </section>
  );
}

/** Open first, in the order linked; completed after them, struck through. */
const openFirst = (list: Priority[]) =>
  [...list.filter((p) => !p.completedOn), ...list.filter((p) => p.completedOn)];

export function PrioritiesCard({ reflection, onChange }: { reflection: Intention; onChange: Change }) {
  const { state, actions } = useHabits();
  const t = useT();
  const locale = useLocale();
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const s = useSuggestions("priorities");
  const today = todayISO();

  const linked = openFirst(linkedPriorities(reflection, state.priorities));
  const shown = all ? linked : linked.slice(0, LIST_PREVIEW);
  const titleId = `${reflection.id}-priorities`;

  /* An ordinary priority on today, in the quadrant the person's two answers chose. */
  const create = (text: string, important: boolean, urgent: boolean) => {
    const id = actions.addPriority(today, text, quadrantFor(important, urgent));
    onChange(linkPriorities(reflection, [id]));
  };

  const candidates = openFirst(state.priorities.filter((p) => !reflection.priorityIds.includes(p.id)))
    .map((p) => ({ id: p.id, label: p.text, meta: p.completedOn ? t.intention.links.completed : undefined }));

  return (
    <section className="card ilist" aria-labelledby={titleId}>
      <div className="ilist-head">
        <h2 className="icard-label" id={titleId}>{t.intention.card.priorities}</h2>
        {linked.length > 0 && <span className="faint num" style={{ fontSize: 12 }}>{linked.length}</span>}
      </div>

      {linked.length === 0 ? (
        <p className="faint" style={{ fontSize: 14, marginTop: 10 }}>{t.intention.card.noPriorities}</p>
      ) : (
        <ul className="ilist-rows">
          {shown.map((p) => {
            const done = Boolean(p.completedOn);
            return (
              <li className="ilist-row" key={p.id}>
                <span className="ilist-mark" data-done={done} aria-hidden="true">{done && <Check size={9} />}</span>
                <div className="ilist-main">
                  <Link href="/priorities" className="ilist-title" data-done={done}
                    aria-label={t.intention.links.openCompass(p.text)}>{p.text}</Link>
                  <div className="ilist-meta">
                    <span>{done ? t.intention.card.done : t.priorities.quadrants[p.category].short}</span>
                    {p.plannedOn && (
                      <span className={isPlanOverdue(p, today) ? "overdue" : undefined}>
                        {shortDateFor(p.plannedOn, locale)}
                      </span>
                    )}
                  </div>
                  {menu === p.id && (
                    <RemoveLink onRemove={() => { onChange(unlinkPriority(reflection, p.id)); setMenu(null); }} />
                  )}
                </div>
                <RowOptions name={p.text} open={menu === p.id}
                  onToggle={() => setMenu(menu === p.id ? null : p.id)} />
              </li>
            );
          })}
        </ul>
      )}

      <ShowAll total={linked.length} all={all} onToggle={() => setAll((open) => !open)} />
      <Actions adding={adding} suggesting={s.loading}
        onAdd={() => setAdding((open) => !open)} onLink={() => setLinking(true)} onSuggest={s.request} />
      {adding && <PriorityForm onAdd={create} onClose={() => setAdding(false)} />}
      <SuggestionTray kind="priorities" s={s}
        onAdd={(draft) => {
          create(draft.text, draft.important!, draft.urgent!);
          recordSuggestionEvent("accepted", "priorities");
          if (draft.text !== draft.original.trim()) recordSuggestionEvent("edited", "priorities");
        }} />
      {linking && (
        <LinkSheet title={t.intention.links.linkPrioritiesTitle} items={candidates}
          onLink={(ids) => { onChange(linkPriorities(reflection, ids)); setLinking(false); }}
          onClose={() => setLinking(false)} />
      )}
    </section>
  );
}

/** Planned days of linked priorities, soonest first. Absent when there are none. */
export function ImportantDatesCard({ reflection }: { reflection: Intention }) {
  const { state } = useHabits();
  const t = useT();
  const locale = useLocale();
  const dated = plannedDates(reflection, state.priorities);
  if (dated.length === 0) return null;
  const today = todayISO();
  const titleId = `${reflection.id}-dates`;

  return (
    <section className="card ilist" aria-labelledby={titleId}>
      <div className="ilist-head">
        <h2 className="icard-label" id={titleId}>{t.intention.card.importantDates}</h2>
      </div>
      <p className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>{t.intention.card.importantDatesHint}</p>
      <ul className="ilist-rows">
        {dated.map((p) => (
          <li className="idates-row" key={p.id}>
            <span className="idates-date num" data-overdue={isPlanOverdue(p, today)}>
              {shortDateFor(p.plannedOn!, locale)}
            </span>
            <span style={{
              minWidth: 0, overflowWrap: "anywhere",
              ...(p.completedOn ? { color: "var(--muted)", textDecoration: "line-through" } : {}),
            }}>{p.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
