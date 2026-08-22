"use client";
import { useEffect, useState } from "react";
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
    fetch("/api/community")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
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
          {[
            [t.community.myCompleteness, data.me ? `${data.me.pct}%` : "—"],
            [t.community.myRank, data.me ? t.community.rankOf(data.me.rank, data.activeUsers) : "—"],
            [t.community.activeUsers, String(data.activeUsers)],
          ].map(([label, value]) => (
            <div key={label} style={{ flex: "1 1 96px", minWidth: 96 }}>
              <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.3 }}>{label}</div>
              {/* Rank is words as well as digits, so it needs the smaller of
                  the two sizes to sit on one line in a narrow column. */}
              <div className="display" style={{ fontSize: 26, whiteSpace: "nowrap" }}>{value}</div>
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
              <span style={{ fontSize: 15 }}>{e.pct}%</span>
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
            <span style={{ fontSize: 15 }}>{meOutsideTop.pct}%</span>
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
