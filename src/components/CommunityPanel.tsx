"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import type { CommunitySnapshot } from "@/lib/community";

/**
 * Community Progress at a glance, for the side rail on Today.
 *
 * A summary, not a second implementation: it reads the same `/api/community`
 * the full page reads, so the rank shown here and the rank shown there cannot
 * disagree. Nothing about the calculation lives in this file.
 *
 * Deliberately quiet. It sits beside the list you came to tick off, so it
 * shows five names rather than ten and says nothing about anyone falling
 * behind — the point is a glance and a sense of company, and anything more
 * insistent would compete with the work.
 *
 * It renders nothing at all until it has data. A skeleton in a rail is motion
 * in the corner of your eye while you are trying to check off a habit, and an
 * error box for a panel nobody asked for is worse than its absence — the full
 * page reports failures properly.
 */
export default function CommunityPanel() {
  const t = useT();
  const [data, setData] = useState<CommunitySnapshot | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/community")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setData(d); })
      .catch(() => { /* the full page is where a failure is worth reporting */ });
    return () => { live = false; };
  }, []);

  if (!data) return null;

  const top = data.top.slice(0, 5);
  const month = t.community.monthNames[Number(data.month.split("-")[1]) - 1];

  return (
    <section className="card p-4">
      <div className="eyebrow" style={{ fontSize: 10 }}>{t.community.title}</div>
      <div className="mt-0.5" style={{ fontSize: 12.5, fontWeight: 500 }}>
        {month} · {t.community.liveRanking}
      </div>

      {data.me ? (
        <div className="flat p-3 mt-3 flex items-baseline justify-between gap-2">
          <span>
            <span className="faint block" style={{ fontSize: 11 }}>{t.community.myRank}</span>
            <span className="display" style={{ fontSize: 19 }}>
              {t.community.rankOf(data.me.rank, data.activeUsers)}
            </span>
          </span>
          <span className="text-right">
            <span className="faint block" style={{ fontSize: 11 }}>{t.community.myCompleteness}</span>
            <span className="display" style={{ fontSize: 19 }}>{data.me.pct}%</span>
          </span>
        </div>
      ) : (
        <p className="muted mt-3" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {t.community.noneScheduled}
        </p>
      )}

      <div className="mt-3">
        {top.map((e) => (
          <div key={`${e.rank}-${e.name}`}
            className="flex items-center justify-between gap-2 py-1.5"
            style={e.isMe ? { fontWeight: 600 } : undefined}>
            <span className="flex items-center gap-2" style={{ minWidth: 0 }}>
              <span className="faint num" style={{ fontSize: 11.5, minWidth: 18 }}>#{e.rank}</span>
              {/* A long username truncates rather than pushing the percentage
                  out of a 300px column. */}
              <span style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.isMe ? t.community.you : e.name}
              </span>
            </span>
            <span className="num" style={{ fontSize: 13.5, flex: "none" }}>{e.pct}%</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 mt-3">
        <span className="faint" style={{ fontSize: 11.5 }}>
          {data.activeUsers} · {t.community.activeUsers}
        </span>
        <Link href="/community" className="btn" style={{ padding: "5px 11px", fontSize: 12.5 }}>
          {t.community.view}
        </Link>
      </div>
    </section>
  );
}
