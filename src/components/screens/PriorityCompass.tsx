"use client";
import { useState } from "react";
import ImportantDates from "@/components/ImportantDates";
import Priorities from "@/components/Priorities";
import { addDays, todayISO } from "@/lib/dates";
import { prettyDateFor } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/context";

/**
 * Priority Compass — what deserves my attention, and what is coming up.
 *
 * A composition, not a feature. `Priorities` is the four-quadrant matrix
 * exactly as it rendered inside Today: same boxes, same cards, same two ways to
 * file a line, same planning popover, same writes. `ImportantDates` is the same
 * calendar that sat in Today's rail, with its own month navigation untouched.
 * Neither component was edited to be put here, and neither reads or writes
 * anything differently than before.
 *
 * The two belong on one page because a priority is a judgement about time and a
 * calendar is what time actually holds. Deciding what matters this week reads
 * differently when the trip on Thursday is in the same view.
 *
 * The rail puts them side by side on a wide screen rather than stacking them,
 * so the matrix keeps roughly the width it had on Today — the point of the move
 * was a new address, not new dimensions. Below 1280px the grid collapses and
 * the calendar follows the matrix down the page, which on a phone gives the
 * four boxes the full width and puts what is coming up underneath.
 */
export default function PriorityCompass() {
  const t = useT();
  const locale = useLocale();

  /**
   * The day on screen.
   *
   * This is what preserves the historical view the matrix has always had. A
   * priority is not owned by a day — an unfinished one satisfies the rollover
   * rule on every day up to now, which is why nothing has to run for it to
   * carry forward — so the date does two things and no more: it is the day a
   * completion gets recorded against, and it is the day the board is
   * reconstructed as at. Reading back to last Tuesday shows what was genuinely
   * outstanding then, including lines finished since.
   *
   * It lived in Today's day header, which is habit content and is Rich Habits
   * now, so the control is here. The matrix component already took a date and
   * needed no change to accept this one.
   */
  const [date, setDate] = useState(todayISO());
  const isToday = date === todayISO();

  return (
    <div className="with-rail">
      <div className="flex flex-col gap-4">
        {/*
          * The day, and a way to step back through it. Deliberately not a card:
          * the matrix below is the page, and a second panel above it would read
          * as another thing to work through. Same display face and the same
          * quiet arrows as the top of Rich Habits' header, so the two pages are
          * recognisably the same app.
          */}
        <div className="flex items-end justify-between gap-3">
          {/*
            * The date alone, with no eyebrow above it.
            *
            * Rich Habits puts a "TODAY" kicker over the same date, but there it
            * is the top of a card that goes on to hold the score. Here the date
            * IS the page heading, and the card immediately below it already
            * announces itself as today's priorities — a kicker would be the
            * same word twice, two lines apart.
            */}
          <h1 className="display" style={{ fontSize: 23, lineHeight: 1.15, minWidth: 0 }}>
            {prettyDateFor(date, locale)}
          </h1>
          <div className="flex gap-1" style={{ flex: "none" }}>
            <button className="btn btn-quiet" style={{ padding: "8px 12px" }}
              onClick={() => setDate(addDays(date, -1))} aria-label={t.common.previousDay}>‹</button>
            {/* Forward stops at today, as it does on Rich Habits: the board has
                nothing to say about a day that has not happened. */}
            <button className="btn btn-quiet" style={{ padding: "8px 12px" }} disabled={isToday}
              onClick={() => setDate(addDays(date, 1))} aria-label={t.common.nextDay}>›</button>
          </div>
        </div>

        <Priorities date={date} />
      </div>

      {/*
        * What is coming up, beside what deserves attention. The calendar keeps
        * its own month navigation and its own sense of today — it is a calendar
        * you glance at, not a second view of the day being read above, so the
        * date control does not drive it. That is how it behaved in Today's rail
        * and it behaves no differently here.
        */}
      <aside className="rail flex flex-col gap-4">
        <ImportantDates />
      </aside>
    </div>
  );
}
