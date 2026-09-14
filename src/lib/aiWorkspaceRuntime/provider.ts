import type { FailureDetail, MessageErrorCode } from "@/lib/aiWorkspace/types";
import { aiWorkspace, isLocalDatabase } from "@/lib/env";
import { CHAT_CAPABILITIES, IMAGE_CAPABILITIES, modelLabel, type ModelOption } from "./models";

/**
 * The seams between the AI Workspace and the models behind it.
 *
 * Server-only: this is the one module where provider credentials are read. The
 * workspace speaks in turns and parts. A conversational provider turns those
 * into its own request and streams text back; an image provider turns a prompt
 * into pictures. Claude (Anthropic) and Gemini (Google) implement them, and the
 * routes, the context assembler and the database do not change when another
 * provider is added.
 *
 * `modelCatalogue()` lists only models whose credential is configured, so the
 * browser is never offered a model without a working backend.
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

/** A conversational model: text and documents in, streamed text out. */
export interface WorkspaceProvider {
  /** Stored on messages and provider copies. `^[a-z0-9_-]{1,40}$`. */
  readonly id: string;
  streamChat(request: ChatRequest, onText: (delta: string) => void): Promise<ChatResult>;
  /**
   * A provider with a files API keeps a copy of a PDF or image, uploaded once
   * and reused. A provider without one receives files inline with each request.
   */
  uploadFile?(file: { bytes: Uint8Array; filename: string; mimeType: string }): Promise<string>;
  deleteFile?(providerFileId: string): Promise<void>;
}

export interface ImageRequest {
  model: string;
  /** The admin's words, as written. */
  prompt: string;
  /** Pictures attached to the same message, sent inline as references. */
  references: { mimeType: string; data: string }[];
  imageSize: string;
  signal: AbortSignal;
}

export interface GeneratedImage {
  /** As the provider declared it. The stored type is decided again from the bytes. */
  mimeType: string;
  bytes: Uint8Array;
}

export interface ImageResult {
  images: GeneratedImage[];
  /** Any words the model returned with the pictures, or instead of them. */
  text: string;
  stopReason: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** An image-generation model: a prompt in, pictures out. */
export interface ImageProvider {
  readonly id: string;
  generateImage(request: ImageRequest): Promise<ImageResult>;
}

/**
 * A provider call that did not produce an answer. Carries a workspace error code
 * and the HTTP status, and nothing else — never the prompt, the reply or the
 * provider's own message — so it is safe to log.
 */
export class ProviderFailure extends Error {
  constructor(
    readonly code: MessageErrorCode,
    readonly status: number | null = null,
    /** Set by `providerErrors.ts` where the code alone would mislead. */
    readonly detail: FailureDetail | null = null,
  ) {
    super(`AI provider request failed (${detail ?? code}${status ? ` ${status}` : ""})`);
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

export const chatOption = (id: string, provider: string, model: string): ModelOption =>
  ({ id, provider, model, label: modelLabel(model), capabilities: CHAT_CAPABILITIES });

export const imageOption = (id: string, provider: string, model: string): ModelOption =>
  ({ id, provider, model, label: modelLabel(model), capabilities: IMAGE_CAPABILITIES });

export interface TestProviders {
  catalogue: ModelOption[];
  chat: Record<string, WorkspaceProvider>;
  image: Record<string, ImageProvider>;
}

let testProviders: TestProviders | undefined;

/**
 * Test seam: one provider standing in as Claude. `null` simulates no credential
 * at all; `undefined` restores the real providers.
 */
export function setWorkspaceProviderForTests(provider: WorkspaceProvider | null | undefined) {
  testProviders = provider === undefined
    ? undefined
    : provider === null
      ? { catalogue: [], chat: {}, image: {} }
      : { catalogue: [chatOption("claude", provider.id, aiWorkspace.model)], chat: { [provider.id]: provider }, image: {} };
}

/** Test seam for several models at once; `undefined` restores the real providers. */
export function setWorkspaceProvidersForTests(providers: TestProviders | undefined) {
  testProviders = providers;
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
 * The models that can answer right now: Claude when its key is set; Gemini and
 * Gemini image generation when Google's is. The first conversational model is
 * the default.
 */
export async function modelCatalogue(): Promise<ModelOption[]> {
  if (testProviders) return testProviders.catalogue;
  if (scriptedProviderAllowed()) {
    const { scriptedCatalogue } = await import("./scriptedProvider");
    return scriptedCatalogue();
  }
  const catalogue: ModelOption[] = [];
  if (aiWorkspace.apiKey) catalogue.push(chatOption("claude", "anthropic", aiWorkspace.model));
  if (aiWorkspace.geminiApiKey) {
    catalogue.push(chatOption("gemini", "google", aiWorkspace.geminiModel));
    catalogue.push(imageOption("image", "google", aiWorkspace.imageModel));
  }
  return catalogue;
}

/**
 * A conversational provider by its stored id, or null when its credential is
 * not configured. Keys are read at call time and handed straight to the
 * provider; they are not stored, logged or returned.
 */
export async function chatProvider(providerId: string): Promise<WorkspaceProvider | null> {
  if (testProviders) return testProviders.chat[providerId] ?? null;
  if (scriptedProviderAllowed()) {
    const { scriptedProvider } = await import("./scriptedProvider");
    return providerId.startsWith("scripted") ? scriptedProvider(providerId) : null;
  }
  if (providerId === "anthropic") {
    const apiKey = aiWorkspace.apiKey;
    if (!apiKey) return null;
    // The one file that uses Anthropic's SDK, shared with intention suggestions.
    const { createClaudeWorkspaceProvider } = await import("@/lib/ai/claude");
    return createClaudeWorkspaceProvider(apiKey);
  }
  if (providerId === "google") {
    const apiKey = aiWorkspace.geminiApiKey;
    if (!apiKey) return null;
    // The one file that talks to Google.
    const { createGeminiWorkspaceProvider } = await import("@/lib/ai/gemini");
    return createGeminiWorkspaceProvider(apiKey);
  }
  return null;
}

/** An image provider by its stored id, or null when its credential is not configured. */
export async function imageProvider(providerId: string): Promise<ImageProvider | null> {
  if (testProviders) return testProviders.image[providerId] ?? null;
  if (scriptedProviderAllowed()) {
    const { scriptedImageProvider } = await import("./scriptedProvider");
    return providerId.startsWith("scripted") ? scriptedImageProvider(providerId) : null;
  }
  if (providerId === "google") {
    const apiKey = aiWorkspace.geminiApiKey;
    if (!apiKey) return null;
    const { createGeminiImageProvider } = await import("@/lib/ai/gemini");
    return createGeminiImageProvider(apiKey);
  }
  return null;
}
