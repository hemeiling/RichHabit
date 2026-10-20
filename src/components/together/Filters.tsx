"use client";
import { useState } from "react";
import type { GroupView, TaskSummary } from "@/lib/together/work";
import { effectivePoints, type GroupFilter as GroupChoice } from "@/lib/together/progress";
import { useT } from "@/lib/i18n/context";
import { Menu, type MenuItem } from "@/components/together/overlay";

/**
 * The small pieces Board, Backlog, History and Progress share: a filter that
 * opens a menu of choices, the group filter itself, and a sum of story points.
 *
 * A filter is a quiet pill that says what it filters and what is chosen
 * ("Group · Design"), so the view never hides that it is narrowed; the first
 * choice is the unfiltered one, and the pill is marked while anything else is
 * chosen. Group names are the members' own words and are never translated.
 */

/** Story points of some tasks — an estimate, or 1 without one — and how many had no estimate. */
export function sumPoints(tasks: Pick<TaskSummary, "effort">[]): { points: number; unestimated: number } {
  let points = 0, unestimated = 0;
  for (const x of tasks) {
    points += effectivePoints(x.effort);
    if (x.effort === null) unestimated += 1;
  }
  return { points, unestimated };
}

/** "5 pts" — read in full to a screen reader, saying how many of them were not estimated. */
export function PointsSum({ tasks, points: given }: { tasks?: Pick<TaskSummary, "effort">[]; points?: { points: number; unestimated: number } }) {
  const t = useT().together.work;
  const { points, unestimated } = given ?? sumPoints(tasks ?? []);
  const full = t.pointsSum(points, unestimated);
  return (
    <span className="tg-pts" title={full}>
      <span aria-hidden="true">{t.pts(points)}</span>
      <span className="sr-only">{full}</span>
    </span>
  );
}

export interface FilterOption { key: string; label: string; divided?: boolean }

/** A pill that opens a menu of choices. The first option is "no filter". */
export function FilterMenu({ label, value, options, onChange }: {
  label: string; value: string; options: FilterOption[]; onChange: (key: string) => void;
}) {
  const t = useT().together.work;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = options.find((o) => o.key === value) ?? options[0];
  const items: MenuItem[] = options.map((o) => ({
    key: o.key, label: o.label, divided: o.divided, current: o.key === current.key, onSelect: () => onChange(o.key),
  }));
  return (
    <>
      <button type="button" className="tg-filter" aria-haspopup="menu" aria-expanded={anchor !== null}
        data-active={current.key !== options[0].key || undefined} onClick={(e) => setAnchor(e.currentTarget)}>
        <span className="tg-filter-what">{label}</span>
        <span className="tg-filter-value">{current.label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {anchor && <Menu anchor={anchor} title={label} currentLabel={t.currentStage} items={items} onClose={() => setAnchor(null)} />}
    </>
  );
}

/** All groups, each of the space's groups, and the tasks without one. */
export function GroupFilter({ groups, value, onChange }: { groups: GroupView[]; value: GroupChoice; onChange: (g: GroupChoice) => void }) {
  const t = useT().together.work;
  return (
    <FilterMenu label={t.groupFilter} value={value} onChange={onChange} options={[
      { key: "all", label: t.allGroups },
      ...groups.map((g, i) => ({ key: g.id, label: g.name, divided: i === 0 })),
      { key: "none", label: t.ungrouped, divided: true },
    ]} />
  );
}
