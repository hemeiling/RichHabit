/**
 * The models the AI Workspace can use, and what each one can do.
 *
 * The workspace is a general-purpose assistant with more than one model behind
 * it. This module only describes models and capabilities; which models are
 * actually configured is decided in `provider.ts`, the one module that reads
 * credentials, and which model answers a request is decided in `routing.ts`.
 *
 * Pure and server-only. The browser receives `PublicModel` shapes, never
 * provider details it does not need.
 */

/** What a request needs. The router picks a configured model that has it. */
export const CAPABILITIES = ["text", "documents", "image_generation"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Named so the design has a place for them. Nothing implements them yet, and
 * no model claims them.
 */
export const FUTURE_CAPABILITIES = ["image_editing", "web_research", "video", "tools"] as const;

export interface ModelOption {
  /** The stable key the browser sends back: "claude", "gemini", "image". */
  id: string;
  /** Stored on messages. `^[a-z0-9_-]{1,40}$`. */
  provider: string;
  /** The provider's model id, stored on messages. */
  model: string;
  label: string;
  capabilities: readonly Capability[];
}

/** What the browser is told about a model: enough to show and choose it. */
export interface PublicModel {
  id: string;
  label: string;
}

export const CHAT_CAPABILITIES: readonly Capability[] = ["text", "documents"];
export const IMAGE_CAPABILITIES: readonly Capability[] = ["image_generation"];

export const isChatModel = (o: Pick<ModelOption, "capabilities">) => o.capabilities.includes("text");
export const isImageModel = (o: Pick<ModelOption, "capabilities">) => o.capabilities.includes("image_generation");

export const toPublicModel = (o: ModelOption): PublicModel => ({ id: o.id, label: o.label });

/** Product names that a model id does not spell out. */
const KNOWN_LABELS: Record<string, string> = {
  "gemini-3.1-flash-image": "Nano Banana 2",
  "gemini-3.1-flash-lite-image": "Nano Banana 2 Lite",
  "gemini-3-pro-image": "Nano Banana Pro",
  "gemini-2.5-flash-image": "Nano Banana",
};

/**
 * A readable name for a model id, for the selector and for older replies:
 * "claude-sonnet-5" is "Claude Sonnet 5", "gemini-3.8-flash" is "Gemini 3.8 Flash".
 */
export function modelLabel(model: string): string {
  const known = KNOWN_LABELS[model];
  if (known) return known;
  const words = model.replace(/-\d{8}$/, "").split(/[-_]+/).filter(Boolean);
  const label = words.map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
  return label.slice(0, 60) || model.slice(0, 60);
}

/** Whether a stored model id names an image model, for replies whose model is no longer configured. */
export const looksLikeImageModel = (model: string | null | undefined) => /(^|-)image(-preview)?$/.test(model ?? "");

/**
 * The configured option a stored reply was written with: the same model, or
 * failing that another chat model from the same provider (a model upgraded in
 * configuration). Null when nothing configured matches.
 */
export function optionForReply(
  catalogue: readonly ModelOption[], provider: string | null, model: string | null,
): ModelOption | null {
  if (!provider || !model) return null;
  const exact = catalogue.find((o) => o.provider === provider && o.model === model);
  if (exact) return exact;
  if (looksLikeImageModel(model)) return catalogue.find((o) => o.provider === provider && isImageModel(o)) ?? null;
  return catalogue.find((o) => o.provider === provider && isChatModel(o)) ?? null;
}
