"use client";
import { useEffect, useState } from "react";
import SetupForm from "./[token]/SetupForm";
import { useT } from "@/lib/i18n/context";

/**
 * A setup link whose token rides in the fragment — `/setup#token=…` — the
 * pattern password-reset links already use. Browsers never send a fragment,
 * so the request that opens this page carries no credential and no server,
 * proxy or access log can keep one. Links issued before this (the token in
 * the path, `/setup/<token>`) still work through the old route.
 *
 * Read once as the module loads, before anything can clear it, then wiped
 * from the address bar so it does not sit in history. A link pasted into a tab
 * already on this page is a fragment-only navigation (`hashchange`, no load),
 * so that is listened for too — the same trap the reset page fell into.
 */
const HASH_TOKEN = typeof window === "undefined" ? "" : (() => {
  const found = /^#token=([^&]+)$/.exec(window.location.hash)?.[1];
  return found ? decodeURIComponent(found) : "";
})();

export default function FragmentSetup() {
  const t = useT();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    setToken(HASH_TOKEN);
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    const onHash = () => {
      const next = /^#token=([^&]+)$/.exec(window.location.hash)?.[1];
      if (next) setToken(decodeURIComponent(next));
      if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (token === null) return null;          // before the effect: render nothing, never a mismatch
  if (!token) {
    return (
      <main className="mx-auto px-4 py-10" style={{ maxWidth: 420 }}>
        <h1 className="display" style={{ fontSize: 26 }}>{t.setup.title}</h1>
        <p className="mt-3" role="alert" style={{ fontSize: 14, lineHeight: 1.5, color: "var(--warn)" }}>
          {t.errors.setupLinkInvalid}
        </p>
      </main>
    );
  }
  // Keyed, so a newly pasted link starts a fresh form.
  return <SetupForm key={token} token={token} />;
}
