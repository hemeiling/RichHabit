import type { FileKind } from "@/lib/aiWorkspace/types";
import { isChatModel, isImageModel, type Capability, type ModelOption } from "./models";

/**
 * Capability routing: which configured model answers a message.
 *
 *   image generation   an explicit request to create a picture, when an image
 *                      model is configured
 *   documents          a message carrying a PDF or text file, answered by the
 *                      selected conversational model
 *   text               everything else, answered by the selected model
 *
 * Deterministic on purpose. Recognising an image request is a small grammar —
 * a creation verb whose object is a picture, or a request for a picture — with
 * guards for questions about images, prompts, code and diagrams. It is not a
 * search for the word "image": "describe this image", "write a prompt for an
 * image" and "make a flowchart" all stay with the conversational model.
 */

export interface Route {
  capability: Capability;
  option: ModelOption;
}

export function routeRequest(input: {
  content: string;
  attachmentKinds?: readonly FileKind[];
  /** The model the admin chose; anything unknown falls back to the default. */
  selectedModelId?: unknown;
  catalogue: readonly ModelOption[];
}): Route | null {
  const image = input.catalogue.find(isImageModel);
  if (image && isImageGenerationRequest(input.content)) return { capability: "image_generation", option: image };

  const chat = input.catalogue.filter(isChatModel);
  const option = chat.find((o) => o.id === input.selectedModelId) ?? chat[0];
  if (!option) return null;
  const documents = (input.attachmentKinds ?? []).some((k) => k === "pdf" || k === "text");
  return { capability: documents ? "documents" : "text", option };
}

// ─────────────────────────────── English ──────────────────────────────────────

const CREATE = new Set(["generate", "create", "draw", "make", "paint", "render", "illustrate", "sketch", "design", "produce"]);
/** Verbs whose object is a picture by default: "draw a hippo". */
const DEPICT = new Set(["draw", "paint", "sketch", "illustrate"]);
const VISUAL = /^(image|picture|pic|illustration|drawing|painting|photo|photograph|artwork|cartoon|logo|icon|poster|wallpaper|avatar|sticker|portrait|comic|meme|banner|thumbnail|clipart|emoji)s?$/;
/** Linking words: they end an object, and what follows them describes it or does something else. */
const LINKS = new Set([
  "that", "which", "who", "to", "for", "from", "about", "in", "on", "into", "using", "by", "and", "or", "with", "how", "of",
]);
/** Things that are made but are not pictures: an object naming one is not an image request. */
const NOT_PICTURES = new Set([
  "code", "script", "function", "program", "component", "app", "website", "page", "prompt", "prompts", "description",
  "caption", "text", "list", "table", "report", "summary", "chart", "diagram", "graph", "flowchart", "svg", "css",
  "html", "ascii", "mermaid", "plan", "email", "story", "poem", "essay", "up", "conclusion", "conclusions",
  "attention", "comparison", "distinction", "line", "lines", "decision", "case", "sense", "progress", "sure", "money",
]);
const STOP = new Set([...LINKS, ...NOT_PICTURES]);
/** A picture word followed by one of these is about pictures, not a request for one. */
const ABOUT_PICTURES = new Set([
  "description", "descriptions", "caption", "captions", "alt", "prompt", "prompts", "recognition", "classification",
  "processing", "format", "formats", "file", "files", "size", "sizes", "compression", "resizing", "url", "urls",
  "upload", "uploader", "gallery", "carousel", "component", "tag", "editor", "generator", "model", "api",
]);
/** Before the verb, these make the sentence a question or a task about image-making. */
const QUESTION = new Set([
  "how", "what", "why", "where", "which", "explain", "prompt", "prompts", "tutorial", "tool", "tools", "photoshop",
  "figma", "midjourney", "canva", "illustrator", "code", "script", "program", "function", "api", "whether",
]);
const REQUEST_LEADS = [
  ["i", "want"], ["i", "need"], ["i'd", "like"], ["i", "would", "like"], ["give", "me"], ["can", "i", "get"],
  ["can", "i", "have"], ["could", "i", "get"], ["could", "i", "have"], ["send", "me"],
];

const startsWith = (tokens: string[], at: number, words: string[]) => words.every((w, i) => tokens[at + i] === w);

function englishClause(clause: string): boolean {
  const tokens = clause.toLowerCase().replace(/[’`]/g, "'").match(/[a-z0-9']+/g) ?? [];

  for (let i = 0; i < tokens.length; i++) {
    const verb = tokens[i];
    if (!CREATE.has(verb)) continue;
    if (tokens.slice(0, i).some((w) => QUESTION.has(w))) continue;

    let j = i + 1;
    if (tokens[j] === "me" || tokens[j] === "us") j++;
    const object = tokens.slice(j, j + 7);
    if (object.length === 0) continue;
    const stop = object.findIndex((w) => STOP.has(w));
    const visual = object.findIndex((w) => VISUAL.test(w));
    if (visual >= 0 && (stop < 0 || visual < stop)) {
      if (!ABOUT_PICTURES.has(object[visual + 1] ?? "")) return true;
      continue;
    }
    // "draw a hippo in a suit", "paint a watercolor of Paris": a depicting verb and
    // an ordinary object. The object runs to the first linking word, and only it is
    // checked, so "draw a diagram" and "draw up a plan" stay with the conversational model.
    if (DEPICT.has(verb) && /^(a|an|the|some|two|three|four|\d+)$/.test(object[0]) && object.length > 1) {
      const end = object.findIndex((w, k) => k > 0 && LINKS.has(w));
      const phrase = object.slice(1, end < 0 ? undefined : end);
      if (phrase.length > 0 && !phrase.some((w) => NOT_PICTURES.has(w))) return true;
    }
  }

  // "I'd like an image of a hippo", "give me a picture of the sea".
  for (let i = 0; i < tokens.length; i++) {
    const lead = REQUEST_LEADS.find((words) => startsWith(tokens, i, words));
    if (!lead) continue;
    const rest = tokens.slice(i + lead.length, i + lead.length + 4);
    const visual = rest.findIndex((w) => VISUAL.test(w));
    const next = rest[visual + 1] ?? tokens[i + lead.length + visual + 1];
    if (visual >= 0 && rest.slice(0, visual).every((w) => !STOP.has(w))
      && (next === "of" || next === "showing" || next === "with" || next === undefined)) {
      return true;
    }
  }
  return false;
}

// ─────────────────────────────── Chinese ──────────────────────────────────────

/** Questions, prompts and software: about image-making, not a request for an image. */
const ZH_NOT_A_REQUEST = /(怎么|怎样|如何|为什么|是什么|什么是|提示词|描述|解释|代码|脚本|程序|函数|教程|工具|网站|应用|软件|接口|组件|识别|压缩|格式|哪个|哪些|推荐)/;
/** Diagrams and charts are drawn by the conversational model, in text. */
const ZH_DIAGRAM = /(流程图|架构图|示意图|图表|思维导图|时序图|类图|甘特图|拓扑图|结构图|关系图|饼图|柱状图|折线图|表格)/;
const ZH_CREATE_PICTURE =
  /(生成|绘制|创作|制作|设计|创建|做|画)[^，。！？；,.!?;]{0,16}?(图片|图像|插画|插图|照片|相片|海报|头像|壁纸|漫画|卡通画|卡通图|贴纸|表情包|图标|logo|张图|幅图|幅画|张画)/i;
const ZH_DRAW_THING = /(画|绘制)(一|两|几|三|四|五)?(只|个|张|幅|头|条|位|匹|朵|座|棵|群|对|些)/;
const ZH_GIVE_PICTURE = /(给我|来)(一|两|几|三)?(张|幅)[^，。！？；,.!?;]{0,12}?(图|画|照片)/;

function chineseClause(clause: string): boolean {
  if (ZH_NOT_A_REQUEST.test(clause) || ZH_DIAGRAM.test(clause)) return false;
  return ZH_CREATE_PICTURE.test(clause) || ZH_DRAW_THING.test(clause) || ZH_GIVE_PICTURE.test(clause);
}

/** Whether a message explicitly asks for a picture to be created. */
export function isImageGenerationRequest(content: string): boolean {
  const text = content.trim().slice(0, 2000);
  if (!text) return false;
  const clauses = text.split(/[.!?;\n。！？；]+/).map((c) => c.trim()).filter(Boolean);
  return clauses.some((clause) => (/[㐀-鿿]/.test(clause) ? chineseClause(clause) : englishClause(clause)));
}
