import { CHAT_CAPABILITIES, IMAGE_CAPABILITIES, type ModelOption } from "./models";
import {
  ProviderAborted, ProviderFailure,
  type ChatRequest, type ChatResult, type ImageProvider, type ImageResult, type ProviderPart, type WorkspaceProvider,
} from "./provider";

/**
 * Scripted stand-ins for the workspace's models, so browser suites can drive
 * streaming, Stop, Continue, Retry, model switching, image generation and
 * failures deterministically and without spending money.
 *
 * Reachable only through `scriptedProviderAllowed()`: a local test instance that
 * explicitly asked for it. A reply echoes the latest message and describes the
 * request it was given — which model, how many turns, whether project
 * instructions were present, which parts were attached and how — so a suite can
 * verify what would have reached a model without any access to the request.
 *
 * Three models, as a fully configured workspace has them: a Claude stand-in with
 * a files API ("scripted"), a Gemini stand-in without one ("scripted-inline"),
 * and an image model that returns a real PNG.
 *
 * Markers in the latest message choose the script:
 *   [[slow]]      a long, slow reply (or a slow picture), for Stop
 *   [[length]]    ends at the output limit, for Continue
 *   [[fail]]      fails part way the first time it is asked, for Retry
 *   [[markdown]]  a reply with a list, a table and a code block
 *   [[refuse]]    the image model declines, with words and no picture
 */

interface ScriptState { uploads: number; deletes: number; images: number; next: number; failed?: Set<string> }

declare global {
  // eslint-disable-next-line no-var
  var __aiWorkspaceScript: ScriptState | undefined;
}

const state = (): Required<ScriptState> => {
  const s = (globalThis.__aiWorkspaceScript ??= { uploads: 0, deletes: 0, images: 0, next: 1 });
  s.images ??= 0;
  s.failed ??= new Set();
  return s as Required<ScriptState>;
};

const MARKDOWN = [
  "Here is a **short** plan.",
  "",
  "1. Draft the outline",
  "2. Review it",
  "",
  "| Step | Owner |",
  "| --- | --- |",
  "| Outline | Admin |",
  "",
  "```ts",
  "export function total(values: number[]): number {",
  "  return values.reduce((sum, v) => sum + v, 0);",
  "}",
  "```",
].join("\n");

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(new ProviderAborted());
  const onAbort = () => { clearTimeout(timer); reject(new ProviderAborted()); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
  signal.addEventListener("abort", onAbort, { once: true });
});

/** The configured models of a fully set-up workspace, backed by the scripts below. */
export function scriptedCatalogue(): ModelOption[] {
  return [
    { id: "claude", provider: "scripted", model: "claude-sonnet-5", label: "Claude Sonnet 5", capabilities: CHAT_CAPABILITIES },
    { id: "gemini", provider: "scripted-inline", model: "gemini-3.8-flash", label: "Gemini 3.8 Flash", capabilities: CHAT_CAPABILITIES },
    { id: "image", provider: "scripted", model: "gemini-3.1-flash-image", label: "Nano Banana 2", capabilities: IMAGE_CAPABILITIES },
  ];
}

function describePart(part: ProviderPart): string {
  if (part.type === "text") return "text";
  if (part.type === "document") return `document:${part.source.kind}:${part.title}`;
  return `image:${part.source.kind}`;
}

/** What the request contained, in words a suite can match. Never file contents. */
export function describeRequest(request: ChatRequest): string {
  const last = request.turns[request.turns.length - 1];
  const earlier = request.turns.slice(0, -1).flatMap((t) => t.parts).filter((p) => p.type !== "text").length;
  return [
    `turns=${request.turns.length}`,
    `roles=${request.turns.map((t) => t.role[0]).join("")}`,
    `project=${request.system.includes("<project_instructions>") ? "yes" : "no"}`,
    `parts=${last.parts.map(describePart).join(",") || "none"}`,
    `earlier_files=${earlier}`,
    `model=${request.model}`,
  ].join(" ");
}

export function scriptedProvider(id = "scripted"): WorkspaceProvider {
  const provider: WorkspaceProvider = {
    id,

    async streamChat(request, onText): Promise<ChatResult> {
      const last = request.turns[request.turns.length - 1];
      const said = last.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
      const has = (marker: string) => said.includes(`[[${marker}]]`);
      // A failure that clears on Retry, as an overloaded service does.
      const failNow = has("fail") && !state().failed.has(said);
      if (failNow) state().failed.add(said);

      const body = has("markdown")
        ? MARKDOWN
        : has("slow")
          ? Array.from({ length: 160 }, (_, i) => `word${i}`).join(" ")
          : `Echo: ${said.replace(/\[\[\w+\]\]/g, "").trim() || "(files only)"}`;
      const text = `${body}\n\n[${describeRequest(request)}]`;
      const chunks = text.match(/[\s\S]{1,8}/g) ?? [];
      const delay = has("slow") ? 60 : 15;

      for (let i = 0; i < chunks.length; i++) {
        if (failNow && i === Math.floor(chunks.length / 2)) throw new ProviderFailure("overloaded", 529);
        await sleep(delay, request.signal);
        onText(chunks[i]);
      }
      return {
        stopReason: has("length") ? "max_tokens" : "end_turn",
        inputTokens: request.turns.length * 10,
        outputTokens: chunks.length,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
    },
  };
  // Only the Claude stand-in has a files API; the Gemini stand-in takes files inline.
  if (id !== "scripted-inline") {
    provider.uploadFile = async () => {
      const s = state();
      s.uploads += 1;
      return `scripted_file_${s.next++}`;
    };
    provider.deleteFile = async () => {
      state().deletes += 1;
    };
  }
  return provider;
}

export function scriptedImageProvider(id = "scripted"): ImageProvider {
  return {
    id,
    async generateImage(request): Promise<ImageResult> {
      const has = (marker: string) => request.prompt.includes(`[[${marker}]]`);
      const chinese = /[㐀-鿿]/.test(request.prompt);
      const failNow = has("fail") && !state().failed.has(`image:${request.prompt}`);
      if (failNow) state().failed.add(`image:${request.prompt}`);
      await sleep(has("slow") ? 4000 : 120, request.signal);
      if (failNow) throw new ProviderFailure("overloaded", 503);
      const described = `[image model=${request.model} refs=${request.references.length} size=${request.imageSize}]`;
      if (has("refuse")) {
        return { images: [], text: `I can't create that picture. ${described}`, stopReason: "refusal", inputTokens: 5, outputTokens: 5 };
      }
      state().images += 1;
      return {
        images: [{ mimeType: "image/png", bytes: scriptedPng(request.prompt) }],
        text: `${chinese ? "这是为你生成的图片。" : "Here is your picture."} ${described}`,
        stopReason: "end_turn",
        inputTokens: 12,
        outputTokens: 1290,
      };
    },
  };
}

// ─────────────────────────── a real PNG, without dependencies ────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typed = new Uint8Array(4 + data.length);
  typed.set(Array.from(type, (c) => c.charCodeAt(0)));
  typed.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length));
  out.set(typed, 4);
  out.set(u32(crc32(typed)), 8 + data.length);
  return out;
}

/** A zlib stream of stored (uncompressed) deflate blocks: valid, and needs no compressor. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out.set([0x78, 0x01]);
  let at = 2;
  for (let i = 0; i < blocks; i++) {
    const block = raw.subarray(i * 65535, (i + 1) * 65535);
    out.set([i === blocks - 1 ? 1 : 0, block.length & 255, block.length >>> 8, ~block.length & 255, (~block.length >>> 8) & 255], at);
    out.set(block, at + 5);
    at += 5 + block.length;
  }
  out.set(u32(adler32(raw)), at);
  return out;
}

/** A small picture that differs by prompt: a coloured ground with a round grey animal on it. */
export function scriptedPng(seed: string, size = 256): Uint8Array {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  const ground = [150 + (h & 63), 185 + ((h >>> 6) & 55), 200 + ((h >>> 12) & 55)];
  const body = [118, 110, 150];
  const row = size * 3 + 1;
  const raw = new Uint8Array(row * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bx = (x - size * 0.45) / (size * 0.32);
      const by = (y - size * 0.62) / (size * 0.22);
      const hx = (x - size * 0.74) / (size * 0.15);
      const hy = (y - size * 0.42) / (size * 0.15);
      raw.set(bx * bx + by * by < 1 || hx * hx + hy * hy < 1 ? body : ground, y * row + 1 + x * 3);
    }
  }
  const header = new Uint8Array([...u32(size), ...u32(size), 8, 2, 0, 0, 0]);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header), pngChunk("IDAT", zlibStored(raw)), pngChunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}
