import { coach, intentionAi } from "@/lib/env";

/**
 * The seam between RichHabit and whichever model produces suggestions.
 *
 * Server-only. Nothing under src/lib/ai may be imported by a client component:
 * this is where the provider credential is used. The browser only ever calls
 * same-origin API routes.
 *
 * Two capabilities, deliberately small:
 *
 *   - `generateStructured` — given instructions, a prompt and a JSON schema,
 *     return one structured object. Suggested habits and priorities, and the
 *     habit recommendations, both want a shape they can validate.
 *   - `generateText` — given instructions and a prompt, return prose. The AI
 *     coach wants an answer a person reads, not a record.
 *
 * Claude implements both today; another provider (Gemini, for example) can
 * implement the same interface later without the feature code changing. This is
 * the consumer seam. The admin AI Workspace has its own richer runtime
 * (streaming, files, images, model catalogue) and the two stay separate on
 * purpose — a habit coach needs none of that, and the workspace's boundary tests
 * exist to keep it admin-only.
 */

export interface StructuredRequest {
  /** Standing instructions. Never contains the user's words. */
  system: string;
  /** The user-derived context, already reduced to what the task needs. */
  prompt: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
}

/** Prose, not a record. No schema, and no tool. */
export interface TextRequest {
  /** Standing instructions. Never contains the user's words. */
  system: string;
  /** The user-derived context, already reduced to what the task needs. */
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface AiProvider {
  readonly name: string;
  /** The structured object, or null when the model returned none. */
  generateStructured(request: StructuredRequest): Promise<unknown>;
  /** The answer as text, or "" when the model returned none. */
  generateText(request: TextRequest): Promise<string>;
}

/**
 * A provider call that did not produce an answer. Carries the HTTP status and
 * nothing else — never the prompt, the response or the provider's message, so
 * it is safe to log.
 */
export class AiFailed extends Error {
  constructor(readonly status: number | null) {
    super(status ? `AI provider request failed (${status})` : "AI provider request failed");
  }

  /**
   * The provider refused the request itself — a missing, invalid or wrongly
   * scoped key, no access to the model, or a request it will never accept.
   * Retrying will not help, so the person is told suggestions are unavailable
   * rather than asked to try again. Timeouts, rate limits and outages are not
   * rejections.
   */
  get rejected(): boolean {
    return this.status === 400 || this.status === 401 || this.status === 403 || this.status === 404;
  }
}

let testProvider: AiProvider | null | undefined;

/** Test seam: `null` simulates a missing credential, `undefined` restores the real one. */
export function setAiProviderForTests(provider: AiProvider | null | undefined) {
  testProvider = provider;
}

/**
 * The provider for intention suggestions, or null when no credential is
 * configured. The credential is read at call time and passed straight to the
 * provider; it is not stored, logged or returned.
 */
export async function intentionAiProvider(): Promise<AiProvider | null> {
  if (testProvider !== undefined) return testProvider;
  const apiKey = intentionAi.apiKey;
  if (!apiKey) return null;
  const { createClaudeProvider } = await import("./claude");
  return createClaudeProvider(apiKey, intentionAi.model);
}

/**
 * The provider for the AI coach and for habit recommendations, or null when no
 * credential is configured. The same server-side Claude credential as intention
 * suggestions — one provider architecture, not a second one — with its own model
 * setting, because the coach reasons over a whole account's history while a
 * suggestion is one short list.
 *
 * Both features share this factory because they always shared their
 * configuration: the coach's own `coach.*` block has covered the habit
 * recommendations since they were written.
 */
export async function coachProvider(): Promise<AiProvider | null> {
  if (testProvider !== undefined) return testProvider;
  const apiKey = coach.apiKey;
  if (!apiKey) return null;
  const { createClaudeProvider } = await import("./claude");
  return createClaudeProvider(apiKey, coach.model);
}
