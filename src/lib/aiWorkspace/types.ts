/**
 * AI Workspace domain types, as the data layer returns them.
 *
 * Server-only. File bytes never appear in these shapes, and the one type that
 * carries a provider's file id says so: it must not be serialised to a browser.
 */

export const MESSAGE_STATUSES = ["streaming", "complete", "stopped", "failed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const REPLY_KINDS = ["reply", "continuation", "retry"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

export const MESSAGE_ERROR_CODES = [
  "rate_limited", "overloaded", "timeout", "context_too_long", "unreadable_file",
  "malformed_response", "provider_error", "network", "interrupted",
] as const;
export type MessageErrorCode = (typeof MESSAGE_ERROR_CODES)[number];

export const FILE_KINDS = ["pdf", "image", "text"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** The only media types a file of each kind may be stored as. */
export const MIME_TYPES_BY_KIND: Record<FileKind, readonly string[]> = {
  pdf: ["application/pdf"],
  image: ["image/png", "image/jpeg", "image/gif", "image/webp"],
  text: ["text/plain"],
};

export const PROVIDER_COPY_STATUSES = ["pending", "uploaded", "failed", "deleted"] as const;
export type ProviderCopyStatus = (typeof PROVIDER_COPY_STATUSES)[number];

export interface AiProject {
  id: string;
  name: string;
  /** Private. Sent only as the project layer of this project's conversations. */
  instructions: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface AiConversation {
  id: string;
  projectId: string | null;
  title: string;
  titleEdited: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  archivedAt: string | null;
}

/** A file as it appears on a message. `removed` means it has since been deleted. */
export interface AiAttachment {
  fileId: string;
  position: number;
  originalFilename: string;
  kind: FileKind;
  mimeType: string;
  byteSize: number;
  removed: boolean;
}

export interface AiMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  errorCode: MessageErrorCode | null;
  clientId: string | null;
  replyKind: ReplyKind | null;
  replyToMessageId: string | null;
  continuationOfMessageId: string | null;
  retryOfMessageId: string | null;
  provider: string | null;
  model: string | null;
  maxOutputTokens: number | null;
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  contextMessages: number | null;
  latencyMs: number | null;
  createdAt: string;
  completedAt: string | null;
  attachments: AiAttachment[];
}

/** File metadata. Never includes the bytes. */
export interface AiFile {
  id: string;
  projectId: string | null;
  conversationId: string | null;
  originalFilename: string;
  kind: FileKind;
  mimeType: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
  deletedAt: string | null;
}

/**
 * A provider's copy of a file. SERVER-ONLY: `providerFileId` must never be
 * returned by an API route or accepted from a request.
 */
export interface ProviderCopy {
  fileId: string;
  provider: string;
  providerFileId: string | null;
  status: ProviderCopyStatus;
  uploadedAt: string | null;
  deletedAt: string | null;
  failureCode: string | null;
  updatedAt: string;
}

export interface WorkspaceSettings {
  uploadDisclosureVersion: number | null;
  uploadDisclosureAcceptedAt: string | null;
  currentDisclosureVersion: number;
  hasAcceptedCurrentDisclosure: boolean;
}

export interface StorageUsage {
  usedBytes: number;
  quotaBytes: number;
}
