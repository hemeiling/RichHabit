import type { MessageErrorCode } from "@/lib/aiWorkspace/types";
import { aiWorkspace, isLocalDatabase } from "@/lib/env";

/**
 * The seam between the AI Workspace and whichever model answers.
 *
 * Server-only: this is where the provider credential is used. The workspace
 * speaks in turns and parts; a provider turns those into its own request, streams
 * text back and reports how the reply ended. Claude implements it today. Another
 * provider (Gemini, for example) implements the same interface later, and the
 * routes, the context assembler and the database do not change.
 */

export type ProviderPart =
  | { type: "text"; text: string }
  | {
    type: "document";
    title: string;
    source:
      | { kind: "file"; providerFileId: string }
      | { kind: "base64"; mimeType: "application/pdf"; data: string }
      | { kind: "text"; text: string };
  }
  | {
    type: "image";
    source:
      | { kind: "file"; providerFileId: string }
      | { kind: "base64"; mimeType: string; data: string };
  };

export interface ProviderTurn {
  role: "user" | "assistant";
  parts: ProviderPart[];
}

export interface ChatRequest {
  model: string;
  system: string;
  turns: ProviderTurn[];
  maxOutputTokens: number;
  /** Aborted when the admin presses Stop or the browser goes away. */
  signal: AbortSignal;
}

export interface ChatResult {
  /** Normalised: see `normaliseStopReason`. */
  stopReason: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

export interface WorkspaceProvider {
  /** Stored on messages and provider copies. `^[a-z0-9_-]{1,40}$`. */
  readonly id: string;
  streamChat(request: ChatRequest, onText: (delta: string) => void): Promise<ChatResult>;
  /** Returns the provider's id for the stored copy. */
  uploadFile(file: { bytes: Uint8Array; filename: string; mimeType: string }): Promise<string>;
  deleteFile(providerFileId: string): Promise<void>;
}

/**
 * A provider call that did not produce an answer. Carries a workspace error code
 * and the HTTP status, and nothing else — never the prompt, the reply or the
 * provider's own message — so it is safe to log.
 */
export class ProviderFailure extends Error {
  constructor(readonly code: MessageErrorCode, readonly status: number | null = null) {
    super(`AI provider request failed (${code}${status ? ` ${status}` : ""})`);
    this.name = "ProviderFailure";
  }
}

/** The request was stopped on purpose. Not a failure. */
export class ProviderAborted extends Error {
  constructor() {
    super("AI provider request stopped");
    this.name = "ProviderAborted";
  }
}

/**
 * Provider stop reasons, reduced to the ones the workspace acts on:
 * `max_tokens` offers Continue, `refusal` and `context_window` explain
 * themselves, and every ordinary finish is `end_turn`.
 */
export function normaliseStopReason(raw: string | null | undefined): string {
  switch (raw) {
    case "max_tokens": return "max_tokens";
    case "refusal": return "refusal";
    case "model_context_window_exceeded": return "context_window";
    default: return "end_turn";
  }
}

let testProvider: WorkspaceProvider | null | undefined;

/** Test seam: `null` simulates a missing credential, `undefined` restores the real one. */
export function setWorkspaceProviderForTests(provider: WorkspaceProvider | null | undefined) {
  testProvider = provider;
}

/**
 * The scripted provider is for browser suites, and only ever on a local test
 * instance that asked for it. Production cannot satisfy any of the three
 * conditions, and each one alone is enough to refuse.
 */
export function scriptedProviderAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.AI_WORKSPACE_FAKE_PROVIDER !== "1") return false;
  if (env.RH_TEST_INSTANCE !== "true" || env.NODE_ENV === "production") return false;
  const url = env.DATABASE_URL?.trim();
  return Boolean(url) && isLocalDatabase(url as string);
}

/**
 * The provider for the workspace, or null when no credential is configured.
 * The key is read at call time and handed straight to the provider; it is not
 * stored, logged or returned.
 */
export async function workspaceProvider(): Promise<WorkspaceProvider | null> {
  if (testProvider !== undefined) return testProvider;
  if (scriptedProviderAllowed()) {
    const { scriptedProvider } = await import("./scriptedProvider");
    return scriptedProvider();
  }
  const apiKey = aiWorkspace.apiKey;
  if (!apiKey) return null;
  // The one file that uses Anthropic's SDK, shared with intention suggestions.
  const { createClaudeWorkspaceProvider } = await import("@/lib/ai/claude");
  return createClaudeWorkspaceProvider(apiKey);
}
