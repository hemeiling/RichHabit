/**
 * A sentence for the next page to show once — after an action that takes the
 * person somewhere else (a Together space deleted, or left). Browser only.
 *
 * Kept in this tab's session, never in the address, where a space's name would
 * end up in history; read once by whichever page shows it (Together Overview,
 * or Today). Storage can be unavailable (private mode): then the message is
 * simply skipped and nothing else changes.
 */
const KEY = "rh:flash";

export function setFlash(text: string): void {
  try { sessionStorage.setItem(KEY, text); } catch { /* no storage: no message */ }
}

export function takeFlash(): string | null {
  try {
    const text = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return text;
  } catch { return null; }
}
