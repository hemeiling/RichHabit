"use client";
import { useEffect, useState } from "react";
import { fetchCommunity } from "@/lib/db";
import { useLocale, useT } from "@/lib/i18n/context";
import { instantDateFor } from "@/lib/i18n";
import type { CommunitySnapshot } from "@/lib/community";

/**
 * Community Progress.
 *
 * Framed as company rather than contest: the heading is progress, your own
 * standing is stated once and plainly, and nobody below you is presented as
 * someone you beat. The list is short on purpose — ten entries and your own
 * row is enough to feel part of something without turning a habit tracker
 * into a scoreboard.
 *
 * Two rankings, one at a time. Habits are consistency and accomplishments are
 * what got done; they are different units, so each has its own tab, its own
 * rank and its own list, and no row ever carries two ranks to reconcile.
 */
type Board = "habits" | "accomplishments";

/** `unit` is quiet and drops away on a phone, where the tab already names it. */
interface Row { rank: number; name: string; isMe: boolean; figure: string; unit?: string; label?: string }

export default function Community() {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<CommunitySnapshot | null>(null);
  const [error, setError] = useState(false);
  const [board, setBoard] = useState<Board>("habits");

  useEffect(() => {
    let live = true;
    fetchCommunity()
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, []);

  if (error) {
    return <p className="card p-5 muted" style={{ fontSize: 14 }}>{t.community.unavailable}</p>;
  }
  if (!data) {
    return <p className="card p-5 faint" style={{ fontSize: 14 }}>{t.common.loading}</p>;
  }

  const acc = data.accomplishments;
  const habits = board === "habits";
  /* `mine` is null only when the reader is not on either board at all — they
     have hidden themselves — which is a different message from "not yet". */
  const hidden = acc.mine === null;

  const rows: Row[] = habits
    ? data.top.map((e) => ({ rank: e.rank, name: e.name, isMe: e.isMe, figure: `${e.pct}%` }))
    : acc.top.map((e) => ({
      rank: e.rank, name: e.name, isMe: e.isMe, figure: String(e.count),
      unit: t.community.accomplishmentsUnit(e.count), label: t.community.accomplishmentsCount(e.count),
    }));

  // Shown only when they are outside the ten already listed, so their row is
  // never duplicated.
  const meRow: Row | null = habits
    ? (data.me && !data.top.some((e) => e.isMe)
      ? { rank: data.me.rank, name: data.me.name, isMe: true, figure: `${data.me.pct}%` } : null)
    : (acc.me && !acc.top.some((e) => e.isMe)
      ? {
        rank: acc.me.rank, name: acc.me.name, isMe: true, figure: String(acc.me.count),
        unit: t.community.accomplishmentsUnit(acc.me.count), label: t.community.accomplishmentsCount(acc.me.count),
      } : null);

  const figures: [string, string, number][] = habits
    ? [
      [t.community.myCompleteness, data.me ? `${data.me.pct}%` : "—", 96],
      [t.community.myRank, data.me ? t.community.rankOf(data.me.rank, data.activeUsers) : "—", 160],
      [t.community.activeUsers, String(data.activeUsers), 96],
    ]
    : [
      [t.community.accomplishmentsThisMonth, acc.mine === null ? "—" : String(acc.mine), 96],
      [t.community.myRank, acc.me ? t.community.rankOf(acc.me.rank, acc.members) : "—", 160],
    ];

  const notRanked = habits ? !data.me : !acc.me;

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="eyebrow mb-1">{t.community.title}</div>
        {/* "September · Live Ranking" — the month makes the window explicit and
            "live" says the order will move as the month goes on. */}
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>
          {t.community.monthNames[Number(data.month.split("-")[1]) - 1]} · {t.community.liveRanking}
        </div>

        {/* The two rankings. Chips, the same quiet control the progress card
            uses, rather than anything that reads as a contest. */}
        <div className="flex flex-wrap gap-1.5 mt-3 mb-4" role="tablist" aria-label={t.community.title}>
          {(["habits", "accomplishments"] as const).map((b) => (
            <button key={b} type="button" role="tab" className="chip" data-on={board === b}
              aria-selected={board === b} onClick={() => setBoard(b)}
              style={{ padding: "6px 12px", fontSize: 13 }}>
              {b === "habits" ? t.community.habitRanking : t.community.accomplishmentRanking}
            </button>
          ))}
        </div>

        {/* Each figure claims its own column and wraps as a block on a narrow
            phone. Laid out as free-flowing inline items, "#1 of 2" and the
            active-user count ended up side by side with only a gap between
            them, which reads as one number at 320-390px. The rank is the one
            figure made of words, so it asks for a wider column. */}
        <div className="flex flex-wrap" style={{ gap: 14, rowGap: 12 }} role="tabpanel">
          {figures.map(([label, value, basis]) => (
            // A column, values pushed to the foot: when one label wraps to two
            // lines, every figure on that row still sits on the same baseline.
            <div key={label} style={{
              flex: `1 1 ${basis}px`, minWidth: 96,
              display: "flex", flexDirection: "column", justifyContent: "space-between",
            }}>
              <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.3 }}>{label}</div>
              {/* Numbers never break; the rank is words and may wrap, which in
                  bilingual mode on a phone is the difference between fitting
                  and running off the card. */}
              <div className="count" style={{ fontSize: 24, whiteSpace: basis === 160 ? "normal" : "nowrap" }}>{value}</div>
            </div>
          ))}
        </div>

        {hidden ? (
          <p className="muted mt-3" style={{ fontSize: 13.5, lineHeight: 1.5 }}>{t.progress.hidden}</p>
        ) : notRanked && (
          <p className="muted mt-3" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            {habits ? t.community.noneScheduled : t.community.accomplishmentNotRanked}
          </p>
        )}

        <p className="faint mt-3" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {habits
            ? `${t.community.basis} · ${t.community.unweightedNote}`
            : `${t.community.accomplishmentBasis} · ${t.community.accomplishmentPrivacy}`}
        </p>
        <p className="faint mt-1" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {t.community.separateRankings}
        </p>
      </section>

      <section className="card px-5 py-2" aria-label={habits ? t.community.habitRanking : t.community.accomplishmentRanking}>
        <div className="divide">
          {rows.map((e) => <RankRow key={`${e.rank}-${e.name}`} row={e} />)}
          {!rows.length && (
            <p className="py-4 muted" style={{ fontSize: 14 }}>
              {habits ? t.community.empty : t.community.accomplishmentEmpty}
            </p>
          )}
        </div>
      </section>

      {meRow && (
        <section className="card px-5 py-2">
          <RankRow row={meRow} />
        </section>
      )}

      <p className="faint text-center" style={{ fontSize: 12 }}>
        {t.community.month}: {data.month} · {t.community.updated}{" "}
        {instantDateFor(data.updatedAt, locale)}
      </p>
    </div>
  );
}

/** One place, one name, one figure. The same row for either ranking. */
function RankRow({ row }: { row: Row }) {
  const t = useT();
  return (
    <div className="py-3.5 flex items-center justify-between gap-3"
      style={row.isMe ? { fontWeight: 600 } : undefined}>
      <span className="flex items-center gap-3" style={{ minWidth: 0 }}>
        <span className="faint num" style={{ fontSize: 13, minWidth: 26 }}>#{row.rank}</span>
        {/* The username always shows, marked rather than replaced, so you can
            read your own row exactly as everyone else reads it. */}
        <span style={{ fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.name}
          {row.isMe && <span className="faint" style={{ marginLeft: 6 }}>{t.community.youTag}</span>}
        </span>
      </span>
      <span className="num" style={{ fontSize: 14.5, flex: "none", textAlign: "right" }} aria-label={row.label}>
        {row.figure}
        {row.unit && <span className="faint rank-unit" style={{ fontSize: 12.5, fontWeight: 400, marginLeft: 5 }}>{row.unit}</span>}
      </span>
    </div>
  );
}
