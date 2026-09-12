"use client";
import { useEffect, useRef, useState } from "react";
import { useHabits } from "@/components/store";
import HabitEditor from "@/components/HabitEditor";
import { GrowingTextarea, Segmented } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { CATEGORIES, blankHabit } from "@/lib/habits";
import { quadrantFor } from "@/lib/priorities";
import { dict } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/context";
import {
  INTENTION_STEPS, OWNERSHIP_CHOICES, STEP_COUNT,
  advance, blankIntention, canAddHabit, canContinue, canGoDeeper, canRevealVision, deepestWhy,
  finish, goDeeper, isBlank, linkedHabits, linkedPriority, resumeStep, revealVision, setVision,
  setWhy, visionPromptAt,
} from "@/lib/intention";
import { habitName } from "@/lib/templates";
import type { Category, Habit, Intention as Reflection, IntentionOwnership } from "@/lib/types";
import type { Dict } from "@/lib/i18n/en";

/**
 * Clarify Your Intention.
 *
 * A guided session in five steps: what you want, why it matters, whether it is
 * really yours, what it would look like, and what you will actually do. One
 * question at a time, and a step ends when the person decides it does — going
 * deeper is always offered and never required.
 *
 * Three things this screen deliberately is not. It is not an assessment: no
 * answer is scored, ranked or compared, and the Truth step has no wrong answer
 * to give. It is not a coach: there is no model in this file and no advice
 * anywhere in it. And it is not a second habit or priority system — step five
 * calls `saveHabit` and `addPriority`, the same actions Today and the matrix
 * call, so what it creates is an ordinary habit and an ordinary priority from
 * the moment it exists.
 *
 * Everything the person writes is theirs. It is stored exactly as typed, never
 * translated even in bilingual mode, and never placed in an analytics
 * property, a log line or anything an admin can read.
 */

/**
 * A question, set on its own line per language.
 *
 * In English or Chinese this is one string from the current dictionary. In
 * bilingual mode it asks each dictionary for its own wording and stacks them,
 * because the merged string joins two finished sentences with a space — right
 * inside a paragraph, and wrong at 30px, where the two languages run together
 * into one long line and neither reads as a question any more.
 */
function Question({ pick, sub }: { pick: (d: Dict) => string; sub?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const className = `intent-q${sub ? " intent-sub" : ""}`;

  const body = locale !== "both" ? pick(t) : (
    <>
      {pick(dict("en"))}
      <span className="intent-q-alt">{pick(dict("zh"))}</span>
    </>
  );

  return sub
    ? <h2 className={className}>{body}</h2>
    : <h1 className={className}>{body}</h1>;
}

/** Where you are: the step's name, and five ticks. */
function Progress({ step }: { step: number }) {
  const t = useT();
  return (
    <div className="mb-7">
      <div className="eyebrow mb-2.5">{t.intention.steps[INTENTION_STEPS[step - 1]]}</div>
      <div className="intent-steps" role="img" aria-label={t.intention.progress(step, STEP_COUNT)}>
        {INTENTION_STEPS.map((name, at) => (
          <span key={name} className="intent-tick" data-state={
            at + 1 === step ? "here" : at + 1 < step ? "done" : "todo"
          } />
        ))}
      </div>
    </div>
  );
}

/**
 * The writing surface. Focused on arrival where there is a real pointer, and
 * left alone where there is not: opening the keyboard over a question somebody
 * has not finished reading is not a courtesy on a phone.
 *
 * The capability is read in an effect rather than during render, so the server
 * and the first client paint agree.
 */
function Writing({
  value, onChange, placeholder, autoFocus,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);

  /*
   * Found through the wrapper rather than by handing a ref to the shared
   * textarea, which keeps `GrowingTextarea` as it is — there is exactly one
   * field in here, so the query cannot pick the wrong one.
   *
   * The capability is read in an effect, never during render, so the server and
   * the first client paint agree. And it is a capability query rather than a
   * width: opening the keyboard over a question somebody has not finished
   * reading is not a courtesy on a phone, and that is about the input device,
   * not about how wide the window happens to be.
   */
  useEffect(() => {
    if (!autoFocus) return;
    try {
      if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    } catch { return; }
    box.current?.querySelector("textarea")?.focus();
  }, [autoFocus]);

  return (
    <div className="mt-5" ref={box}>
      <GrowingTextarea
        bare
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxHeight="38vh"
        rows={2}
        spellCheck
      />
    </div>
  );
}

/**
 * A ladder of prompts, revealed one at a time — the Why chain and the Vision
 * prompts are the same interaction with a different set of questions, so they
 * are the same component.
 *
 * What has been answered stays in view as a quotation rather than as another
 * open box, which is what keeps a step from becoming the wall of textareas the
 * product asked not to have. A quotation is also a button: reopening a rung is
 * one tap, and nothing is lost by having gone deeper.
 */
function Ladder({
  values, promptFor, quotedLabel, placeholder, canReveal, revealLabel,
  onChange, onReveal,
}: {
  values: string[];
  /** The question for one rung, or null when the step's heading already asks it. */
  promptFor: (at: number) => ((d: Dict) => string) | null;
  quotedLabel: string;
  placeholder: string;
  canReveal: boolean;
  revealLabel: string;
  onChange: (at: number, text: string) => void;
  onReveal: () => void;
}) {
  const [openAt, setOpenAt] = useState(values.length - 1);

  // A newly revealed rung is the one being written into.
  useEffect(() => { setOpenAt(values.length - 1); }, [values.length]);

  const at = Math.min(openAt, values.length - 1);

  return (
    <>
      {values.map((value, index) => {
        if (index === at) return null;
        if (!value.trim()) return null;
        const prompt = promptFor(index);
        return (
          <div className="mt-5" key={index}>
            <div className="eyebrow mb-1.5">
              {prompt ? <Quoted pick={prompt} /> : quotedLabel}
            </div>
            <button type="button" className="intent-said" onClick={() => setOpenAt(index)}>
              {value.trim()}
            </button>
          </div>
        );
      })}

      <div className="mt-6">
        {promptFor(at) && <Question pick={promptFor(at)!} sub />}
        <Writing
          key={at}
          value={values[at] ?? ""}
          onChange={(text) => onChange(at, text)}
          placeholder={placeholder}
          autoFocus
        />
      </div>

      {/* Offered only once the rung above has an answer, and never as the way
          forward — Continue is that, and it is a button. */}
      {canReveal && at === values.length - 1 && (
        <button type="button" className="intent-more mt-2" onClick={onReveal}>
          {revealLabel}
          <span aria-hidden="true">↓</span>
        </button>
      )}
    </>
  );
}

/** A prompt used as a label above a quotation. One line, both languages. */
function Quoted({ pick }: { pick: (d: Dict) => string }) {
  const t = useT();
  const locale = useLocale();
  return <>{locale === "both" ? `${pick(dict("en"))} · ${pick(dict("zh"))}` : pick(t)}</>;
}

/* ─────────────────────────────── the steps ─────────────────────────────── */

function StepWhat({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <>
      <Question pick={(d) => d.intention.what.question} />
      <Writing value={value} onChange={onChange}
        placeholder={t.intention.what.placeholder} autoFocus />
    </>
  );
}

function StepWhy({
  reflection, onChange, onReveal,
}: {
  reflection: Reflection;
  onChange: (at: number, text: string) => void;
  onReveal: () => void;
}) {
  const t = useT();
  return (
    <>
      <Question pick={(d) => d.intention.why.question} />
      <Ladder
        values={reflection.whyChain}
        /* Rung one is the step's own heading, already asked above. */
        promptFor={(at) => at === 0
          ? null
          : at === 1
            ? (d) => d.intention.why.deeper
            : (d) => d.intention.why.deepest}
        quotedLabel={t.intention.why.earlier}
        placeholder={t.intention.why.placeholder}
        canReveal={canGoDeeper(reflection)}
        revealLabel={t.intention.why.goDeeper}
        onChange={onChange}
        onReveal={onReveal}
      />
    </>
  );
}

function StepTruth({
  reflection, onChoose, onNote,
}: {
  reflection: Reflection;
  onChoose: (choice: IntentionOwnership) => void;
  onNote: (text: string) => void;
}) {
  const t = useT();
  return (
    <>
      <Question pick={(d) => d.intention.truth.question} />
      <p className="muted mt-4" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
        {t.intention.truth.note}
      </p>

      {/* Three sentences, one per line. No scoring, no ordering, no "correct"
          answer — which is why they are a set of choices and not a scale. */}
      <div className="flex flex-col gap-2.5 mt-6">
        {OWNERSHIP_CHOICES.map((choice) => (
          <button key={choice} type="button" className="choice"
            aria-pressed={reflection.ownership === choice}
            onClick={() => onChoose(choice)}>
            <span className="choice-mark" aria-hidden="true" />
            <span>{t.intention.truth.choices[choice]}</span>
          </button>
        ))}
      </div>

      {/* One follow-up, chosen by the answer, and entirely optional. */}
      {reflection.ownership && (
        <div className="mt-8 fade-in">
          <Question pick={(d) => d.intention.truth.prompts[reflection.ownership!]} sub />
          <Writing value={reflection.ownershipNote} onChange={onNote}
            placeholder={t.common.optional} />
        </div>
      )}
    </>
  );
}

function StepVision({
  reflection, onChange, onReveal,
}: {
  reflection: Reflection;
  onChange: (at: number, text: string) => void;
  onReveal: () => void;
}) {
  const t = useT();
  return (
    <>
      <Question pick={(d) => d.intention.vision.question} />
      <Ladder
        values={reflection.vision}
        promptFor={(at) => (d) => d.intention.vision.prompts[visionPromptAt(at)]}
        quotedLabel=""
        placeholder={t.common.optional}
        canReveal={canRevealVision(reflection)}
        revealLabel={t.intention.vision.next}
        onChange={onChange}
        onReveal={onReveal}
      />
    </>
  );
}

/**
 * Turning the reflection into behaviour.
 *
 * Both creations go through the app's ordinary paths: a habit is `blankHabit()`
 * with a name and a section, saved by `saveHabit`; a priority is `addPriority`
 * with the quadrant the same two questions the matrix asks have derived. The
 * two questions are asked here for exactly the reason the matrix asks them —
 * nothing in this app may decide what matters to somebody — so there is no
 * default quadrant here either.
 *
 * Nothing is created until the button is pressed.
 */
function StepAction({
  reflection, onHabit, onPriority, onOpenHabit,
}: {
  reflection: Reflection;
  onHabit: (name: string, category: Category) => void;
  onPriority: (text: string, important: boolean, urgent: boolean) => void;
  onOpenHabit: (habit: Habit) => void;
}) {
  const { state } = useHabits();
  const t = useT();

  const [habitText, setHabitText] = useState("");
  const [habitWhen, setHabitWhen] = useState<Category>("morning");
  const [priorityText, setPriorityText] = useState("");
  const [important, setImportant] = useState<boolean | null>(null);
  const [urgent, setUrgent] = useState<boolean | null>(null);

  const made = linkedHabits(reflection, state.habits);
  const priority = linkedPriority(reflection, state.priorities);
  const answered = important !== null && urgent !== null;

  const addHabit = () => {
    const name = habitText.trim();
    if (!name || !canAddHabit(reflection)) return;
    onHabit(name, habitWhen);
    setHabitText("");
  };

  const addPriority = () => {
    const text = priorityText.trim();
    if (!text || !answered) return;
    onPriority(text, important, urgent);
    setPriorityText("");
    setImportant(null);
    setUrgent(null);
  };

  return (
    <>
      <Question pick={(d) => d.intention.action.question} />
      <p className="muted mt-4" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
        {t.intention.action.note}
      </p>

      {/* What all of this is for, kept in view while it is turned into
          something. Their words, unchanged. */}
      {reflection.want.trim() && (
        <p className="display mt-6" style={{
          fontSize: 18, lineHeight: 1.5, color: "var(--muted)",
          whiteSpace: "pre-wrap", overflowWrap: "anywhere",
        }}>{reflection.want.trim()}</p>
      )}

      <hr className="icard-rule" />

      <div className="eyebrow">{t.intention.action.habitsTitle}</div>
      <p className="faint mt-1.5" style={{ fontSize: 13, lineHeight: 1.5 }}>
        {t.intention.action.habitsHint}
      </p>

      {made.length > 0 && (
        <div className="mt-3">
          {made.map((habit) => (
            <div className="icard-item" key={habit.id}>
              <span className="icard-bullet" aria-hidden="true" />
              <button type="button" onClick={() => onOpenHabit(habit)}
                aria-label={t.intention.action.openHabit(habitName(habit, t))}
                style={{
                  background: "none", border: "none", padding: 0, textAlign: "left",
                  font: "inherit", color: "inherit", cursor: "pointer", minWidth: 0,
                }}>
                {habitName(habit, t)}
                <span className="faint" style={{ fontSize: 12.5, display: "block", marginTop: 1 }}>
                  {t.intention.action.habitAdded}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      {canAddHabit(reflection) && (
        <div className="mt-4">
          <input className="input" value={habitText} maxLength={200}
            placeholder={t.intention.action.habitPlaceholder}
            aria-label={t.intention.action.habitsTitle}
            onChange={(e) => setHabitText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addHabit(); }} />
          {habitText.trim() && (
            <div className="flex flex-wrap items-center gap-3 mt-3 fade-in">
              <span className="faint" style={{ fontSize: 12.5 }}>
                {t.intention.action.whenTitle}
              </span>
              <Segmented<Category> value={habitWhen} onChange={setHabitWhen} small
                options={CATEGORIES.map((c) => ({ value: c.id, label: t.categories[c.id].label }))} />
              <button className="btn" style={{ flex: "none" }} onClick={addHabit}>
                {t.intention.action.addHabit}
              </button>
            </div>
          )}
        </div>
      )}

      <hr className="icard-rule" />

      <div className="eyebrow">{t.intention.action.priorityTitle}</div>
      <p className="faint mt-1.5" style={{ fontSize: 13, lineHeight: 1.5 }}>
        {t.intention.action.priorityHint}
      </p>

      {priority ? (
        <div className="icard-item mt-3">
          <span className="icard-bullet" aria-hidden="true" />
          <span>
            {priority.text}
            <span className="faint" style={{ fontSize: 12.5, display: "block", marginTop: 1 }}>
              {t.intention.action.priorityAdded}
            </span>
          </span>
        </div>
      ) : (
        <div className="mt-4">
          <input className="input" value={priorityText} maxLength={200}
            placeholder={t.intention.action.priorityPlaceholder}
            aria-label={t.intention.action.priorityTitle}
            onChange={(e) => {
              setPriorityText(e.target.value);
              // Clearing the line clears the answers: the next thing typed
              // starts unclassified rather than inheriting a judgement made
              // about something else. The matrix does the same.
              if (!e.target.value.trim()) { setImportant(null); setUrgent(null); }
            }}
            onKeyDown={(e) => { if (e.key === "Enter") addPriority(); }} />

          {priorityText.trim() && (
            <div className="pask">
              <span className="pask-q">
                <span className="faint">{t.intention.action.askImportant}</span>
                <button type="button" className="chip" data-on={important === true}
                  onClick={() => setImportant(true)}>{t.priorities.yes}</button>
                <button type="button" className="chip" data-on={important === false}
                  onClick={() => setImportant(false)}>{t.priorities.no}</button>
              </span>
              <span className="pask-q">
                <span className="faint">{t.intention.action.askUrgent}</span>
                <button type="button" className="chip" data-on={urgent === true}
                  onClick={() => setUrgent(true)}>{t.priorities.yes}</button>
                <button type="button" className="chip" data-on={urgent === false}
                  onClick={() => setUrgent(false)}>{t.priorities.no}</button>
              </span>
              <button className="btn" style={{ flex: "none" }}
                disabled={!answered} onClick={addPriority}>
                {t.intention.action.addPriority}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* ──────────────────────────── the intention card ───────────────────────── */

/**
 * What the session leaves behind.
 *
 * Four things and nothing else: the intention, the deepest reason, the habits,
 * the next priority. Deliberately no percentage, no streak, no chart and no
 * figure of any kind — this is a page somebody should want to come back and
 * look at, and the moment it starts reporting on them it becomes one more
 * screen keeping score.
 *
 * The habits and the priority are read from the account as they are now, so a
 * renamed habit reads correctly here and a deleted one is simply absent.
 */
function IntentionCard({
  reflection, onRevisit,
}: { reflection: Reflection; onRevisit: () => void }) {
  const { state } = useHabits();
  const t = useT();
  const [chain, setChain] = useState(false);

  const habits = linkedHabits(reflection, state.habits);
  const priority = linkedPriority(reflection, state.priorities);
  const why = deepestWhy(reflection);
  // Everything above the deepest rung, which is what "the whole chain" opens.
  const earlier = reflection.whyChain.map((w) => w.trim()).filter(Boolean).slice(0, -1);

  return (
    <div className="intent">
      <div className="card icard">
        <div className="icard-label">{t.intention.card.intention}</div>
        <div className="icard-intention">{reflection.want.trim()}</div>

        {why && (
          <>
            <hr className="icard-rule" />
            <div className="icard-label">{t.intention.card.why}</div>
            <div className="icard-why">{why}</div>
            {earlier.length > 0 && (
              <>
                <button type="button" className="intent-more mt-2"
                  aria-expanded={chain} onClick={() => setChain((open) => !open)}>
                  {t.intention.card.fullWhy}
                  <span aria-hidden="true">{chain ? "↑" : "↓"}</span>
                </button>
                {chain && (
                  <div className="flex flex-col gap-2.5 mt-1 fade-in">
                    {earlier.map((step, at) => (
                      <p className="intent-said" key={at} style={{ cursor: "default" }}>{step}</p>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        <hr className="icard-rule" />
        <div className="icard-label">{t.intention.card.habits}</div>
        {habits.length === 0 ? (
          <p className="faint mt-2.5" style={{ fontSize: 14 }}>{t.intention.card.noHabits}</p>
        ) : (
          <div className="mt-2">
            {habits.map((habit) => (
              <div className="icard-item" key={habit.id}>
                <span className="icard-bullet" aria-hidden="true" />
                <span>{habitName(habit, t)}</span>
              </div>
            ))}
          </div>
        )}

        <hr className="icard-rule" />
        <div className="icard-label">{t.intention.card.priority}</div>
        {!priority ? (
          <p className="faint mt-2.5" style={{ fontSize: 14 }}>{t.intention.card.noPriority}</p>
        ) : (
          <div className="icard-item mt-2">
            <span className="icard-bullet" aria-hidden="true"
              style={priority.completedOn ? { background: "var(--line)" } : undefined} />
            <span style={priority.completedOn
              ? { color: "var(--muted)", textDecoration: "line-through" } : undefined}>
              {priority.text}
              {priority.completedOn && (
                <span className="faint" style={{ fontSize: 12.5, display: "block", marginTop: 1, textDecoration: "none" }}>
                  {t.intention.card.done}
                </span>
              )}
            </span>
          </div>
        )}
      </div>

      <div className="flex justify-center mt-5">
        <button className="btn" onClick={onRevisit}>{t.intention.card.revisit}</button>
      </div>

      <Attribution />
    </div>
  );
}

/**
 * The acknowledgement.
 *
 * Verified before it shipped rather than paraphrased from memory: Dr. James R.
 * Doty was a neurosurgeon on the faculty of Stanford University School of
 * Medicine and the founder and director of Stanford's Center for Compassion and
 * Altruism Research and Education. Nothing of his is quoted or reproduced here
 * — every prompt in this file is RichHabit's own wording — and the second
 * sentence of the credit is what keeps an acknowledgement from being read as a
 * claim of endorsement, sponsorship or involvement.
 *
 * Rendered once per page, last, at the smallest size the app uses. No box, no
 * icon and no rule heavier than a hairline: a credit, not a notice.
 */
function Attribution() {
  const t = useT();
  return <p className="intent-credit">{t.intention.attribution}</p>;
}

/**
 * Said when the table has not been created yet.
 *
 * Shown instead of the session, never above it. The writing is autosaved, so
 * offering a question and a caret over a write that cannot land is inviting
 * somebody to lose a page of reflection — this page would rather say nothing is
 * switched on than risk that.
 */
function NotSwitchedOn() {
  const t = useT();
  return (
    <div className="intent">
      <div className="card p-6" role="status"
        style={{ borderColor: "var(--warn)", background: "var(--warn-soft)" }}>
        <div className="display" style={{ fontSize: 20 }}>{t.intention.unavailableTitle}</div>
        <p className="mt-2" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
          {t.intention.unavailableBody}
        </p>
      </div>
    </div>
  );
}

/* ────────────────────────────── the session ────────────────────────────── */

export default function Intention() {
  const { state, actions } = useHabits();
  const t = useT();

  const stored = state.intention;

  /**
   * The session before it has any words in it.
   *
   * An intention is only written once there is something to write: a blank row
   * for somebody who opened the page and left would be a record of nothing.
   * Until then the draft lives here, and `stored` takes over the moment the
   * first save happens.
   */
  const [draft, setDraft] = useState<Reflection | null>(null);
  const reflection = stored ?? draft;

  const [step, setStep] = useState(() => (stored ? resumeStep(stored) : 1));
  /** Set while a finished intention is being edited again. */
  const [revisiting, setRevisiting] = useState(false);
  /** Shown once, on arriving back in the middle of a session. */
  const [resumed, setResumed] = useState(() => Boolean(stored) && !stored!.complete
    && resumeStep(stored!) > 1);
  const [editing, setEditing] = useState<Habit | null>(null);

  const top = useRef<HTMLDivElement>(null);

  if (state.unavailable.includes("intention")) return <NotSwitchedOn />;

  /**
   * Every change to the reflection goes through here.
   *
   * Once the row exists, the store is the single source of truth and holds the
   * optimistic update, so writes always go to it. Before that, a change is kept
   * locally and only becomes a row when there is something in it — which is
   * what stops a visit from creating an empty intention, and what lets somebody
   * type a word and delete it again without leaving anything behind.
   */
  const update = (next: Reflection) => {
    if (stored) { actions.setIntention(next); return; }
    setDraft(next);
    if (!isBlank(next)) actions.setIntention(next);
  };

  const begin = () => { setDraft(blankIntention()); setStep(1); };

  const go = (to: number) => {
    setResumed(false);
    setStep(to);
    if (reflection) update(advance(reflection, to));
    // The question, not the bottom of the last one. A step change is a new
    // screen, and it should start at the top of it.
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  /* ── the invitation ── */
  if (!reflection) {
    return (
      <div className="intent">
        <div className="eyebrow mb-3">{t.intention.eyebrow}</div>
        <h1 className="intent-q">{t.intention.startTitle}</h1>
        <p className="muted mt-5" style={{ fontSize: 15.5, lineHeight: 1.65 }}>
          {t.intention.startBody}
        </p>
        <div className="mt-8">
          <button className="btn btn-primary" onClick={begin}>{t.intention.start}</button>
        </div>
        <Attribution />
      </div>
    );
  }

  /* ── the card ── */
  if (reflection.complete && !revisiting) {
    return (
      <IntentionCard reflection={reflection}
        onRevisit={() => { setRevisiting(true); setStep(1); }} />
    );
  }

  /* ── the session ── */
  const last = step === STEP_COUNT;

  return (
    <div className="intent" ref={top}>
      <Progress step={step} />

      {resumed && (
        <p className="faint mb-5 fade-in" style={{ fontSize: 12.5 }}>
          {t.intention.resume}
        </p>
      )}

      {/* Keyed on the step, so React mounts a new subtree and `.fade-in` runs:
          one transition mechanism, the same one `<main>` already uses between
          pages, rather than an animation library for five screens. */}
      <div key={step} className="fade-in">
        {step === 1 && (
          <StepWhat value={reflection.want}
            onChange={(want) => update({ ...reflection, want })} />
        )}
        {step === 2 && (
          <StepWhy reflection={reflection}
            onChange={(at, text) => update(setWhy(reflection, at, text))}
            onReveal={() => update(goDeeper(reflection))} />
        )}
        {step === 3 && (
          <StepTruth reflection={reflection}
            onChoose={(ownership) => update({ ...reflection, ownership })}
            onNote={(ownershipNote) => update({ ...reflection, ownershipNote })} />
        )}
        {step === 4 && (
          <StepVision reflection={reflection}
            onChange={(at, text) => update(setVision(reflection, at, text))}
            onReveal={() => update(revealVision(reflection))} />
        )}
        {step === 5 && (
          <StepAction
            reflection={reflection}
            onOpenHabit={setEditing}
            /*
             * An ordinary habit. `blankHabit()` and `saveHabit` are what Today
             * and the habit sheet use, and the row this writes is
             * indistinguishable from one added there — it is scheduled, scored,
             * editable, pausable and retirable exactly the same way. The
             * intention only records that it was the one to suggest it.
             */
            onHabit={(name, category) => {
              const habit: Habit = {
                ...blankHabit(),
                name,
                category,
                sortOrder: Math.max(0, ...state.habits
                  .filter((h) => h.category === category)
                  .map((h) => h.sortOrder)) + 1,
              };
              actions.saveHabit(habit);
              update({ ...reflection, habitIds: [...reflection.habitIds, habit.id] });
            }}
            /*
             * An ordinary priority, in the quadrant the two questions derived,
             * written on today. It rolls forward until it is finished or
             * removed like every other line on the compass, and it is not a
             * copy of anything or owned by anything here.
             */
            onPriority={(text, important, urgent) => {
              const id = actions.addPriority(todayISO(), text, quadrantFor(important, urgent));
              update({ ...reflection, priorityId: id });
            }}
          />
        )}
      </div>

      <div className="intent-actions">
        {step > 1
          ? (
            <button className="btn btn-quiet" onClick={() => go(step - 1)}>
              {t.intention.back}
            </button>
          )
          : <span />}

        <button className="btn btn-primary"
          disabled={!canContinue(reflection, step)}
          onClick={() => {
            if (!last) { go(step + 1); return; }
            update(finish(reflection));
            setRevisiting(false);
          }}>
          {last ? t.intention.action.finish : t.intention.continue}
        </button>
      </div>

      <Attribution />

      {/* The app's own habit editor, so a habit started here is refined with
          the same form as any other. */}
      {editing && (
        <HabitEditor
          habit={editing} goals={state.goals}
          onSave={(h) => { actions.saveHabit(h); setEditing(null); }}
          onDelete={(id) => { actions.deleteHabit(id); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
