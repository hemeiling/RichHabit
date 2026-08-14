"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "signin" | "signup";

/**
 * Email and password against /api/auth/*. The magic-link option is gone with
 * Supabase Auth — sending a link needs an email provider, and this app has none
 * configured. Both routes set the session cookie and land on /today.
 */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !email || !password) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/auth/${mode === "signup" ? "signup" : "signin"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Something went wrong. Try again.");
      router.push("/today");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-7 w-full" style={{ maxWidth: 400 }}>
        <div className="eyebrow">Rich Habits</div>
        <h1 className="display mt-1" style={{ fontSize: 30, lineHeight: 1.1 }}>
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.5 }}>
          Your habits, your data, only yours.
        </p>

        <div className="mt-5 flex flex-col gap-3">
          <label className="block">
            <div className="eyebrow mb-1.5">Email</div>
            <input
              className="input" type="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="you@example.com"
            />
          </label>
          <label className="block">
            <div className="eyebrow mb-1.5">Password</div>
            <input
              className="input" type="password" value={password}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="At least 8 characters"
            />
          </label>
        </div>

        {error && (
          <div className="flat p-3 mt-3" style={{ fontSize: 13.5, borderColor: "var(--warn)", background: "var(--warn-soft)" }}>
            {error}
          </div>
        )}

        <button className="btn btn-primary w-full mt-4" disabled={busy || !email || !password} onClick={submit}>
          {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>

        <div className="flex flex-wrap gap-2 mt-4">
          {mode !== "signin" && (
            <button className="btn btn-quiet" onClick={() => { setMode("signin"); setError(null); }}>
              Sign in instead
            </button>
          )}
          {mode !== "signup" && (
            <button className="btn btn-quiet" onClick={() => { setMode("signup"); setError(null); }}>
              Create an account
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
