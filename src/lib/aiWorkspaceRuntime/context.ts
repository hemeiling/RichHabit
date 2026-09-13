import { chainText, includeInHistory, visibleChain } from "@/lib/aiWorkspace/lifecycle";
import type { AiAttachment, AiMessage } from "@/lib/aiWorkspace/types";

/**
 * What a model request may contain, assembled from exactly five layers:
 *
 *   1. the workspace's own instructions,
 *   2. the current project's instructions, when the conversation is in one,
 *   3. selected history from this conversation,
 *   4. files deliberately attached to messages in that history, and
 *   5. the message being answered, with its attachments.
 *
 * Pure: it receives the conversation's messages and nothing else. There is no
 * parameter through which RichHabit's own data — intentions, habits, priorities,
 * journals, dates, Community, account details — could arrive, and the boundary
 * tests keep it that way. A project's file library is not a layer: a library
 * file reaches the model only when it was attached to a message.
 */

export const WORKSPACE_INSTRUCTIONS = [
  "You are a general-purpose AI assistant, available to the admin through their private AI Workspace. Help with whatever they bring: writing and editing, research and analysis, coding and architecture, brainstorming, translation, business questions, general knowledge, and documents or images they attach.",
  "The workspace is hosted inside the RichHabit app, but you are not a habit coach, and your help is not limited to RichHabit, habits, intentions, priorities or productivity. Take on that kind of role only if the admin asks for it.",
  "You cannot see RichHabit's database, its users, or anyone's habits, intentions, priorities, journals, important dates or Community activity. The only material available to you is this conversation, any project instructions below, and files the admin attached. If asked about RichHabit user data, say that you don't have access to it.",
  "Reply in the language of the admin's latest message unless they ask for another. Use Markdown where it helps: short headings, lists, tables, and fenced code blocks with a language tag. Be clear and direct.",
].join("\n\n");

/** Added when an image model is configured: pictures are made by it, not by the conversational model. */
export const IMAGE_GENERATION_AVAILABLE =
  "This workspace can also create images. When the admin asks for a picture, a separate image model makes it and the picture appears in the conversation; earlier ones are noted in the history as [Generated image]. If the admin seems to want a new picture without asking for one outright, tell them they can ask, for example \"Create an image of …\".";

/** Added when no image model is configured, so the answer is honest and still useful. */
export const IMAGE_GENERATION_UNAVAILABLE =
  "Image generation isn't turned on in this workspace. If the admin asks you to create a picture, say so in one sentence, then offer something useful instead, such as a detailed description.";

export const CONTINUE_INSTRUCTION =
  "Continue your previous reply from exactly where it stopped. Do not repeat anything you already wrote and do not add a preamble.";

export type ContextPart =
  | { type: "text"; text: string }
  | { type: "file"; attachment: AiAttachment }
  | { type: "removed-file"; filename: string };

export interface ContextTurn {
  role: "user" | "assistant";
  parts: ContextPart[];
}

export type ContextMode =
  | { kind: "reply"; userMessageId: string }
  | { kind: "continue"; targetMessageId: string }
  | { kind: "retry"; targetMessageId: string };

export interface AssembledContext {
  system: string;
  turns: ContextTurn[];
  /** Stored messages represented in the request. */
  contextMessages: number;
  estimatedTokens: number;
  /** Earlier exchanges left out to stay inside the budget. */
  droppedExchanges: number;
}

export interface ContextOptions {
  /** Whether an image model is configured, which the conversational model is told honestly. */
  imageGeneration?: boolean;
}

export function systemPrompt(projectInstructions: string | null | undefined, options: ContextOptions = {}): string {
  const base = `${WORKSPACE_INSTRUCTIONS}\n\n${options.imageGeneration ? IMAGE_GENERATION_AVAILABLE : IMAGE_GENERATION_UNAVAILABLE}`;
  const instructions = projectInstructions?.trim();
  if (!instructions) return base;
  return `${base}\n\nThe admin set these instructions for the current project. Follow them in this conversation unless they conflict with the rules above.\n<project_instructions>\n${instructions}\n</project_instructions>`;
}

/**
 * An earlier answer as history text. A generated picture cannot go back to a
 * model as part of an assistant turn, so it is named instead, and a
 * conversational model can still refer to it.
 */
export function historyText(chain: readonly AiMessage[]): string {
  const notes = chain.flatMap((m) => m.attachments)
    .filter((a) => a.kind === "image")
    .map((a) => (a.removed ? "[Generated image, since removed]" : `[Generated image: ${a.originalFilename}]`));
  return [chainText(chain), ...notes].filter((part) => part.trim()).join("\n\n");
}

/**
 * A deliberately rough token estimate, used only to decide how much history to
 * send. Ideographs count as a token each; other text as four characters a token.
 */
export function estimateTextTokens(text: string): number {
  let wide = 0;
  let other = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xff00 && c <= 0xffef)) wide++;
    else other++;
  }
  return wide + Math.ceil(other / 4);
}

export function estimateAttachmentTokens(a: AiAttachment): number {
  if (a.removed) return 20;
  if (a.kind === "image") return 1600;
  if (a.kind === "pdf") return Math.max(1500, Math.ceil(a.byteSize / 60));
  return Math.ceil(a.byteSize / 3);
}

const estimateTurn = (turn: ContextTurn) => turn.parts.reduce((sum, p) =>
  sum + (p.type === "text" ? estimateTextTokens(p.text) : p.type === "file" ? estimateAttachmentTokens(p.attachment) : 20), 4);

/** A user message as a turn: its files, in the order attached, then its words. */
export function userTurn(message: AiMessage): ContextTurn {
  const parts: ContextPart[] = [...message.attachments]
    .sort((a, b) => a.position - b.position)
    .map((a): ContextPart => (a.removed
      ? { type: "removed-file", filename: a.originalFilename }
      : { type: "file", attachment: a }));
  if (message.content.trim()) parts.push({ type: "text", text: message.content });
  return { role: "user", parts };
}

/** Adjacent turns from the same side become one turn, as the API expects. */
function mergeTurns(turns: ContextTurn[]): ContextTurn[] {
  const merged: ContextTurn[] = [];
  for (const turn of turns) {
    if (turn.parts.length === 0) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.role === turn.role) previous.parts.push(...turn.parts);
    else merged.push({ role: turn.role, parts: [...turn.parts] });
  }
  return merged;
}

/**
 * @param messages the conversation, oldest first, as stored
 * @param newMessageId the streaming reply this request will fill, left out of the context
 */
export function assembleContext(
  messages: readonly AiMessage[],
  mode: ContextMode,
  projectInstructions: string | null,
  budget: { targetTokens: number },
  newMessageId: string,
  options: ContextOptions = {},
): AssembledContext {
  const all = messages.filter((m) => m.id !== newMessageId);
  const byId = new Map(all.map((m) => [m.id, m]));
  const answersTo = (userMessageId: string) =>
    all.filter((m) => m.role === "assistant" && m.replyToMessageId === userMessageId);

  let anchor: AiMessage | undefined;
  let tail: ContextTurn[] = [];
  let tailMessages = 0;

  if (mode.kind === "reply") {
    anchor = byId.get(mode.userMessageId);
  } else {
    const target = byId.get(mode.targetMessageId);
    if (!target || target.role !== "assistant" || !target.replyToMessageId) throw new Error("context target not loaded");
    anchor = byId.get(target.replyToMessageId);
    if (mode.kind === "continue") {
      const chain = visibleChain(answersTo(target.replyToMessageId));
      const upTo = chain.slice(0, chain.findIndex((m) => m.id === target.id) + 1);
      const partial = chainText(upTo);
      // A reply stopped before it said anything is simply asked again.
      if (partial.trim()) {
        tail = [
          { role: "assistant", parts: [{ type: "text", text: partial }] },
          { role: "user", parts: [{ type: "text", text: CONTINUE_INSTRUCTION }] },
        ];
        tailMessages = upTo.length;
      }
    }
  }
  if (!anchor || anchor.role !== "user") throw new Error("context anchor not loaded");

  const system = systemPrompt(projectInstructions, options);
  const anchorTurn = userTurn(anchor);
  const fixed = estimateTextTokens(system) + estimateTurn(anchorTurn) + tail.reduce((s, t) => s + estimateTurn(t), 0);

  // Earlier exchanges: every earlier message the admin wrote, and an answer only
  // when it is one the lifecycle rules allow back into history.
  const anchorIndex = all.indexOf(anchor);
  const exchanges = all.slice(0, anchorIndex).filter((m) => m.role === "user").map((user) => {
    const turns = [userTurn(user)];
    let count = 1;
    const chain = visibleChain(answersTo(user.id));
    if (includeInHistory(chain, null)) {
      const text = historyText(chain);
      if (text.trim()) {
        turns.push({ role: "assistant", parts: [{ type: "text", text }] });
        count += chain.length;
      }
    }
    return { turns, count, tokens: turns.reduce((s, t) => s + estimateTurn(t), 0) };
  });

  // Newest first, until the budget is spent; everything older than the first
  // exchange that does not fit is left out, so history never has gaps.
  let available = budget.targetTokens - fixed;
  let keepFrom = exchanges.length;
  for (let i = exchanges.length - 1; i >= 0; i--) {
    if (exchanges[i].tokens > available) break;
    available -= exchanges[i].tokens;
    keepFrom = i;
  }
  const kept = exchanges.slice(keepFrom);

  const turns = mergeTurns([...kept.flatMap((e) => e.turns), anchorTurn, ...tail]);
  return {
    system,
    turns,
    contextMessages: kept.reduce((s, e) => s + e.count, 0) + 1 + tailMessages,
    estimatedTokens: budget.targetTokens - available,
    droppedExchanges: keepFrom,
  };
}
