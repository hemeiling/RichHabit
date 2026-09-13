import { ApiError, isUuid } from "@/lib/http";
import { MESSAGE_ERROR_CODES, type MessageErrorCode } from "./types";

/**
 * Input rules for the AI Workspace data layer. Messages are safe to show; none
 * of them repeats the rejected input.
 *
 * Lengths are counted in characters, as Postgres counts them, not in UTF-16
 * units, so Chinese and emoji are not penalised.
 */

export const MAX_PROJECT_NAME = 120;
export const MAX_INSTRUCTIONS = 20_000;
export const MAX_TITLE = 200;
export const AUTO_TITLE_CHARS = 60;
export const MAX_USER_MESSAGE_CHARS = 100_000;
export const MAX_ASSISTANT_MESSAGE_CHARS = 500_000;
export const MAX_ATTACHMENTS_PER_MESSAGE = 20;
export const MAX_FILENAME = 255;

const chars = (s: string) => Array.from(s).length;
const clip = (s: string, max: number) => Array.from(s).slice(0, max).join("");
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function projectName(v: unknown): string {
  const name = typeof v === "string" ? oneLine(v) : "";
  if (!name) throw new ApiError("Give the project a name");
  if (chars(name) > MAX_PROJECT_NAME) throw new ApiError("That project name is too long");
  return name;
}

export function projectInstructions(v: unknown): string {
  if (v == null) return "";
  if (typeof v !== "string") throw new ApiError("Instructions must be text");
  if (chars(v) > MAX_INSTRUCTIONS) throw new ApiError("Those instructions are too long");
  return v;
}

export function conversationTitle(v: unknown): string {
  const title = typeof v === "string" ? oneLine(v) : "";
  if (!title) throw new ApiError("Give the conversation a title");
  if (chars(title) > MAX_TITLE) throw new ApiError("That title is too long");
  return title;
}

/** The first words of a conversation, or the first file's name when there are no words. */
export function autoTitle(content: string, firstFilename?: string | null): string {
  const words = oneLine(content);
  return clip(words || oneLine(firstFilename ?? ""), AUTO_TITLE_CHARS).trim();
}

export function userMessageContent(v: unknown): string {
  if (typeof v !== "string") throw new ApiError("A message must be text");
  if (chars(v) > MAX_USER_MESSAGE_CHARS) throw new ApiError("That message is too long");
  return v;
}

export function assistantContent(v: unknown): string {
  if (typeof v !== "string") throw new ApiError("Reply content must be text");
  if (chars(v) > MAX_ASSISTANT_MESSAGE_CHARS) throw new ApiError("That reply is too long to save");
  return v;
}

export function attachmentIds(v: unknown): string[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new ApiError("Attachments must be a list");
  if (v.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new ApiError(`Attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files to one message`);
  }
  for (const id of v) if (!isUuid(id)) throw new ApiError("An attachment isn't valid");
  const ids = (v as string[]).map((id) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new ApiError("The same file is attached twice");
  return ids;
}

export function clientId(v: unknown): string {
  if (!isUuid(v)) throw new ApiError("clientId must be a uuid");
  return v.toLowerCase();
}

/**
 * A filename safe to store and show. Control characters and path separators
 * are removed; the name is only ever displayed, never used to build a path.
 */
export function sanitizeFilename(v: unknown): string {
  const raw = typeof v === "string" ? v : "";
  const cleaned = oneLine(raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, ""));
  return clip(cleaned, MAX_FILENAME).trim() || "file";
}

const PROVIDER = /^[a-z0-9_-]{1,40}$/;
export function providerId(v: unknown): string {
  if (typeof v !== "string" || !PROVIDER.test(v)) throw new ApiError("Unknown provider");
  return v;
}

export function modelId(v: unknown): string {
  if (typeof v !== "string" || v.length < 1 || v.length > 80) throw new ApiError("Unknown model");
  return v;
}

export function maxOutputTokens(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 128_000) {
    throw new ApiError("Output limit is out of range");
  }
  return v;
}

export function messageErrorCode(v: unknown): MessageErrorCode {
  if (typeof v !== "string" || !(MESSAGE_ERROR_CODES as readonly string[]).includes(v)) {
    throw new ApiError("Unknown error code");
  }
  return v as MessageErrorCode;
}

const CODE = /^[a-z0-9_]{1,40}$/;
export function failureCode(v: unknown): string {
  if (typeof v !== "string" || !CODE.test(v)) throw new ApiError("Unknown failure code");
  return v;
}

export function stopReason(v: unknown): string {
  if (typeof v !== "string" || !CODE.test(v)) throw new ApiError("Unknown stop reason");
  return v;
}

/** A non-negative whole number, or null when the provider did not report it. */
export function countOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 2_147_483_647) {
    throw new ApiError("A usage figure is out of range");
  }
  return v;
}
