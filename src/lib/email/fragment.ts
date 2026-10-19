/**
 * Reads a confirmation link's fragment — `#token=…`, optionally `&for=change`
 * (an Administrator's requested email change, UM-5).
 *
 * Some mail link-rewriters percent-encode the fragment's `&` and `=`; the
 * whole fragment is decoded once first so such a link still works. That is
 * safe because the token itself is base64url, which has no `%`, `&`, `=` or `+`.
 */
export function readVerifyFragment(hash: string): { token: string; change: boolean } {
  let raw = hash.replace(/^#/, "");
  try { raw = decodeURIComponent(raw); } catch { /* malformed: use it as it came */ }
  const params = new URLSearchParams(raw);
  return { token: params.get("token") ?? "", change: params.get("for") === "change" };
}
