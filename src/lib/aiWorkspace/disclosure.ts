/**
 * The upload disclosure: files are sent to Anthropic, and Files API content is
 * not eligible for zero data retention.
 *
 * Acceptance is stored as a version and a time, never a boolean. Raise this
 * number whenever the disclosure's meaning changes; every admin is then asked
 * again before their next upload, because the server compares the stored
 * version with this one on every upload.
 */
export const UPLOAD_DISCLOSURE_VERSION = 1;

export function isCurrentDisclosure(acceptedVersion: number | null | undefined): boolean {
  return acceptedVersion === UPLOAD_DISCLOSURE_VERSION;
}
