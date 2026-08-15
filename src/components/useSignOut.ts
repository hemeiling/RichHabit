"use client";
import { useState } from "react";

/**
 * Signing out, for real — the one implementation, shared by the sidebar and the
 * account section on More.
 *
 * The session lives in a `sessions` row and an opaque HttpOnly cookie, so the
 * only thing that ends it is the server deleting that row. This waits for the
 * response and refuses to navigate if the request failed: a redirect on its own
 * would leave a working session behind and merely look signed out.
 *
 * The navigation is a full document load rather than `router.push`. Next keeps
 * a client-side cache of already-rendered routes, and React keeps this
 * account's state in memory; a soft navigation leaves both intact, so Back
 * could paint the previous user's habits from memory without asking the server
 * anything. Replacing the document drops every byte of it, and `replace` keeps
 * the signed-in page out of history entirely.
 */
export function useSignOut() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const signOut = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/auth/signout", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      window.location.replace("/login");
    } catch {
      setBusy(false);
      setFailed(true);
    }
  };

  return { signOut, busy, failed };
}
