"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useHabits } from "@/components/store";
import { useT } from "@/lib/i18n/context";
import { Icon, ICONS } from "./icons";
import "./workspace.css";

/**
 * The AI Workspace's way in: one quiet button at the bottom right, rendered only
 * for admins (the layout decides, from the database). The workspace itself is
 * loaded the first time it is opened and then kept mounted, so closing the
 * panel does not interrupt a reply that is still being written.
 *
 * Hiding this from everyone else is presentation. What protects the workspace is
 * the server: every /api/admin/ai/workspace route answers 404 to non-admins.
 */

const Workspace = dynamic(() => import("./Workspace"), { ssr: false });
const OPEN_KEY = "rh.aiWorkspace.open";

export default function AiLauncher() {
  const t = useT().aiWorkspace;
  const { state } = useHabits();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Reopens after a reload if it was open, like the rest of the page's state.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(OPEN_KEY) === "1") {
        setMounted(true);
        setOpen(true);
      }
    } catch { /* storage unavailable: start closed */ }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try { sessionStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* not remembered */ }
  }, [open, mounted]);

  /*
   * Rendered beside the page chrome rather than inside it, so it carries the
   * theme itself: the tokens it is drawn with are redefined under data-theme.
   */
  return (
    <div data-theme={state.prefs.theme} className="aiw-root">
      {!open && (
        <button type="button" className="aiw-launch" aria-label={t.open} title={t.open} data-testid="aiw-launcher"
          onClick={() => { setMounted(true); setOpen(true); }}>
          <Icon d={ICONS.spark} size={20} strokeWidth={1.6} />
          <span className="aiw-launch-label">{t.launcher}</span>
        </button>
      )}
      {mounted && <Workspace open={open} onClose={() => setOpen(false)} />}
    </div>
  );
}
