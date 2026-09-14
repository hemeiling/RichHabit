import type { FileKind } from "@/lib/aiWorkspace/types";
import { isChatModel, isImageModel, type Capability, type ModelOption } from "./models";

/**
 * Capability routing: which configured model answers a message.
 *
 *   image generation   a request to create a picture, when an image model is
 *                      configured, whichever conversational model is selected
 *   documents          a message carrying a PDF or text file, answered by the
 *                      selected conversational model
 *   text               everything else, answered by the selected model
 *
 * The model selector is about conversation and reasoning only; nobody has to
 * select an image model before asking for a picture.
 *
 * Recognising a picture request is deterministic and deliberately
 * conservative: a picture costs money and takes seconds, so anything ambiguous
 * stays with the conversational model. A message asks for a picture when it has
 *   - an image object (picture, illustration, poster, cartoon… / 图片、插画、海报…)
 *     and a way of asking for one: a creation verb (generate, make, draw… /
 *     生成、做、画…), a request ("please", "I'd like" / 帮我、给我、来一张), or
 *     nothing but a short noun phrase ("hippo picture" / 河马图片), or
 *   - a drawing verb with an ordinary object ("draw me a hippo" / 画一只河马),
 * and none of the exclusions: describing, explaining or editing an image,
 * prompts and wording, code, diagrams and charts, questions, talk about image
 * tools, and references to an existing image ("this picture" / 这张图片).
 */

export interface Route {
  capability: Capability;
  option: ModelOption;
}

export function routeRequest(input: {
  content: string;
  attachmentKinds?: readonly FileKind[];
  /** Files are attached, even when their kinds are not known yet. */
  hasAttachments?: boolean;
  /** The conversational model the admin chose; anything unknown falls back to the default. */
  selectedModelId?: unknown;
  catalogue: readonly ModelOption[];
}): Route | null {
  const image = input.catalogue.find(isImageModel);
  const hasAttachments = Boolean(input.hasAttachments) || (input.attachmentKinds?.length ?? 0) > 0;
  if (image && isImageGenerationRequest(input.content, { hasAttachments })) {
    return { capability: "image_generation", option: image };
  }

  const chat = input.catalogue.filter(isChatModel);
  const option = chat.find((o) => o.id === input.selectedModelId) ?? chat[0];
  if (!option) return null;
  const documents = (input.attachmentKinds ?? []).some((k) => k === "pdf" || k === "text");
  return { capability: documents ? "documents" : "text", option };
}

// ─────────────────────────────── English ──────────────────────────────────────

const CREATE = new Set([
  "generate", "create", "draw", "make", "paint", "render", "illustrate", "sketch", "design", "produce", "visualize",
  "visualise", "imagine", "depict",
]);
/** Verbs whose object is a picture even when no image word is used: "draw me a hippo". */
const DEPICT = new Set(["draw", "paint", "sketch", "illustrate", "depict"]);
const IMAGE_OBJECT = /^(image|picture|pic|photo|photograph|illustration|drawing|painting|artwork|art|cartoon|logo|icon|poster|wallpaper|avatar|sticker|portrait|comic|meme|banner|thumbnail|clipart|emoji|watercolou?r|doodle|sketch|rendering)s?$/;
/** Any of these makes the message about something other than making a picture. */
const NOT_IMAGE = new Set([
  // describing, judging, editing or handling an image
  "describe", "description", "descriptions", "explain", "explanation", "analyze", "analyse", "analysis", "caption",
  "captions", "alt", "summarize", "summarise", "summary", "identify", "recognize", "recognise", "recognition",
  "classify", "compare", "review", "critique", "rate", "improve", "fix", "edit", "resize", "crop", "compress",
  "convert", "format", "upload", "uploads", "file", "files", "size", "url", "gallery", "carousel", "ocr", "read",
  "translate",
  // prompts and wording
  "prompt", "prompts", "wording", "copy", "copywriting", "slogan", "tagline", "headline", "text", "idea", "ideas",
  "tips", "advice", "email", "report", "outline", "list",
  // code and data
  "code", "svg", "css", "html", "canvas", "python", "javascript", "typescript", "function", "program", "script",
  "component", "api", "react", "app", "website", "page", "regex", "sql", "json", "data",
  // diagrams and charts
  "diagram", "diagrams", "flowchart", "flowcharts", "chart", "charts", "graph", "graphs", "table", "tables",
  "mermaid", "uml", "ascii", "wireframe", "mockup", "spreadsheet",
  // talk about image-making rather than a request for an image
  "generation", "generator", "generators", "model", "models", "tool", "tools", "photoshop", "figma", "midjourney",
  "canva", "dall", "illustrator",
  // questions anywhere in the sentence
  "how", "why", "what", "which",
  // other senses of the verbs
  "up", "conclusion", "conclusions", "attention", "comparison", "distinction", "line", "lines", "sense", "sure",
  "money", "progress", "decision", "case", "mind", "plan",
]);
/** Before an image word, these point at an image that already exists. */
const EXISTING = new Set(["this", "that", "these", "those", "the", "my", "your", "our", "attached", "above", "uploaded", "existing", "same"]);
/** A sentence opening with these is a question, unless it is "can you…", "could you…". */
const QUESTION_OPENERS = new Set(["is", "are", "was", "were", "does", "do", "did", "should", "shall", "who", "when", "where"]);
const REQUEST_PHRASES = [
  ["please"], ["pls"], ["plz"], ["i", "want"], ["i", "need"], ["i'd", "like"], ["i", "would", "like"], ["give", "me"],
  ["get", "me"], ["send", "me"], ["show", "me"], ["can", "i", "get"], ["can", "i", "have"], ["could", "i", "get"],
  ["could", "i", "have"],
];
/** Words that do not name a subject: "nice picture" is a reaction, not a request. */
const FILLER = new Set([
  "a", "an", "one", "some", "nice", "great", "cool", "beautiful", "lovely", "awesome", "amazing", "good", "bad",
  "pretty", "cute", "love", "like", "wow", "ok", "okay", "thanks", "thank", "you", "new", "another",
]);

const hasPhrase = (tokens: string[], phrase: string[]) =>
  tokens.some((_, i) => phrase.every((word, k) => tokens[i + k] === word));

function englishClause(clause: string, hasAttachments: boolean): boolean {
  const tokens: string[] = clause.toLowerCase().replace(/[’`]/g, "'").match(/[a-z0-9']+/g) ?? [];
  if (tokens.length === 0) return false;
  if (tokens.some((w) => NOT_IMAGE.has(w))) return false;
  if (QUESTION_OPENERS.has(tokens[0] ?? "")) return false;

  const objects = tokens.map((w, i) => (IMAGE_OBJECT.test(w) ? i : -1)).filter((i) => i >= 0);
  if (objects.some((i) => EXISTING.has(tokens[i - 1] ?? ""))) return false;
  const object = objects[0] ?? -1;
  const verb = tokens.findIndex((w) => CREATE.has(w));

  // "generate an image of a hippo", "make me a cartoon hippo", "visualize it as an image"
  if (object >= 0 && verb >= 0 && verb < object && object - verb <= 8) return true;

  // "draw me a hippo": a drawing verb and an object.
  if (verb >= 0 && DEPICT.has(tokens[verb])) {
    const rest = tokens.slice(tokens[verb + 1] === "me" || tokens[verb + 1] === "us" ? verb + 2 : verb + 1);
    if (rest.some((w) => !FILLER.has(w))) return true;
  }

  if (object < 0) return false;
  // "hippo picture please", "I'd like an image of a lighthouse"
  if (REQUEST_PHRASES.some((phrase) => hasPhrase(tokens, phrase))) return true;
  // "hippo picture": only a short noun phrase with a subject, and no files that it could be about.
  return !hasAttachments && tokens.length <= 4 && tokens.some((w) => !IMAGE_OBJECT.test(w) && !FILLER.has(w));
}

// ─────────────────────────────── Chinese ──────────────────────────────────────

/** Describing, editing, prompts and wording, code, diagrams, questions, tools. */
const ZH_NOT_IMAGE = /(描述|解释|说明|分析|总结|识别|评价|点评|修改|编辑|优化|改进|翻译|提示词|咒语|prompt|文案|标语|文字|写|代码|脚本|程序|函数|接口|组件|网站|网页|应用|软件|工具|教程|svg|html|css|流程图|架构图|示意图|图表|思维导图|时序图|类图|甘特图|拓扑图|结构图|关系图|饼图|柱状图|折线图|表格|数据|怎么|怎样|如何|为什么|是什么|什么样|哪|压缩|格式|尺寸|上传|模型|生成器)/i;
/** An image that already exists: 这张图片, 上面的照片. */
const ZH_EXISTING = /(这|那|此|上面|上传|附件|附上)的?[张幅个]?(图片|图像|照片|相片|插画|插图|海报|图|画)/;
const ZH_IMAGE_OBJECT = /(图片|图像|插画|插图|照片|相片|海报|头像|壁纸|漫画|卡通图|卡通画|卡通形象|贴纸|表情包|图标|logo|画作|画像|[张幅]图|[张幅]画)/i;
const ZH_ASK = /(生成|绘制|画|创作|制作|做|设计|创建|来|给我|帮我|要|想要|出)/;
/** 画一只河马, 给我画个猫. */
const ZH_DRAW_THING = /(画|绘制)我?[一两几三四五]?[只个张幅头条位匹朵座棵群对些]/;

function chineseClause(clause: string, hasAttachments: boolean): boolean {
  if (ZH_NOT_IMAGE.test(clause) || ZH_EXISTING.test(clause)) return false;
  if (ZH_DRAW_THING.test(clause)) return true;
  if (!ZH_IMAGE_OBJECT.test(clause)) return false;
  if (ZH_ASK.test(clause)) return true;
  // 河马图片: only a short noun phrase, and no files that it could be about.
  return !hasAttachments && clause.replace(/[^㐀-鿿A-Za-z]/g, "").length <= 8;
}

/** Whether a message asks for a picture to be created. Ambiguous messages do not. */
export function isImageGenerationRequest(content: string, options: { hasAttachments?: boolean } = {}): boolean {
  const text = content.trim().slice(0, 2000);
  if (!text) return false;
  const hasAttachments = Boolean(options.hasAttachments);
  const clauses = text.split(/[.!?;\n。！？；]+/).map((c) => c.trim()).filter(Boolean);
  return clauses.some((clause) => (/[㐀-鿿]/.test(clause)
    ? chineseClause(clause, hasAttachments)
    : englishClause(clause, hasAttachments)));
}
