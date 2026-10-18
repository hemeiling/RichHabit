"use client";
import { useEffect, useMemo, useState } from "react";
import { useHabits } from "@/components/store";
import { accomplishedBetween } from "@/lib/accomplishments";
import { monthSoFar, todayISO } from "@/lib/dates";
import { fetchCommunity } from "@/lib/db";
import { dayScore, rangeScore } from "@/lib/habits";
import { useT } from "@/lib/i18n/context";
import type { CommunitySnapshot } from "@/lib/community";

/**
 * §20. Community Progress, where the work it measures happens.
 *
 * One card, two configurations, each on its own page's rail:
 *  - `habits` on Rich Habits — "Monthly Habit Accomplishments", the
 *    month-to-date scheduled-completion percentage everyone is ranked by;
 *  - `priorities` on Priority Compass — "Monthly Priority Accomplishments",
 *    the month's completed-priority count.
 * The standalone Community page used to hold both behind tabs; these cards
 * replaced it, so comparing yourself to the group never means leaving the
 * page you are working on. Same board, same `/api/community`, same privacy:
 * nothing about the measurement moved here, only where it is read.
 *
 * The three figures above the list are the reader's own: their rank (the
 * board's), today, and the month to date — the last two computed from state
 * the browser already holds, by the same rules Insights uses (`dayScore`,
 * `rangeScore`, `accomplishedBetween`), so this card and Insights can never
 * disagree about the same number. Today is informational only; the ranking
 * is monthly and stays monthly.
 */

type Kind = "habits" | "priorities";

interface Row { rank: number; name: string; isMe: boolean; figure: string }

export default function CommunityCard({ kind }: { kind: Kind }) {
  const { state, actions } = useHabits();
  const t = useT();
  const visible = state.prefs.communityVisible;
  const [data, setData] = useState<CommunitySnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null);
    setFailed(false);
    fetchCommunity()
      .then((d) => { if (live) setData(d); })
      // A failure must simply not be mistaken for an empty board.
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [visible]);

  const today = todayISO();

  /* The reader's own two figures. Habits: percentages, "—" when nothing is
     scheduled (an empty day is not a 0% day). Priorities: counts, which have
     no empty case — a day with nothing finished is honestly 0.

     Habit figures are UNWEIGHTED here, whatever the reader's weighting
     preference: the board measures everyone unweighted (its footnote says
     so), and a card that showed "35%" above a row reading "you 30%" would
     contradict itself. The weighted view of your own month is Insights'. */
  const own = useMemo(() => {
    if (kind === "habits") {
      const flat = { ...state, prefs: { ...state.prefs, weighted: false } };
      const d = dayScore(flat, today);
      const m = rangeScore(flat, monthSoFar(today));
      return {
        today: d.pct === null ? null : `${d.pct}%`,
        mtd: m.pct === null ? null : `${m.pct}%`,
      };
    }
    const dates = monthSoFar(today);
    return {
      today: String(accomplishedBetween(state.priorities, today, today).length),
      mtd: String(accomplishedBetween(state.priorities, dates[0], today).length),
    };
  }, [state, kind, today]);

  const habits = kind === "habits";
  const title = habits ? t.community.boardHabitsMonthly : t.community.boardPrioritiesMonthly;
  const listLabel = habits ? t.community.habitRanking : t.community.accomplishmentRanking;

  /* The two boards, read into one shape. The ranking itself is the server's:
     rows, ranks and the reader's own rank come from the snapshot untouched. */
  const acc = data?.accomplishments;
  const board = !data ? null : habits
    ? {
      rows: data.top.map((e): Row => ({ rank: e.rank, name: e.name, isMe: e.isMe, figure: `${e.pct}%` })),
      me: data.me ? { rank: data.me.rank, name: data.me.name, figure: `${data.me.pct}%` } : null,
      of: data.activeUsers,
      empty: t.community.empty,
      note: t.community.unweightedNote,
    }
    : {
      rows: acc!.top.map((e): Row => ({ rank: e.rank, name: e.name, isMe: e.isMe, figure: String(e.count) })),
      me: acc!.me ? { rank: acc!.me.rank, name: acc!.me.name, figure: String(acc!.me.count) } : null,
      of: acc!.members,
      empty: t.community.accomplishmentEmpty,
      note: `${t.community.accomplishmentBasis} · ${t.community.accomplishmentPrivacy}`,
    };
  const month = data ? t.community.monthNames[Number(data.month.split("-")[1]) - 1] : "";
  // The reader's own row, under the list, when they are ranked beyond it.
  const meBelow = board?.me && !board.rows.some((r) => r.isMe) ? board.me : null;

  const rowLine = (e: Row, key: string) => (
    <div key={key} className="flex items-center justify-between gap-2 py-1.5"
      style={e.isMe ? { fontWeight: 600 } : undefined}>
      <span className="flex items-center gap-2" style={{ minWidth: 0 }}>
        <span className="faint num" style={{ fontSize: 11.5, minWidth: 22 }}>#{e.rank}</span>
        <span style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {e.name}
          {e.isMe && <span className="faint" style={{ marginLeft: 5 }}>{t.community.youTag}</span>}
        </span>
      </span>
      <span className="num" style={{ fontSize: 13.5, flex: "none" }}>{e.figure}</span>
    </div>
  );

  return (
    <section className="card p-4" aria-label={title}>
      <div className="eyebrow" style={{ fontSize: 10 }}>{t.community.title}</div>
      <div className="mt-0.5" style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
      {data && (
        <div className="muted mt-0.5" style={{ fontSize: 12 }}>{month} · {t.community.liveRanking}</div>
      )}

      {/* The reader's three figures: rank · today · the month so far. */}
      <div className="flat p-3 mt-3 grid grid-cols-3 gap-2">
        {([
          [t.community.myRank, visible && board?.me ? t.community.rankOf(board.me.rank, board.of) : "—"],
          [t.today.todayLabel, own.today ?? "—"],
          // Ranked: the board's own figure, so the summary and your row match
          // to the digit. Otherwise the same measure, computed locally.
          [t.community.monthToDate, (visible && board?.me ? board.me.figure : own.mtd) ?? "—"],
        ] as const).map(([label, value], i) => (
          <div key={label} style={{ minWidth: 0 }}>
            <span className="faint block" style={{ fontSize: 10.5, lineHeight: 1.3 }}>{label}</span>
            <span className="count block mt-0.5" style={{ fontSize: 16.5, lineHeight: 1.2 }}>{value}</span>
            {/* An empty day is not a 0% day: say so, visibly — a tooltip never
                appears on a phone. Habits only; a count has no empty case. */}
            {habits && i === 1 && own.today === null && (
              <span className="faint block" style={{ fontSize: 10, lineHeight: 1.3 }}>{t.community.noneToday}</span>
            )}
          </div>
        ))}
      </div>

      {failed && (
        <p className="muted mt-3" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{t.community.unavailable}</p>
      )}
      {!failed && !data && (
        <p className="faint mt-3" style={{ fontSize: 12.5 }}>{t.common.loading}</p>
      )}

      {!visible ? (
        <div className="flat p-3 mt-3">
          <p style={{ fontSize: 12.5, lineHeight: 1.5 }}>{t.progress.hidden}</p>
          <p className="faint mt-1" style={{ fontSize: 11.5, lineHeight: 1.45 }}>{t.progress.hiddenHint}</p>
        </div>
      ) : board && (
        <>
          <div className="mt-2" aria-label={listLabel}>
            {board.rows.map((e) => rowLine(e, `${e.rank}-${e.name}`))}
            {meBelow && (
              <>
                <div className="faint text-center" style={{ fontSize: 11, lineHeight: 1 }} aria-hidden="true">⋯</div>
                {rowLine({ ...meBelow, isMe: true }, "me")}
              </>
            )}
            {!board.rows.length && (
              <p className="faint py-1" style={{ fontSize: 12, lineHeight: 1.45 }}>{board.empty}</p>
            )}
          </div>
          <p className="faint mt-1" style={{ fontSize: 11, lineHeight: 1.4 }}>{board.note}</p>
        </>
      )}

      {/* The control stays where its consequence is on screen. One choice for
          both boards, as it has always been: shown on one, shown on both. */}
      <div className="flex items-start gap-2.5 mt-3">
        <button className="tick" data-on={visible} role="switch" aria-checked={visible}
          aria-label={t.progress.showMe}
          style={{ width: 22, height: 22, borderRadius: 7, marginTop: 1 }}
          onClick={() => actions.setPrefs({ communityVisible: !visible })}>
          {visible && (
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M4.5 10.5l3.6 3.6L15.5 6.8" stroke="var(--accent-ink)"
                strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <span style={{ fontSize: 12, lineHeight: 1.4 }} aria-hidden="true">{t.progress.showMe}</span>
      </div>

      {visible && data && (
        <p className="faint mt-2" style={{ fontSize: 11.5 }}>
          {board!.of} · {t.community.activeUsers}
        </p>
      )}
    </section>
  );
}
