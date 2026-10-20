"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Check, Segmented } from "@/components/ui";
import { useT } from "@/lib/i18n/context";
import type { Dict } from "@/lib/i18n";
import {
  COLLECTIONS, COLLECTION_INFO, EVERYDAY, GOAL_FILTERS, allEntries, collectionEntries,
  entryMatches, entrySource, entryWhy, goalOf, suggestedFrequency,
} from "@/lib/library";
import type { CollectionKey, GoalFilter, LibraryEntry, LibraryHabit } from "@/lib/library";
import { frequencyLabel } from "@/lib/templates";
import type { CollectionText } from "@/lib/i18n/en";
import type { Category, HabitStatus } from "@/lib/types";

/**
 * Explore templates (the Template Library, §10).
 *
 * One place, three views, no extra navigation: the start (featured collections
 * and the everyday shelf), one collection, and — while a word or a goal filter
 * is set — a flat list of everything that matches. Choosing is a tick; nothing
 * is added from here. The selection carries across collections (Mix & Match)
 * and is reviewed, editable, before anything is saved.
 */

export interface Browse {
  open: CollectionKey | null;
  search: string;
  goal: GoalFilter | null;
  /** The everyday shelf shows the tapped section unless this is on. */
  everywhere: boolean;
}

export const startBrowse: Browse = { open: null, search: "", goal: null, everywhere: false };

const collectionText = (c: CollectionKey, t: Dict): CollectionText =>
  (t.templates.collections as Record<string, CollectionText>)[c];

export default function TemplateLibrary({
  section, browse, setBrowse, ownedStatus, isPicked, onToggle, onPickMany, onUnpickMany,
}: {
  section: Category;
  browse: Browse;
  setBrowse: (b: Browse) => void;
  /** The status of the habit this account already has from this template, if any. */
  ownedStatus: (item: LibraryHabit) => HabitStatus | null;
  isPicked: (key: string) => boolean;
  onToggle: (e: LibraryEntry) => void;
  onPickMany: (es: LibraryEntry[]) => void;
  onUnpickMany: (keys: string[]) => void;
}) {
  const t = useT();
  const needle = browse.search.trim().toLowerCase();
  const filter = (es: LibraryEntry[]) =>
    es.filter((e) => (!browse.goal || goalOf(e.item) === browse.goal) && entryMatches(e, needle, t));

  return (
    <div className="mt-4">
      <input className="input" type="search" value={browse.search}
        placeholder={t.customise.searchPlaceholder} aria-label={t.customise.searchPlaceholder}
        onChange={(e) => setBrowse({ ...browse, search: e.target.value })} />
      {/* Goal filters: one tap, and a second tap on the same one clears it. */}
      <div className="flex flex-wrap gap-1.5 mt-2.5" role="group" aria-label={t.customise.goalFilter}>
        {[null, ...GOAL_FILTERS].map((g) => (
          <button key={g ?? "all"} type="button" className="chip" data-on={browse.goal === g}
            aria-pressed={browse.goal === g} style={{ padding: "5px 11px", fontSize: 12.5 }}
            onClick={() => setBrowse({ ...browse, goal: g === browse.goal ? null : g })}>
            {g ? t.customise.goals[g] : t.customise.goalAll}
          </button>
        ))}
      </div>

      {browse.open ? (
        <CollectionView c={browse.open} entries={filter(collectionEntries(browse.open))}
          filtered={!!needle || !!browse.goal} onBack={() => setBrowse({ ...browse, open: null })}
          ownedStatus={ownedStatus} isPicked={isPicked} onToggle={onToggle}
          onPickMany={onPickMany} onUnpickMany={onUnpickMany} />
      ) : needle || browse.goal ? (
        <Results entries={filter(allEntries())} ownedStatus={ownedStatus} isPicked={isPicked} onToggle={onToggle} />
      ) : (
        <>
          <div className="eyebrow mt-5 mb-2">{t.customise.featured}</div>
          <div className="grid grid-cols-2 gap-2">
            {COLLECTIONS.map((c) => {
              const text = collectionText(c, t);
              const entries = collectionEntries(c);
              const chosen = entries.filter((e) => isPicked(e.item.key)).length;
              return (
                <button key={c} type="button" className="flat tpl-card"
                  aria-label={`${text.person}: ${text.title}, ${t.customise.habitCount(entries.length)}`}
                  onClick={() => setBrowse({ ...browse, open: c })}>
                  <span className="monogram" aria-hidden="true">{COLLECTION_INFO[c].initials}</span>
                  <span className="block mt-2" style={{ fontSize: 14.5, fontWeight: 500, lineHeight: 1.25 }}>{text.title}</span>
                  <span className="faint block mt-0.5" style={{ fontSize: 12, lineHeight: 1.35 }}>{text.person}</span>
                  <span className="faint block mt-1" style={{ fontSize: 11.5 }}>
                    {t.customise.habitCount(entries.length)}
                    {chosen > 0 && <span style={{ color: "var(--accent)" }}> · {t.customise.selectedCount(chosen)}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="eyebrow mt-6 mb-2">{t.customise.everyday}</div>
          <Segmented<boolean> value={browse.everywhere} onChange={(v) => setBrowse({ ...browse, everywhere: v })} small
            options={[
              { value: false, label: t.customise.showSection(t.categories[section].label) },
              { value: true, label: t.customise.showAll },
            ]} />
          <div className="mt-2">
            {EVERYDAY.filter((e) => browse.everywhere || e.item.category === section).map((e) => (
              <TemplateRow key={e.ref} entry={e} owned={ownedStatus(e.item)} picked={isPicked(e.item.key)}
                onToggle={onToggle} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CollectionView({
  c, entries, filtered, onBack, ownedStatus, isPicked, onToggle, onPickMany, onUnpickMany,
}: {
  c: CollectionKey; entries: LibraryEntry[]; filtered: boolean; onBack: () => void;
  ownedStatus: (item: LibraryHabit) => HabitStatus | null;
  isPicked: (key: string) => boolean;
  onToggle: (e: LibraryEntry) => void;
  onPickMany: (es: LibraryEntry[]) => void;
  onUnpickMany: (keys: string[]) => void;
}) {
  const t = useT();
  const text = collectionText(c, t);
  const info = COLLECTION_INFO[c];
  const [about, setAbout] = useState(false);
  const aboutId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // Arriving in a collection moves focus to its name, so a screen reader says where it is.
  useEffect(() => heading.current?.focus(), [c]);

  /*
   * Select all offers what is shown and not already theirs. The rotating
   * Virtue of the week is left to its own tick: the collection already has
   * each of its thirteen virtues, and taking both is a choice, not a default.
   */
  const selectable = entries.filter((e) => !ownedStatus(e.item) && !e.item.rotation);
  const allChosen = selectable.length > 0 && selectable.every((e) => isPicked(e.item.key));

  const row = (e: LibraryEntry) => (
    <TemplateRow key={e.ref} entry={e} owned={ownedStatus(e.item)} picked={isPicked(e.item.key)} onToggle={onToggle} />
  );

  return (
    <div className="mt-4">
      <button type="button" className="btn btn-quiet" style={{ padding: "4px 8px", marginLeft: -8, fontSize: 13 }}
        onClick={onBack}>
        ← {t.customise.allTemplates}
      </button>
      <div className="flex items-start gap-3 mt-2">
        <span className="monogram" aria-hidden="true">{info.initials}</span>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">{text.person}</div>
          <h3 ref={heading} tabIndex={-1} className="display" style={{ fontSize: 22, lineHeight: 1.15, outline: "none" }}>
            {text.title}
          </h3>
          <p className="muted mt-1" style={{ fontSize: 13.5, lineHeight: 1.5 }}>{text.idea}</p>
        </div>
      </div>

      {/* Optional, and closed by default: learning about the person never slows down choosing. */}
      {text.bio && (
        <div className="mt-2">
          <button type="button" className="btn btn-quiet" aria-expanded={about} aria-controls={aboutId}
            style={{ padding: "4px 8px", marginLeft: -8, fontSize: 13 }} onClick={() => setAbout(!about)}>
            {t.customise.aboutPerson} {about ? "▴" : "▾"}
          </button>
          {about && (
            <div id={aboutId} className="flat p-3 mt-1" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
              <div className="eyebrow">{t.customise.aboutWho}</div>
              <p className="mt-1">{text.bio}</p>
              {text.philosophy && (<><div className="eyebrow mt-3">{t.customise.aboutIdea}</div><p className="mt-1">{text.philosophy}</p></>)}
              {text.useful && (<><div className="eyebrow mt-3">{t.customise.aboutUseful}</div><p className="mt-1">{text.useful}</p></>)}
              {info.links.length > 0 && (
                <>
                  <div className="eyebrow mt-3">{t.customise.sources}</div>
                  <ul className="mt-1" style={{ listStyle: "none", padding: 0 }}>
                    {info.links.map((url, i) => (
                      <li key={url} className="mt-0.5">
                        <a href={url} target="_blank" rel="noopener noreferrer" className="tpl-link">
                          {text.links?.[i] ?? url} ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-3">
        {selectable.length > 0 ? (
          <>
            <button type="button" className="btn" style={{ fontSize: 13, padding: "6px 12px" }}
              onClick={() => (allChosen
                ? onUnpickMany(selectable.map((e) => e.item.key))
                : onPickMany(selectable.filter((e) => !isPicked(e.item.key))))}>
              {allChosen ? t.customise.clearCollection : t.customise.selectAll(selectable.length)}
            </button>
            <span className="faint" style={{ fontSize: 12 }}>{t.customise.selectHint}</span>
          </>
        ) : entries.length > 0 && (
          <span className="faint" style={{ fontSize: 12.5 }}>{t.customise.allTaken}</span>
        )}
      </div>

      <div className="mt-2">
        {entries.length === 0 && <p className="muted py-4" style={{ fontSize: 14 }}>{t.customise.noMatches}</p>}
        {info.groups.length && !filtered
          ? info.groups.map((g, gi) => {
            const inGroup = entries.filter((e) => e.group === g);
            if (!inGroup.length) return null;
            // Franklin's virtues are named by the virtue itself — one definition, shared with the rotation.
            const virtue = c === "franklin" && g !== "method";
            return (
              <section key={g} className="mt-4" aria-label={virtue ? t.templates.habits[`franklin_${g}`] : t.templates.groups[g]}>
                <div className="eyebrow mb-1">
                  {virtue ? `${gi} · ${t.templates.habits[`franklin_${g}`]}` : t.templates.groups[g]}
                </div>
                {inGroup.map(row)}
              </section>
            );
          })
          : entries.map(row)}
      </div>
    </div>
  );
}

function Results({ entries, ownedStatus, isPicked, onToggle }: {
  entries: LibraryEntry[];
  ownedStatus: (item: LibraryHabit) => HabitStatus | null;
  isPicked: (key: string) => boolean;
  onToggle: (e: LibraryEntry) => void;
}) {
  const t = useT();
  return (
    <div className="mt-4">
      <div className="faint" style={{ fontSize: 12 }} aria-live="polite">{t.customise.resultCount(entries.length)}</div>
      {entries.length === 0 && <p className="muted py-4" style={{ fontSize: 14 }}>{t.customise.noMatches}</p>}
      <div className="mt-1">
        {entries.map((e) => (
          <TemplateRow key={e.ref} entry={e} owned={ownedStatus(e.item)} picked={isPicked(e.item.key)}
            onToggle={onToggle} showCollection />
        ))}
      </div>
    </div>
  );
}

/** How this account already has a template, in its own words. */
function ownedLabel(status: HabitStatus, t: Dict): string {
  if (status === "active" || status === "established") return t.customise.alreadyOnSheet;
  if (status === "paused") return t.habits.statusPaused;
  return t.customise.inBacklog;
}

/**
 * One template: a tick to choose it, and — before anything is added — its
 * description, schedule, how directly it comes from its person, and an
 * optional "Why this habit?" with the source and a link to read it.
 */
function TemplateRow({ entry: e, owned, picked, onToggle, showCollection }: {
  entry: LibraryEntry;
  owned: HabitStatus | null;
  picked: boolean;
  onToggle: (e: LibraryEntry) => void;
  showCollection?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const whyId = useId();
  const name = t.templates.habits[e.item.key] ?? e.item.key;
  const description = t.templates.descriptions[e.item.key];
  const why = entryWhy(e, t);
  const source = entrySource(e, t);
  const person = showCollection && e.collection ? collectionText(e.collection, t).person : null;
  const meta = [
    person,
    t.categories[e.category].label,
    frequencyLabel(suggestedFrequency(e.item), t),
    e.attribution ? t.templates.attribution[e.attribution] : null,
    owned ? ownedLabel(owned, t) : null,
  ].filter(Boolean).join(" · ");

  // Named by the habit; the description and the meta line are its description.
  return (
    <div className="tpl-row">
      <button type="button" role="checkbox" aria-checked={picked} className="link-row"
        aria-labelledby={`${whyId}-name`}
        aria-describedby={description ? `${whyId}-desc ${whyId}-meta` : `${whyId}-meta`}
        onClick={() => onToggle(e)}>
        <span className="link-box" aria-hidden="true">{picked && <Check />}</span>
        <span style={{ minWidth: 0 }}>
          <span id={`${whyId}-name`} className="block" style={{ overflowWrap: "anywhere" }}>
            {e.item.kind === "avoid" && <span className="faint">{t.customise.avoid} · </span>}
            {name}
          </span>
          {description && (
            <span id={`${whyId}-desc`} className="muted block mt-0.5" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
              {description}
            </span>
          )}
          <span id={`${whyId}-meta`} className="faint block mt-0.5" style={{ fontSize: 12 }}>{meta}</span>
        </span>
      </button>
      {why && (
        <div style={{ paddingLeft: 31, paddingBottom: 8 }}>
          <button type="button" className="tpl-why" aria-expanded={open} aria-controls={whyId}
            onClick={() => setOpen(!open)}>
            {t.customise.why} {open ? "▴" : "▾"}
          </button>
          {open && (
            <div id={whyId} className="flat p-3 mt-1.5" style={{ fontSize: 13, lineHeight: 1.55 }}>
              <p>{why}</p>
              {e.attribution && (
                <p className="faint mt-2" style={{ fontSize: 12 }}>
                  <span style={{ fontWeight: 500 }}>{t.templates.attribution[e.attribution]}</span>
                  {" — "}{t.templates.attributionHint[e.attribution]}
                </p>
              )}
              {source && (
                <p className="faint mt-1" style={{ fontSize: 12 }}>
                  {t.customise.sourcePrefix}{source}
                  {e.url && (
                    <>
                      {" · "}
                      <a href={e.url} target="_blank" rel="noopener noreferrer" className="tpl-link">
                        {t.customise.openSource} ↗
                      </a>
                    </>
                  )}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
