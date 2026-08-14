"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useHabits } from "@/components/store";
import { Segmented } from "@/components/ui";
import LanguageToggle from "@/components/LanguageToggle";
import { useT } from "@/lib/i18n/context";
import { todayISO } from "@/lib/dates";

const LINKS = [
  { href: "/more/awareness", key: "awareness" },
  { href: "/more/goals", key: "goals" },
  { href: "/more/metrics", key: "metrics" },
  { href: "/more/stacks", key: "stacks" },
  { href: "/more/review", key: "review" },
] as const;

export default function More({ email }: { email: string }) {
  const { state, actions, saving } = useHabits();
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rich-habits-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const signOut = async () => {
    setBusy(true);
    // The session row is deleted server-side; the cookie clears with it.
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="card px-5 py-2">
        <div className="divide">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className="w-full text-left py-4 flex items-center justify-between gap-3">
              <span>
                <span className="block" style={{ fontSize: 15.5, fontWeight: 500 }}>{t.more.links[l.key].label}</span>
                <span className="faint block mt-0.5" style={{ fontSize: 13 }}>{t.more.links[l.key].note}</span>
              </span>
              <span className="faint" style={{ fontSize: 18 }}>›</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-3">{t.more.preferences}</div>
        <div className="flex items-center justify-between py-2 gap-3">
          <div>
            <div style={{ fontSize: 15 }}>{t.more.appearance}</div>
            <div className="faint" style={{ fontSize: 12.5 }}>{t.more.appearanceHint}</div>
          </div>
          <Segmented value={state.prefs.theme} onChange={(v) => actions.setPrefs({ theme: v })} small
            options={[{ value: "light" as const, label: t.more.light }, { value: "dark" as const, label: t.more.dark }]} />
        </div>
        <div className="flex items-center justify-between py-2 gap-3">
          <div>
            <div style={{ fontSize: 15 }}>{t.common.language}</div>
            <div className="faint" style={{ fontSize: 12.5 }}>{t.more.languageHint}</div>
          </div>
          <LanguageToggle small />
        </div>
        <div className="flex items-center justify-between py-2 gap-3">
          <div>
            <div style={{ fontSize: 15 }}>{t.more.weightedScore}</div>
            <div className="faint" style={{ fontSize: 12.5 }}>{t.more.weightedHint}</div>
          </div>
          <Segmented<boolean> value={state.prefs.weighted} onChange={(v) => actions.setPrefs({ weighted: v })} small
            options={[{ value: true, label: t.more.on }, { value: false, label: t.more.off }]} />
        </div>
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-2">{t.more.account}</div>
        <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          {t.more.signedInAs(email)}{" "}
          {saving ? t.common.savingEllipsis : t.common.allSaved}
        </p>
        <div className="flex gap-2 mt-3">
          <button className="btn" onClick={exportData}>{t.more.exportJson}</button>
          <button className="btn" disabled={busy} onClick={signOut}>{t.more.signOut}</button>
        </div>
      </section>

      <p className="faint text-center" style={{ fontSize: 12, lineHeight: 1.5 }}>
        {t.more.footer}<br />{t.more.footerTwo}
      </p>
    </div>
  );
}
