"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useHabits } from "@/components/store";
import { Segmented } from "@/components/ui";
import { todayISO } from "@/lib/dates";

const LINKS = [
  { href: "/more/awareness", label: "Habit awareness", note: "Log a normal day, then grade it" },
  { href: "/more/goals", label: "Goals", note: "What each habit is actually for" },
  { href: "/more/metrics", label: "Health metrics", note: "Weight, sleep, cardio, water" },
  { href: "/more/stacks", label: "Habit stacking", note: "Attach new habits to old ones" },
  { href: "/more/review", label: "Weekly review", note: "Close the week, set next week's focus" },
];

export default function More({ email }: { email: string }) {
  const { state, actions, saving } = useHabits();
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
                <span className="block" style={{ fontSize: 15.5, fontWeight: 500 }}>{l.label}</span>
                <span className="faint block mt-0.5" style={{ fontSize: 13 }}>{l.note}</span>
              </span>
              <span className="faint" style={{ fontSize: 18 }}>›</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-3">Preferences</div>
        <div className="flex items-center justify-between py-2 gap-3">
          <div>
            <div style={{ fontSize: 15 }}>Appearance</div>
            <div className="faint" style={{ fontSize: 12.5 }}>Follows your choice, not the system</div>
          </div>
          <Segmented value={state.prefs.theme} onChange={(v) => actions.setPrefs({ theme: v })} small
            options={[{ value: "light" as const, label: "Light" }, { value: "dark" as const, label: "Dark" }]} />
        </div>
        <div className="flex items-center justify-between py-2 gap-3">
          <div>
            <div style={{ fontSize: 15 }}>Weighted score</div>
            <div className="faint" style={{ fontSize: 12.5 }}>High-priority habits count for more</div>
          </div>
          <Segmented<boolean> value={state.prefs.weighted} onChange={(v) => actions.setPrefs({ weighted: v })} small
            options={[{ value: true, label: "On" }, { value: false, label: "Off" }]} />
        </div>
      </section>

      <section className="card p-5">
        <div className="eyebrow mb-2">Account</div>
        <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          Signed in as {email}. Row-level security keeps your rows visible only to you.
          {saving ? " Saving…" : " All changes saved."}
        </p>
        <div className="flex gap-2 mt-3">
          <button className="btn" onClick={exportData}>Export JSON</button>
          <button className="btn" disabled={busy} onClick={signOut}>Sign out</button>
        </div>
      </section>

      <p className="faint text-center" style={{ fontSize: 12, lineHeight: 1.5 }}>
        Awareness → grade → select → track → review.<br />Missing a day is data, not failure.
      </p>
    </div>
  );
}
