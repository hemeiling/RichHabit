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
 */
export default function Community() {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<CommunitySnapshot | null>(null);
  const [error, setError] = useState(false);

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

  // Shown only when they are outside the ten already listed, so their row is
  // never duplicated.
  const meOutsideTop = data.me && !data.top.some((e) => e.isMe) ? data.me : null;

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="eyebrow mb-1">{t.community.title}</div>
        {/* "August · Live Ranking" — the month makes the window explicit and
            "live" says the order will move as the month goes on. In bilingual
            mode both halves already carry both languages. */}
        <div className="mb-3" style={{ fontSize: 13.5, fontWeight: 500 }}>
          {t.community.monthNames[Number(data.month.split("-")[1]) - 1]} · {t.community.liveRanking}
        </div>

        {/* Each figure claims its own column and wraps as a block on a narrow
            phone. Laid out as free-flowing inline items, "#1 of 2" and the
            active-user count ended up side by side with only a gap between
            them, which reads as one number at 320-390px. */}
        <div className="flex flex-wrap" style={{ gap: 14, rowGap: 12 }}>
          {/* The rank is the one figure made of words ("第 1 名 / 共 2 人"), so it
              asks for a wider column. On a phone that sends it to the second row
              rather than letting it spill past the card. */}
          {[
            [t.community.myCompleteness, data.me ? `${data.me.pct}%` : "—", 96],
            [t.community.myAccomplishments, data.me ? String(data.me.accomplishments) : "—", 96],
            [t.community.myRank, data.me ? t.community.rankOf(data.me.rank, data.activeUsers) : "—", 160],
            [t.community.activeUsers, String(data.activeUsers), 96],
          ].map(([label, value, basis]) => (
            // A column, values pushed to the foot: when one label wraps to two
            // lines, every figure on that row still sits on the same baseline.
            <div key={label} style={{
              flex: `1 1 ${basis}px`, minWidth: 96,
              display: "flex", flexDirection: "column", justifyContent: "space-between",
            }}>
              <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.3 }}>{label}</div>
              {/* Rank is words as well as digits, so it needs the smaller of
                  the two sizes to sit on one line in a narrow column. */}
              <div className="count" style={{ fontSize: 24, whiteSpace: "nowrap" }}>{value}</div>
            </div>
          ))}
        </div>

        {!data.me && (
          <p className="muted mt-3" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            {t.community.noneScheduled}
          </p>
        )}

        <p className="faint mt-3" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {t.community.basis} · {t.community.unweightedNote}
        </p>
        <p className="faint mt-1" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {t.community.accomplishmentsNote}
        </p>
      </section>

      <section className="card px-5 py-2">
        <div className="divide">
          {data.top.map((e) => (
            <div key={`${e.rank}-${e.name}`}
              className="py-3.5 flex items-center justify-between gap-3"
              style={e.isMe ? { fontWeight: 600 } : undefined}>
              <span className="flex items-center gap-3">
                <span className="faint" style={{ fontSize: 13, minWidth: 26 }}>#{e.rank}</span>
                {/* The username always shows, marked rather than replaced, so
                    you can read your own row exactly as everyone else reads it. */}
                <span style={{ fontSize: 15 }}>
                  {e.name}
                  {e.isMe && <span className="faint" style={{ marginLeft: 6 }}>{t.community.youTag}</span>}
                </span>
              </span>
              <Figures pct={e.pct} accomplishments={e.accomplishments} />
            </div>
          ))}
          {!data.top.length && (
            <p className="py-4 muted" style={{ fontSize: 14 }}>{t.community.empty}</p>
          )}
        </div>
      </section>

      {meOutsideTop && (
        <section className="card px-5 py-2">
          <div className="py-3.5 flex items-center justify-between gap-3" style={{ fontWeight: 600 }}>
            <span className="flex items-center gap-3">
              <span className="faint" style={{ fontSize: 13, minWidth: 26 }}>#{meOutsideTop.rank}</span>
              <span style={{ fontSize: 15 }}>
                {meOutsideTop.name}
                <span className="faint" style={{ marginLeft: 6 }}>{t.community.youTag}</span>
              </span>
            </span>
            <Figures pct={meOutsideTop.pct} accomplishments={meOutsideTop.accomplishments} />
          </div>
        </section>
      )}

      <p className="faint text-center" style={{ fontSize: 12 }}>
        {t.community.month}: {data.month} · {t.community.updated}{" "}
        {instantDateFor(data.updatedAt, locale)}
      </p>
    </div>
  );
}

/**
 * A member's two figures, stacked so they never read as one number. The habit
 * percentage is what the ranking uses; the accomplishment count is descriptive
 * context beneath it, a count and nothing more.
 */
function Figures({ pct, accomplishments }: { pct: number; accomplishments: number }) {
  const t = useT();
  return (
    <span className="text-right" style={{ flex: "none" }}>
      <span className="block" style={{ fontSize: 15 }}>
        {pct}% <span className="faint" style={{ fontSize: 12, fontWeight: 400 }}>{t.community.habitsSuffix}</span>
      </span>
      <span className="faint block num" style={{ fontSize: 12, fontWeight: 400 }}>
        {t.community.accomplishedCount(accomplishments)}
      </span>
    </span>
  );
}
