"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useHabits } from "@/components/store";
import { useLocale, useT } from "@/lib/i18n/context";
import { monthTitleFor } from "@/lib/i18n";
import { dayScore, rangeScore } from "@/lib/habits";
import { monthOf, monthSoFar, todayISO } from "@/lib/dates";
import type { Dict } from "@/lib/i18n";
import { pointCount, runsOf } from "@/lib/trend";
import type { AppState } from "@/lib/types";
import type { CommunitySnapshot } from "@/lib/community";

/**
 * §20. The Today rail's progress card: your own month first, the board second.
 *
 * It used to be the board and only the board, which answered "how am I doing?"
 * with "here is where you rank" — a comparison, before the person had seen
 * their own month. So the default view is now theirs: a line of daily
 * completion across this month, and the month-to-date figure above it. The
 * ranking is one tap away and unchanged.
 *
 * Every number here comes from `dayScore` / `rangeScore`, the same functions
 * Today's dial and Insights use, computed from state the browser already holds.
 * There is no second scoring rule and no extra request: a chart that disagreed
 * with the dial above it would be worse than no chart.
 *
 * Three percentages are visible within a screen of each other and they measure
 * different spans — today, this month, and this month measured the same way for
 * everyone. Each says which it is.
 */

/** How the two views are told apart in state and in the switch. */
type View = "mine" | "community";

/* ------------------------------- the chart -------------------------------- */

/**
 * A month of daily completion, drawn small.
 *
 * Deliberately not `Spark` from ui.tsx: that scales its y-axis to the data, so
 * a month spent between 60% and 70% would climb dramatically across the card.
 * A completion rate has a real ceiling, and "am I improving?" is only an honest
 * question against a fixed 0-100. Days with nothing scheduled are gaps rather
 * than zeroes — nothing was asked of you, so nothing was missed.
 */
function MonthTrend({ points, today }: {
  points: { date: string; pct: number | null }[];
  today: string;
}) {
  const t = useT();
  const W = 268, H = 56, PAD = 3;
  /* One path per unbroken run, so a gap stays a gap — see lib/trend. */
  const runs = runsOf(points.map((p) => p.pct));
  if (pointCount(runs) < 2) {
    return <p className="faint mt-2" style={{ fontSize: 12, lineHeight: 1.5 }}>{t.progress.tooEarly}</p>;
  }

  const x = (i: number) => PAD + (i / Math.max(1, points.length - 1)) * (W - PAD * 2);
  const y = (pct: number) => PAD + (1 - pct / 100) * (H - PAD * 2);

  const todayIndex = points.findIndex((p) => p.date === today);
  const todayPct = todayIndex >= 0 ? points[todayIndex].pct : null;

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      role="img" aria-label={t.progress.explain} style={{ display: "block", marginTop: 6 }}>
      {/* Quarter lines, so the height of the line means something at a glance. */}
      {[0, 50, 100].map((p) => (
        <line key={p} x1={0} x2={W} y1={y(p)} y2={y(p)}
          stroke="var(--line-soft)" strokeWidth="1" />
      ))}
      {runs.map((run, n) => (
        <polyline
          key={n}
          points={run.map((s) => `${x(s.index)},${y(s.value)}`).join(" ")}
          fill="none" stroke="var(--accent)" strokeWidth="1.8"
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* Today, marked. It is the point the reader is looking for. */}
      {todayPct !== null && todayIndex >= 0 && (
        <circle cx={x(todayIndex)} cy={y(todayPct)} r="3.2"
          fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />
      )}
    </svg>
  );
}

/* ----------------------------- my own month ------------------------------- */

function MyProgress({ state }: { state: AppState }) {
  const t = useT();
  const locale = useLocale();
  const today = todayISO();
  const month = monthOf(today);

  /*
   * Every day of the month so far. `dayScore` is the source of truth — the same
   * call Today's dial makes — so the last point on this line and the dial above
   * it are the same measurement of the same day, and the month-to-date figure
   * is `rangeScore` over exactly these days.
   */
  const { points, mtd } = useMemo(() => {
    const days = monthSoFar(today);
    return {
      points: days.map((date) => ({ date, pct: dayScore(state, date).pct })),
      mtd: rangeScore(state, days),
    };
  }, [state, today]);

  const scored = points.filter((p) => p.pct !== null);
  const todayPct = points[points.length - 1]?.pct ?? null;

  return (
    <>
      <div className="flat p-3 mt-3">
        <span className="faint block" style={{ fontSize: 11 }}>{t.progress.monthToDate}</span>
        <span className="display" style={{ fontSize: 26, lineHeight: 1.1 }}>
          {mtd.pct === null ? "—" : `${mtd.pct}%`}
        </span>
        {todayPct !== null && (
          <span className="faint num" style={{ fontSize: 11.5, marginLeft: 8 }}>
            {t.progress.todayIs(todayPct)}
          </span>
        )}
      </div>

      {scored.length === 0 ? (
        <p className="muted mt-3" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{t.progress.noneYet}</p>
      ) : (
        <>
          <div className="eyebrow mt-3" style={{ fontSize: 10 }}>
            {t.progress.thisMonth(monthTitleFor(month, locale))}
          </div>
          <MonthTrend points={points} today={today} />
          <div className="flex justify-between faint num" style={{ fontSize: 10.5, marginTop: 2 }}>
            <span>1</span>
            <span>{Number(today.slice(8, 10))}</span>
          </div>
          {/* The labels that stop three percentages reading as a contradiction. */}
          <p className="faint mt-2" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
            {t.progress.explain}
            {/* Only when this card can show two different month figures: the
                reader's own is weighted by priority, the board's never is. */}
            {state.prefs.weighted && ` ${t.progress.weightedNote}`}
          </p>
        </>
      )}
    </>
  );
}

/* ------------------------------ the board --------------------------------- */

/**
 * Unchanged in substance: the same `/api/community` the full page reads, so the
 * rank here and the rank there cannot disagree. Nothing about the calculation
 * lives in this file.
 */
function Community({ visible, onShowMe }: { visible: boolean; onShowMe: (v: boolean) => void }) {
  const t = useT();
  const [data, setData] = useState<CommunitySnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null);
    setFailed(false);
    fetch("/api/community")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) setData(d); })
      // The full page is where a failure is worth reporting properly; here it
      // must simply not be mistaken for an empty board.
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [visible]);

  const top = data?.top.slice(0, 5) ?? [];
  const month = data ? t.community.monthNames[Number(data.month.split("-")[1]) - 1] : "";

  return (
    <>
      {data && (
        <div className="mt-0.5" style={{ fontSize: 12.5, fontWeight: 500 }}>
          {month} · {t.community.liveRanking}
        </div>
      )}

      {failed && (
        <p className="muted mt-3" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {t.community.unavailable}
        </p>
      )}

      {!visible ? (
        <div className="flat p-3 mt-3">
          <p style={{ fontSize: 12.5, lineHeight: 1.5 }}>{t.progress.hidden}</p>
          <p className="faint mt-1" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
            {t.progress.hiddenHint}
          </p>
        </div>
      ) : data?.me ? (
        <div className="flat p-3 mt-3 flex items-baseline justify-between gap-2">
          <span>
            <span className="faint block" style={{ fontSize: 11 }}>{t.community.myRank}</span>
            <span className="display" style={{ fontSize: 19 }}>
              {t.community.rankOf(data.me.rank, data.activeUsers)}
            </span>
          </span>
          <span className="text-right">
            <span className="faint block" style={{ fontSize: 11 }}>{t.community.monthToDate}</span>
            <span className="display" style={{ fontSize: 19 }}>{data.me.pct}%</span>
          </span>
        </div>
      ) : data ? (
        <p className="muted mt-3" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {t.community.noneScheduled}
        </p>
      ) : null}

      {visible && data && (
        <>
          <div className="mt-3">
            {top.map((e) => (
              <div key={`${e.rank}-${e.name}`}
                className="flex items-center justify-between gap-2 py-1.5"
                style={e.isMe ? { fontWeight: 600 } : undefined}>
                <span className="flex items-center gap-2" style={{ minWidth: 0 }}>
                  <span className="faint num" style={{ fontSize: 11.5, minWidth: 18 }}>#{e.rank}</span>
                  {/* The real username, so you can see how you appear to
                      everyone else, with the tag appended rather than replacing it. */}
                  <span style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.name}
                    {e.isMe && <span className="faint" style={{ marginLeft: 5 }}>{t.community.youTag}</span>}
                  </span>
                </span>
                <span className="num" style={{ fontSize: 13.5, flex: "none" }}>{e.pct}%</span>
              </div>
            ))}
          </div>
          <p className="faint mt-1" style={{ fontSize: 11, lineHeight: 1.4 }}>
            {t.community.unweightedNote}
          </p>
        </>
      )}

      {/* The control belongs here, where the consequence is on screen. It is
          also in More → Account, for anyone who looks for privacy in settings. */}
      <div className="flex items-start gap-2.5 mt-3">
        <button className="tick" data-on={visible} role="switch" aria-checked={visible}
          aria-label={t.progress.showMe}
          style={{ width: 22, height: 22, borderRadius: 7, marginTop: 1 }}
          onClick={() => onShowMe(!visible)}>
          {visible && (
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M4.5 10.5l3.6 3.6L15.5 6.8" stroke="var(--accent-ink)"
                strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <span style={{ fontSize: 12, lineHeight: 1.4 }} aria-hidden="true">{t.progress.showMe}</span>
      </div>

      <div className="flex items-center justify-between gap-2 mt-3">
        <span className="faint" style={{ fontSize: 11.5 }}>
          {visible && data ? `${data.activeUsers} · ${t.community.activeUsers}` : ""}
        </span>
        <Link href="/community" className="btn" style={{ padding: "5px 11px", fontSize: 12.5 }}>
          {t.community.view}
        </Link>
      </div>
    </>
  );
}

/* ------------------------------- the card --------------------------------- */

export default function ProgressPanel() {
  const { state, actions } = useHabits();
  const t = useT();
  const [view, setView] = useState<View>("mine");

  const label = (v: View, d: Dict) => (v === "mine" ? d.progress.mine : d.progress.community);

  return (
    <section className="card p-4" aria-labelledby="progress-panel-title">
      {/* A stable name for the card. The tabs below say which view is showing;
          repeating the selected tab's own words up here said nothing twice. */}
      <div className="eyebrow" id="progress-panel-title" style={{ fontSize: 10 }}>
        {t.progress.title}
      </div>

      {/* Two views, one card. Tabs rather than a second card, because they
          answer the same question at two scopes and only one is wanted at a time. */}
      <div className="flex gap-1.5 mt-2" role="tablist">
        {(["mine", "community"] as const).map((v) => (
          <button key={v} type="button" className="chip" data-on={view === v}
            role="tab" aria-selected={view === v}
            aria-label={t.progress.switchTo(label(v, t))}
            style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => setView(v)}>
            {label(v, t)}
          </button>
        ))}
      </div>

      {view === "mine"
        ? <MyProgress state={state} />
        : (
          <Community
            visible={state.prefs.communityVisible}
            onShowMe={(communityVisible) => actions.setPrefs({ communityVisible })}
          />
        )}
    </section>
  );
}
