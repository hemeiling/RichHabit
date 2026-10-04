"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { call } from "@/components/together/shared";

/**
 * Opening a Together invitation.
 *
 * The token arrives in the URL fragment (`#t=…`), which no server ever sees. It
 * is moved into this tab's session storage and the fragment is removed from the
 * address bar and history at once, so it is not left on screen, in a bookmark
 * or in a shared screenshot. Session storage is what carries it through signing
 * in or creating an account: the login page returns here afterwards.
 *
 * The page decides nothing about access. The preview and accept APIs check the
 * token, the account and the invitation on the server. Accepting needs no
 * Together preview access: a valid invitation opens its own board, and only
 * that one.
 *
 * A new account that must verify its address first usually does so in another
 * tab, where this token is not; reopening the email's link continues from here.
 */

const KEY = "rh_together_invite";

function takeToken(): string | null {
  try {
    const m = window.location.hash.match(/[#&]t=([A-Za-z0-9_-]{43})/);
    if (m) {
      sessionStorage.setItem(KEY, m[1]);
      window.history.replaceState(null, "", window.location.pathname);
      return m[1];
    }
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
const forget = () => { try { sessionStorage.removeItem(KEY); } catch { /* nothing to forget */ } };

type State =
  | { kind: "checking" }
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "ok"; board: string; inviter: string };

export default function InviteLanding({ signedIn }: { signedIn: boolean }) {
  const t = useT();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "checking" });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const tok = takeToken();
    setToken(tok);
    if (!tok) { setState({ kind: "missing" }); return; }
    call<{ status: "ok"; board: string; inviter: string } | { status: "invalid" }>(
      "/api/together/invitations/preview", { method: "POST", body: JSON.stringify({ token: tok }) })
      .then((r) => setState(r.status === "ok" ? { kind: "ok", board: r.board, inviter: r.inviter } : { kind: "invalid" }))
      .catch(() => setState({ kind: "invalid" }));
  }, []);

  const accept = async () => {
    if (!token || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const { boardId } = await call<{ boardId: string }>("/api/together/invitations/accept", {
        method: "POST", body: JSON.stringify({ token }),
      });
      forget();
      router.push(`/together/b/${boardId}`);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <main className="tg-invite">
      <div className="card p-6 tg-invite-card">
        <h1 className="display" style={{ fontSize: 26, lineHeight: 1.15 }}>{t.together.invitePage.title}</h1>

        {state.kind === "checking" && <p className="muted mt-3" role="status">{t.together.invitePage.checking}</p>}
        {state.kind === "missing" && <p className="mt-3">{t.together.invitePage.missing}</p>}
        {state.kind === "invalid" && <p className="mt-3" role="alert">{t.together.invitePage.invalid}</p>}

        {state.kind === "ok" && (
          <>
            <p className="mt-3" style={{ fontSize: 16 }}>{t.together.invitePage.invitedYou(state.inviter, state.board)}</p>
            <p className="muted mt-2" style={{ fontSize: 13.5, lineHeight: 1.55 }}>{t.together.invitePage.privacy}</p>

            {!signedIn ? (
              <div className="flex gap-2 flex-wrap mt-5">
                <Link className="btn btn-primary" href="/login?then=together-invite">{t.together.invitePage.signIn}</Link>
                <Link className="btn" href="/login?mode=signup&then=together-invite">{t.together.invitePage.createAccount}</Link>
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap mt-5">
                <button className="btn btn-primary" onClick={accept} disabled={busy}>{t.together.invitePage.accept}</button>
                <button className="btn" onClick={() => { forget(); router.push("/habits"); }}>{t.together.invitePage.notNow}</button>
              </div>
            )}
            {problem && <p className="mt-3" role="alert" style={{ color: "var(--warn)", fontSize: 13.5 }}>{problem}</p>}
          </>
        )}
      </div>
    </main>
  );
}
