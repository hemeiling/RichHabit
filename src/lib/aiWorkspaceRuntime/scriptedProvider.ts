import {
  ProviderAborted, ProviderFailure,
  type ChatRequest, type ChatResult, type ProviderPart, type WorkspaceProvider,
} from "./provider";

/**
 * A scripted stand-in for Claude, so browser suites can drive streaming, Stop,
 * Continue, Retry and failures deterministically and without spending money.
 *
 * Reachable only through `scriptedProviderAllowed()`: a local test instance that
 * explicitly asked for it. The reply echoes the latest message and describes the
 * request it was given — how many turns, whether project instructions were
 * present, which parts were attached and how — so a suite can verify what would
 * have reached a model without any access to the request itself.
 *
 * Markers in the latest message choose the script:
 *   [[slow]]      a long, slow reply, for Stop
 *   [[length]]    ends at the output limit, for Continue
 *   [[fail]]      fails part way the first time it is asked, for Retry
 *   [[markdown]]  a reply with a list, a table and a code block
 */

interface ScriptState { uploads: number; deletes: number; next: number; failed?: Set<string> }

declare global {
  // eslint-disable-next-line no-var
  var __aiWorkspaceScript: ScriptState | undefined;
}

const state = (): Required<ScriptState> => {
  const s = (globalThis.__aiWorkspaceScript ??= { uploads: 0, deletes: 0, next: 1 });
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
  ].join(" ");
}

export function scriptedProvider(): WorkspaceProvider {
  return {
    id: "scripted",

    async uploadFile() {
      const s = state();
      s.uploads += 1;
      return `scripted_file_${s.next++}`;
    },

    async deleteFile() {
      state().deletes += 1;
    },

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
}
