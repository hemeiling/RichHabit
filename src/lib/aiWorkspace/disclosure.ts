/**
 * The upload disclosure: an attached file is sent to the company behind the
 * model that answers — Anthropic for Claude, whose Files API copies are kept
 * until deleted and are not eligible for zero data retention, or Google for
 * Gemini and image generation, which receives files inline with each request.
 *
 * Acceptance is stored as a version and a time, never a boolean. Raise this
 * number whenever the disclosure's meaning changes; every admin is then asked
 * again before their next upload, because the server compares the stored
 * version with this one on every upload.
 *
 *   1  Anthropic only
 *   2  Google added, when Gemini joined the workspace
 */
export const UPLOAD_DISCLOSURE_VERSION = 2;

export function isCurrentDisclosure(acceptedVersion: number | null | undefined): boolean {
  return acceptedVersion === UPLOAD_DISCLOSURE_VERSION;
}
