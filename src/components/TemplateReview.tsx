"use client";
import { useState } from "react";
import FrequencyField from "@/components/FrequencyField";
import { Field, Segmented } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { useT } from "@/lib/i18n/context";
import type { Dict } from "@/lib/i18n";
import type { AddOutcome } from "@/lib/addHabits";
import type { LibraryEntry } from "@/lib/library";
import { frequencyLabel, habitDescription, habitName, habitUnit, rotationLabel } from "@/lib/templates";
import type { CollectionText } from "@/lib/i18n/en";
import { isNumericTracking } from "@/lib/types";
import type { Habit } from "@/lib/types";

/** A chosen template and the habit it will become — editable until it is saved. */
export interface Pick {
  entry: LibraryEntry;
  draft: Habit;
}

/** What the last save did, and where it was sending things. */
export type ReviewResult = AddOutcome & { status: "active" | "planned" };

/**
 * The review before anything is saved (Mix & Match). Each choice can be
 * renamed, rescheduled with the same picker as the editor, given a target and a
 * priority, or opened in the full editor. The save itself, and the choice of
 * Today or the backlog, are the sheet's footer.
 */
export default function TemplateReview({ picks, result, onChange, onRemove, onAllOptions, onBack, onSaveRest }: {
  picks: Pick[];
  result: ReviewResult | null;
  onChange: (index: number, draft: Habit) => void;
  onRemove: (index: number) => void;
  onAllOptions: (index: number) => void;
  onBack: () => void;
  /** From the result: save what the plan limit held back to the backlog, or retry what failed. */
  onSaveRest: (status: "active" | "planned") => void;
}) {
  const t = useT();
  return (
    <div>
      {result && <Outcome result={result} t={t} onSaveRest={onSaveRest} />}
      {picks.length > 0 && (
        <>
          <p className="muted mt-1" style={{ fontSize: 14, lineHeight: 1.5 }}>{t.customise.reviewIntro}</p>
          {/* Calm, never blocking: a long list is allowed, just not encouraged. */}
          {picks.length > 5 && (
            <p className="flat p-3 mt-3" style={{ fontSize: 13, lineHeight: 1.5 }}>{t.customise.reviewMany(picks.length)}</p>
          )}
          <div className="flex flex-col gap-3 mt-3">
            {picks.map((p, i) => (
              <ReviewCard key={p.draft.id} pick={p}
                onChange={(d) => onChange(i, d)} onRemove={() => onRemove(i)} onAllOptions={() => onAllOptions(i)} />
            ))}
          </div>
          <p className="faint mt-3" style={{ fontSize: 12, lineHeight: 1.5 }}>{t.customise.destinationHint}</p>
        </>
      )}
      <button type="button" className="btn btn-quiet mt-1" style={{ padding: "4px 8px", marginLeft: -8, fontSize: 13 }}
        onClick={onBack}>
        ← {t.customise.keepBrowsing}
      </button>
    </div>
  );
}

function Outcome({ result, t, onSaveRest }: {
  result: ReviewResult; t: Dict; onSaveRest: (status: "active" | "planned") => void;
}) {
  const { added, limited, failed, limit, status } = result;
  return (
    <div className="flat p-3 mb-3" role="status" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
      {added.length > 0 && (
        <p>{status === "active" ? t.customise.resultAdded(added.length) : t.customise.resultSaved(added.length)}</p>
      )}
      {limited.length > 0 && (
        <div className={added.length ? "mt-2" : ""}>
          <p>{t.customise.resultLimit(limited.length, limit ?? 0)}</p>
          <button type="button" className="btn mt-2" style={{ fontSize: 13 }} onClick={() => onSaveRest("planned")}>
            {t.customise.saveRestToBacklog(limited.length)}
          </button>
        </div>
      )}
      {failed.length > 0 && (
        <div className={added.length || limited.length ? "mt-2" : ""}>
          <p style={{ color: "var(--warn)" }}>{t.customise.resultFailed(failed.length)}</p>
          <button type="button" className="btn mt-2" style={{ fontSize: 13 }} onClick={() => onSaveRest(status)}>
            {t.customise.tryAgain}
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewCard({ pick, onChange, onRemove, onAllOptions }: {
  pick: Pick;
  onChange: (d: Habit) => void;
  onRemove: () => void;
  onAllOptions: () => void;
}) {
  const t = useT();
  const [scheduling, setScheduling] = useState(false);
  const { entry, draft: h } = pick;
  const name = habitName(h, t);
  const from = entry.collection
    ? (t.templates.collections as Record<string, CollectionText>)[entry.collection].person
    : t.customise.everyday;
  const rotation = rotationLabel(h, t, todayISO());

  return (
    <div className="flat p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="faint" style={{ fontSize: 11.5 }}>{from} · {t.categories[h.category].label}</span>
        <button type="button" className="btn btn-quiet" style={{ padding: "2px 8px", fontSize: 12.5 }}
          aria-label={`${t.customise.removePick}: ${name}`} onClick={onRemove}>
          {t.customise.removePick}
        </button>
      </div>
      {/* Same rule as the editor: typing over a template's name makes the words theirs. */}
      <input className="input mt-1" value={name} aria-label={t.habits.fieldHabit}
        onChange={(e) => onChange({ ...h, name: e.target.value, templateKey: null })} />
      {habitDescription(h, t) && (
        <p className="muted mt-1.5" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{habitDescription(h, t)}</p>
      )}
      {rotation && <p className="faint mt-1" style={{ fontSize: 12 }}>{rotation}</p>}

      <div className="mt-2.5">
        <button type="button" className="chip" data-on={scheduling} aria-expanded={scheduling}
          onClick={() => setScheduling(!scheduling)}>
          {t.customise.howOften} · {frequencyLabel(h.frequency, t)} {scheduling ? "▴" : "▾"}
        </button>
        {scheduling && (
          <div className="mt-2.5">
            <FrequencyField frequency={h.frequency} onChange={(f) => onChange({ ...h, frequency: f })} />
          </div>
        )}
      </div>

      {isNumericTracking(h.tracking) && (
        <label className="flex items-center gap-2 mt-2.5" style={{ fontSize: 13 }}>
          <span className="muted">{t.habits.fieldTarget}</span>
          <input className="input num" type="number" min={0} style={{ width: 90 }} value={h.target ?? ""}
            onChange={(e) => onChange({ ...h, target: e.target.value === "" ? null : Number(e.target.value) })} />
          <span className="muted">{habitUnit(h, t)}</span>
        </label>
      )}

      <div className="mt-2.5">
        <Field label={t.habits.fieldPriority} group>
          <Segmented<1 | 2 | 3> value={h.weight} onChange={(w) => onChange({ ...h, weight: w })} small
            options={[
              { value: 1, label: t.priority.low },
              { value: 2, label: t.priority.medium },
              { value: 3, label: t.priority.high },
            ]} />
        </Field>
      </div>
      <button type="button" className="btn btn-quiet" style={{ padding: "2px 8px", marginLeft: -8, fontSize: 12.5 }}
        onClick={onAllOptions}>
        {t.customise.allOptions} →
      </button>
    </div>
  );
}
