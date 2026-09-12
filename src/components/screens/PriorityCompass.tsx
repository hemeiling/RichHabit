"use client";
import ImportantDates from "@/components/ImportantDates";
import Priorities from "@/components/Priorities";
import { useToday } from "@/components/useToday";

/**
 * Priority Compass — a forward-looking planning workspace.
 *
 * Two peers on one page: the matrix answers "what deserves my attention now?"
 * and Important Dates answers "what is coming up?". The past has its own home,
 * Accomplishments in Insights, so this page no longer browses previous days.
 *
 * That is a change of interface, not of history. The matrix still derives what
 * belongs on a day from the rollover rule in lib/priorities — an unfinished
 * priority satisfies it on every day up to today, a completed one on the day it
 * was finished and not after — and every row stays in the database. `prioritiesOn`
 * keeps its date parameter and its tests, and Insights reads the same rows back.
 *
 * Today's date is passed rather than chosen. `useToday` moves it on when someone
 * returns to a tab left open overnight, which is when yesterday's completed
 * lines should quietly leave and unfinished ones carry forward.
 *
 * No date heading. The matrix card already titles itself "Today's priorities"
 * and the calendar beside it marks today, so a large date above the matrix was
 * a navigation control with nothing left to navigate. Without it the two panels
 * start on the same line and read as one composition.
 *
 * Below 1280px the grid collapses in document order: the matrix, then the
 * calendar.
 */
export default function PriorityCompass() {
  const today = useToday();

  return (
    <div className="with-rail">
      <Priorities date={today} />
      <aside className="rail flex flex-col gap-4">
        <ImportantDates />
      </aside>
    </div>
  );
}
