import type { FileKind } from "@/lib/aiWorkspace/types";

/**
 * What an uploaded file really is, decided from its bytes.
 *
 * The browser's declared type and the filename's extension are both things a
 * person (or a renamed file) can get wrong, so neither is consulted. A file is
 * accepted only when its leading bytes are one of the signatures below, or when
 * the whole of it is valid UTF-8 text. Everything else is refused before it is
 * stored, and before anything is sent to a provider.
 */

export interface DetectedFile {
  kind: FileKind;
  mimeType: string;
}

const bytesOf = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const startsWith = (b: Uint8Array, signature: number[], offset = 0) =>
  b.length >= offset + signature.length && signature.every((v, i) => b[offset + i] === v);

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

export function detectFileType(bytes: Uint8Array): DetectedFile | null {
  if (bytes.length === 0) return null;
  if (startsWith(bytes, bytesOf("%PDF-"))) return { kind: "pdf", mimeType: "application/pdf" };
  if (startsWith(bytes, PNG)) return { kind: "image", mimeType: "image/png" };
  if (startsWith(bytes, JPEG)) return { kind: "image", mimeType: "image/jpeg" };
  if (startsWith(bytes, bytesOf("GIF87a")) || startsWith(bytes, bytesOf("GIF89a"))) {
    return { kind: "image", mimeType: "image/gif" };
  }
  if (startsWith(bytes, bytesOf("RIFF")) && startsWith(bytes, bytesOf("WEBP"), 8)) {
    return { kind: "image", mimeType: "image/webp" };
  }
  if (isPlainText(bytes)) return { kind: "text", mimeType: "text/plain" };
  return null;
}

/**
 * Valid UTF-8, no NUL, and almost no other control characters. Binary formats
 * (archives, office documents, executables) fail the first or second test
 * within their first few bytes.
 */
export function isPlainText(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  if (!text) return false;
  let control = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) return false;
    // Tab, line feed, form feed and carriage return are ordinary in text.
    if ((c < 32 && c !== 9 && c !== 10 && c !== 12 && c !== 13) || c === 127) control++;
  }
  return control <= Math.max(2, text.length * 0.001);
}

/** The text of a stored text file, without a byte-order mark. */
export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}
