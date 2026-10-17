"use client";
import { useEffect } from "react";

/**
 * Quietly reloads a page that outlived its deployment, so nobody acts on a
 * stale interface.
 *
 * Why it exists: iOS restores a suspended tab from a snapshot without touching
 * the network, and each deploy removes the previous build's script files. A
 * restored page from before a deploy therefore degrades to its server-rendered
 * links and stale behaviour — `Cache-Control: no-store` (already sent) cannot
 * prevent it, because no request happens.
 *
 * How: the first successful health answer in this page's life fixes the
 * baseline build (the snapshot preserves it — that is the point). Whenever the
 * tab is restored (`pageshow` with `persisted`) or returns to the foreground —
 * rechecked at most once a minute — the server's build is read again; a
 * different answer reloads the page, once.
 *
 * Never at the cost of someone's work: while anything might hold unsaved
 * input — a dialog is open, or focus is in a field — the reload waits and the
 * next quiet moment (focus leaving, the next return to the tab) takes it.
 * Failures and "unknown" (a dev server) count as no answer, never a mismatch.
 */

const RECHECK_MS = 60_000;

function mightHoldWork(): boolean {
  const el = document.activeElement;
  const editing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"
    || (el as HTMLElement).isContentEditable);
  return editing || !!document.querySelector('[role="dialog"]');
}

export default function VersionGuard() {
  useEffect(() => {
    let baseline: string | null = null;
    let lastCheck = 0;
    let stale = false;
    let reloaded = false;
    let gone = false;
    let waiting: ReturnType<typeof setInterval> | null = null;

    const reloadWhenQuiet = () => {
      if (!stale || reloaded || gone) return;
      if (mightHoldWork()) {
        // Events fire a beat before a dialog actually leaves the DOM, so a
        // pending reload watches for the quiet moment rather than trusting
        // any single event's timing.
        waiting ??= setInterval(reloadWhenQuiet, 1000);
        return;
      }
      reloaded = true;
      if (waiting) clearInterval(waiting);
      window.location.reload();
    };

    const check = async (force: boolean) => {
      if (gone || reloaded || (stale && !mightHoldWork())) { reloadWhenQuiet(); return; }
      const now = Date.now();
      if (!force && now - lastCheck < RECHECK_MS) return;
      lastCheck = now;
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (!r.ok) return;
        const build = (await r.json())?.build;
        if (typeof build !== "string" || build === "unknown" || gone) return;
        if (baseline === null) { baseline = build; return; }
        if (build !== baseline) { stale = true; reloadWhenQuiet(); }
      } catch { /* offline or flaky: decide nothing */ }
    };

    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) void check(true); };
    const onVisible = () => { if (document.visibilityState === "visible") void check(false); };
    const onQuiet = () => reloadWhenQuiet();

    void check(true);   // fixes the baseline while the page is fresh
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("focusout", onQuiet);
    return () => {
      gone = true;
      if (waiting) clearInterval(waiting);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("focusout", onQuiet);
    };
  }, []);
  return null;
}
