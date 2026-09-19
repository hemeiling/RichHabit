import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { AiFailed, type AiProvider } from "./provider";
import {
  ProviderAborted, ProviderFailure, normaliseStopReason,
  type ChatRequest, type ProviderPart, type WorkspaceProvider,
} from "@/lib/aiWorkspaceRuntime/provider";
import { providerFailure } from "@/lib/aiWorkspaceRuntime/providerErrors";

/**
 * Claude, through Anthropic's official SDK. Server-only, and the only file in
 * the application that uses the SDK: intention suggestions and the admin AI
 * Workspace both reach Claude through here.
 *
 * Errors are reduced to a status code (and, for the workspace, a workspace error
 * code) before they leave this file. The SDK's error objects can carry request
 * details, and none of that may reach a log.
 *
 * The key is scoped to one Anthropic workspace, so no request sends a workspace
 * header or id.
 */

// ───────────────────────── intention suggestions ─────────────────────────────

/**
 * Structured output comes from a single forced tool call: the model is given
 * one tool whose input schema is the shape we want, and told to use it. What
 * comes back is that tool's input, which the caller still validates — a schema
 * the model was asked to follow is not a guarantee that it did.
 */
export function createClaudeProvider(apiKey: string, model: string): AiProvider {
  const client = new Anthropic({ apiKey, maxRetries: 1 });

  return {
    name: "claude",
    async generateStructured(request) {
      let message: Anthropic.Message;
      try {
        message = await client.messages.create(
          {
            model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: [{ role: "user", content: request.prompt }],
            tools: [{
              name: request.toolName,
              description: request.toolDescription,
              input_schema: request.schema as Anthropic.Tool.InputSchema,
            }],
            tool_choice: { type: "tool", name: request.toolName },
          },
          { timeout: request.timeoutMs },
        );
      } catch (e) {
        const status = e instanceof Anthropic.APIError && typeof e.status === "number" ? e.status : null;
        throw new AiFailed(status);
      }
      const block = message.content.find((c) => c.type === "tool_use");
      return block && block.type === "tool_use" ? block.input : null;
    },

    /**
     * Prose. No tool and no schema: the coach's answer is read by a person, and
     * forcing it through a tool call would only invite the model to describe an
     * answer instead of giving one.
     *
     * Every text block is joined, because a model may split its reply across
     * several. Anything that is not text — a thinking block, say — is ignored.
     */
    async generateText(request) {
      let message: Anthropic.Message;
      try {
        message = await client.messages.create(
          {
            model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: [{ role: "user", content: request.prompt }],
          },
          { timeout: request.timeoutMs },
        );
      } catch (e) {
        const status = e instanceof Anthropic.APIError && typeof e.status === "number" ? e.status : null;
        throw new AiFailed(status);
      }
      return message.content
        .filter((c): c is Anthropic.TextBlock => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
    },
  };
}

// ──────────────────────────── the AI Workspace ───────────────────────────────

/** Long replies stream for a while; this bounds a request that never ends. */
const STREAM_TIMEOUT_MS = 10 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 2 * 60 * 1000;

export function toAnthropicContent(parts: ProviderPart[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      // The API refuses empty text blocks.
      if (part.text.trim()) blocks.push({ type: "text", text: part.text });
    } else if (part.type === "document") {
      const s = part.source;
      blocks.push({
        type: "document",
        title: part.title.slice(0, 255),
        source: s.kind === "file"
          ? { type: "file", file_id: s.providerFileId }
          : s.kind === "base64"
            ? { type: "base64", media_type: s.mimeType, data: s.data }
            : { type: "text", media_type: "text/plain", data: s.text },
      });
    } else {
      const s = part.source;
      blocks.push({
        type: "image",
        source: s.kind === "file"
          ? { type: "file", file_id: s.providerFileId }
          : { type: "base64", media_type: s.mimeType as "image/png", data: s.data },
      });
    }
  }
  return blocks;
}

/** An SDK error, normalized by `providerErrors.ts`. The provider's message is classified there and dropped. */
export function classifyFailure(e: unknown): ProviderFailure {
  if (e instanceof ProviderFailure) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderFailure("timeout");
  if (e instanceof Anthropic.APIConnectionError) return new ProviderFailure("network");
  if (e instanceof Anthropic.APIError) {
    const body = e.error as { type?: string; error?: { type?: string } } | undefined;
    return providerFailure({
      status: typeof e.status === "number" ? e.status : null,
      type: body?.error?.type ?? body?.type ?? null,
      message: e.message ?? null,
    });
  }
  return new ProviderFailure("provider_error");
}

/** Claude has a files API, so a PDF or image is uploaded once and its copy reused. */
export function createClaudeWorkspaceProvider(
  apiKey: string,
): WorkspaceProvider & Required<Pick<WorkspaceProvider, "uploadFile" | "deleteFile">> {
  const client = new Anthropic({ apiKey, maxRetries: 1 });

  return {
    id: "anthropic",

    async streamChat(request: ChatRequest, onText) {
      try {
        const stream = client.messages.stream(
          {
            model: request.model,
            max_tokens: request.maxOutputTokens,
            system: request.system,
            messages: request.turns.map((turn) => ({ role: turn.role, content: toAnthropicContent(turn.parts) })),
          },
          { signal: request.signal, timeout: STREAM_TIMEOUT_MS },
        );
        stream.on("text", (delta) => onText(delta));
        const message = await stream.finalMessage();
        return {
          stopReason: normaliseStopReason(message.stop_reason),
          inputTokens: message.usage?.input_tokens ?? null,
          outputTokens: message.usage?.output_tokens ?? null,
          cacheReadTokens: message.usage?.cache_read_input_tokens ?? null,
          cacheWriteTokens: message.usage?.cache_creation_input_tokens ?? null,
        };
      } catch (e) {
        if (request.signal.aborted || e instanceof Anthropic.APIUserAbortError) throw new ProviderAborted();
        throw classifyFailure(e);
      }
    },

    async uploadFile({ bytes, filename, mimeType }) {
      try {
        const file = await toFile(Buffer.from(bytes), filename, { type: mimeType });
        const meta = await client.files.upload({ file }, { timeout: UPLOAD_TIMEOUT_MS });
        return meta.id;
      } catch (e) {
        throw classifyFailure(e);
      }
    },

    async deleteFile(providerFileId) {
      try {
        await client.files.delete(providerFileId);
      } catch (e) {
        // Already gone is what deleting wanted.
        if (e instanceof Anthropic.APIError && e.status === 404) return;
        throw classifyFailure(e);
      }
    },
  };
}
