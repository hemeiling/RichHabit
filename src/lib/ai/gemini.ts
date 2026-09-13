import {
  ProviderAborted, ProviderFailure,
  type ChatRequest, type ChatResult, type ImageProvider, type ImageRequest, type ImageResult,
  type ProviderPart, type ProviderTurn, type WorkspaceProvider,
} from "@/lib/aiWorkspaceRuntime/provider";

/**
 * Gemini, through Google's Gemini API over REST. Server-only, and the only file
 * in the application that talks to Google: the AI Workspace's Gemini
 * conversations and its image generation both go through here.
 *
 * `generateContent` rather than the newer Interactions API, because it is
 * stateless: every request carries its own history, as the workspace already
 * assembles it, and nothing is kept at Google to be retrieved later. Files are
 * sent inline with the request that needs them; there is no Google copy to
 * manage or delete.
 *
 * The key travels only in the `x-goog-api-key` header. Errors are reduced to a
 * workspace code and an HTTP status before they leave this file: Google's error
 * text can quote the request, and none of it may reach a log.
 */

const API = "https://generativelanguage.googleapis.com/v1beta";
/** Long replies stream for a while; this bounds a request that never ends. */
const STREAM_TIMEOUT_MS = 10 * 60 * 1000;
const IMAGE_TIMEOUT_MS = 3 * 60 * 1000;
const IMAGE_SIZES = new Set(["512px", "1K", "2K", "4K"]);
/** More than this in one reply is not what anyone asked for. */
const MAX_IMAGES = 4;

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
export interface GeminiContent { role: "user" | "model"; parts: GeminiPart[] }

interface ResponsePart {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType?: string; data?: string };
}
interface GenerateResponse {
  candidates?: { content?: { parts?: ResponsePart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number;
  };
  error?: { code?: number; status?: string; message?: string };
}

const escapeAttribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toGeminiParts(parts: ProviderPart[]): GeminiPart[] {
  const out: GeminiPart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      if (part.text.trim()) out.push({ text: part.text });
    } else if (part.type === "document") {
      const s = part.source;
      if (s.kind === "base64") out.push({ inlineData: { mimeType: s.mimeType, data: s.data } });
      else if (s.kind === "text") out.push({ text: `<document title="${escapeAttribute(part.title)}">\n${s.text}\n</document>` });
      // Gemini has no stored copy of a workspace file to point at.
      else throw new ProviderFailure("unreadable_file");
    } else {
      const s = part.source;
      if (s.kind !== "base64") throw new ProviderFailure("unreadable_file");
      out.push({ inlineData: { mimeType: s.mimeType, data: s.data } });
    }
  }
  return out;
}

/** Workspace turns as Gemini contents: "model" for the assistant, no empty turns, one turn per side in a row. */
export function toGeminiContents(turns: ProviderTurn[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const turn of turns) {
    const parts = toGeminiParts(turn.parts);
    if (parts.length === 0) continue;
    const role = turn.role === "assistant" ? "model" : "user";
    const previous = contents[contents.length - 1];
    if (previous && previous.role === role) previous.parts.push(...parts);
    else contents.push({ role, parts });
  }
  return contents;
}

/** Gemini's finish and block reasons, reduced to the stop reasons the workspace acts on. */
export function geminiStopReason(finishReason: string | null | undefined, blockReason?: string | null): string {
  if (blockReason) return "refusal";
  switch (finishReason) {
    case "MAX_TOKENS": return "max_tokens";
    case "SAFETY": case "RECITATION": case "BLOCKLIST": case "PROHIBITED_CONTENT": case "SPII":
    case "IMAGE_SAFETY": case "IMAGE_PROHIBITED_CONTENT": case "IMAGE_RECITATION": case "IMAGE_OTHER":
      return "refusal";
    default: return "end_turn";
  }
}

/** An error body, as a workspace code and a status. Google's message is read here and dropped. */
export function classifyGeminiError(status: number, body: GenerateResponse | null): ProviderFailure {
  const kind = String(body?.error?.status ?? "");
  const message = String(body?.error?.message ?? "").toLowerCase();
  if (status === 429 || kind === "RESOURCE_EXHAUSTED") return new ProviderFailure("rate_limited", status || 429);
  if (status === 503 || kind === "UNAVAILABLE") return new ProviderFailure("overloaded", status || 503);
  if (status === 504 || status === 408 || kind === "DEADLINE_EXCEEDED") return new ProviderFailure("timeout", status || null);
  if (status === 400 && /token|too long|exceeds the maximum|context window/.test(message)) {
    return new ProviderFailure("context_too_long", status);
  }
  if (status === 400 && /\b(pdf|image|document|file|mime|inline)\b/.test(message)) return new ProviderFailure("unreadable_file", status);
  return new ProviderFailure("provider_error", status || null);
}

function transportFailure(e: unknown, signal: AbortSignal): Error {
  if (e instanceof ProviderFailure || e instanceof ProviderAborted) return e;
  if (signal.aborted) return new ProviderAborted();
  if ((e as { name?: string } | null)?.name === "TimeoutError") return new ProviderFailure("timeout");
  return new ProviderFailure("network");
}

/** Server-sent events: each `data:` payload parsed as JSON, `[DONE]` ignored. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<GenerateResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  const flush = function* () {
    const payload = data.join("\n").trim();
    data = [];
    if (!payload || payload === "[DONE]") return;
    try {
      yield JSON.parse(payload) as GenerateResponse;
    } catch {
      throw new ProviderFailure("malformed_response");
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (line === "") yield* flush();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (done) break;
  }
  if (buffer.startsWith("data:")) data.push(buffer.slice(5).replace(/^ /, ""));
  yield* flush();
}

const count = (...values: (number | undefined)[]) =>
  values.some((v) => typeof v === "number") ? values.reduce<number>((sum, v) => sum + (v ?? 0), 0) : null;

async function post(apiKey: string, url: string, body: unknown, signal: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
}

export function createGeminiWorkspaceProvider(apiKey: string): WorkspaceProvider {
  return {
    id: "google",

    async streamChat(request: ChatRequest, onText): Promise<ChatResult> {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(STREAM_TIMEOUT_MS)]);
      let finishReason: string | null = null;
      let blockReason: string | null = null;
      let usage: GenerateResponse["usageMetadata"] | null = null;
      try {
        const contents = toGeminiContents(request.turns);
        const res = await post(apiKey, `${API}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`, {
          systemInstruction: { parts: [{ text: request.system }] },
          contents,
          generationConfig: { maxOutputTokens: request.maxOutputTokens },
        }, signal);
        if (!res.ok || !res.body) throw classifyGeminiError(res.status, await res.json().catch(() => null));

        for await (const event of readEvents(res.body)) {
          if (event.error) throw classifyGeminiError(Number(event.error.code) || 0, event);
          blockReason ??= event.promptFeedback?.blockReason ?? null;
          if (event.usageMetadata) usage = event.usageMetadata;
          const candidate = event.candidates?.[0];
          for (const part of candidate?.content?.parts ?? []) {
            // Thought summaries and signatures are the model's working, not the reply.
            if (!part.thought && typeof part.text === "string" && part.text) onText(part.text);
          }
          if (candidate?.finishReason) finishReason = candidate.finishReason;
        }
      } catch (e) {
        throw transportFailure(e, request.signal);
      }
      if (!finishReason && !blockReason) throw new ProviderFailure("malformed_response");
      return {
        stopReason: geminiStopReason(finishReason, blockReason),
        inputTokens: usage?.promptTokenCount ?? null,
        outputTokens: count(usage?.candidatesTokenCount, usage?.thoughtsTokenCount),
        cacheReadTokens: usage?.cachedContentTokenCount ?? null,
        cacheWriteTokens: null,
      };
    },
  };
}

export function createGeminiImageProvider(apiKey: string): ImageProvider {
  return {
    id: "google",

    async generateImage(request: ImageRequest): Promise<ImageResult> {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(IMAGE_TIMEOUT_MS)]);
      let body: GenerateResponse;
      try {
        const res = await post(apiKey, `${API}/models/${encodeURIComponent(request.model)}:generateContent`, {
          contents: [{
            role: "user",
            parts: [
              ...request.references.map((r) => ({ inlineData: { mimeType: r.mimeType, data: r.data } })),
              { text: request.prompt },
            ],
          }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { imageSize: IMAGE_SIZES.has(request.imageSize) ? request.imageSize : "1K" },
          },
        }, signal);
        if (!res.ok) throw classifyGeminiError(res.status, await res.json().catch(() => null));
        body = await res.json().catch(() => {
          throw new ProviderFailure("malformed_response");
        });
      } catch (e) {
        throw transportFailure(e, request.signal);
      }

      const candidate = body.candidates?.[0];
      const blockReason = body.promptFeedback?.blockReason ?? null;
      if (!candidate && !blockReason) throw new ProviderFailure("malformed_response");
      // Interim "thought" images are drafts; only the final pictures are the answer.
      const parts = (candidate?.content?.parts ?? []).filter((p) => !p.thought);
      const images = parts
        .filter((p) => typeof p.inlineData?.data === "string" && p.inlineData.data.length > 0)
        .slice(0, MAX_IMAGES)
        .map((p) => ({ mimeType: String(p.inlineData?.mimeType ?? ""), bytes: new Uint8Array(Buffer.from(p.inlineData?.data as string, "base64")) }));
      const usage = body.usageMetadata;
      return {
        images,
        text: parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("").trim(),
        stopReason: geminiStopReason(candidate?.finishReason, blockReason),
        inputTokens: usage?.promptTokenCount ?? null,
        outputTokens: count(usage?.candidatesTokenCount, usage?.thoughtsTokenCount),
      };
    },
  };
}
