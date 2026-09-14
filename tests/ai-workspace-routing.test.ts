import { describe, expect, it } from "vitest";
import {
  CHAT_CAPABILITIES, IMAGE_CAPABILITIES, looksLikeImageModel, modelLabel, optionForReply, type ModelOption,
} from "../src/lib/aiWorkspaceRuntime/models";
import { isImageGenerationRequest, routeRequest } from "../src/lib/aiWorkspaceRuntime/routing";

/**
 * Capability routing: a request for a picture goes to the image model when one
 * is configured, whichever conversational model is selected; everything else
 * goes to the selected conversational model. Deterministic, in English and
 * Chinese, and conservative: ambiguous messages stay with conversation.
 */

const CLAUDE: ModelOption = { id: "claude", provider: "anthropic", model: "claude-sonnet-5", label: "Claude Sonnet 5", capabilities: CHAT_CAPABILITIES };
const GEMINI: ModelOption = { id: "gemini", provider: "google", model: "gemini-3.8-flash", label: "Gemini 3.8 Flash", capabilities: CHAT_CAPABILITIES };
const IMAGE: ModelOption = { id: "image", provider: "google", model: "gemini-3.1-flash-image", label: "Nano Banana 2", capabilities: IMAGE_CAPABILITIES };
const ALL = [CLAUDE, GEMINI, IMAGE];

describe("recognising a request to create a picture", () => {
  it.each([
    // the screenshot and the natural ways people ask
    "Can you generate a cartoon image of a hippopotamus?",
    "generate an image of a hippo",
    "create a picture of a hippo",
    "draw me a hippo",
    "make me a cartoon hippo",
    "hippo picture please",
    "hippo picture",
    "can you make an image showing a hippo reading a book",
    "visualize this as an image",
    "create an illustration of a lighthouse at dawn",
    "make a poster showing our launch date",
    "Create a cartoon hippopotamus.",
    "Create a cute cartoon hippopotamus drinking coffee as an illustration",
    "Please draw a hippo drinking coffee",
    "draw me a cat wearing a hat",
    "Could you make me a picture of a sunset over the sea?",
    "Generate 3 images of a cozy reading nook",
    "I'd like an image of a lighthouse at night",
    "Give me a picture of a red panda",
    "Design a logo for a coffee shop called Bean There",
    "Paint a watercolor of Paris in spring",
    "Draw a hippo in a suit",
    "Sketch a cat on a skateboard",
    "Thanks! Now create another picture, this time at night.",
    "帮我生成一张可爱的河马卡通图片",
    "帮我生成一张河马图片",
    "给我画一只河马",
    "河马图片",
    "来一张可爱的河马卡通图",
    "做一张图片",
    "生成一个插画",
    "帮我做一张海报",
    "能帮我画一只河马吗",
    "画一只河马喝咖啡",
    "请帮我画一幅日落的海边风景画",
    "生成一个可爱的熊猫头像",
    "给我一张小猫的图片",
    "设计一张咖啡店的海报",
  ])("creates a picture for %j", (prompt) => {
    expect(isImageGenerationRequest(prompt)).toBe(true);
  });

  it.each([
    // describing, explaining or editing an existing image
    "describe this image",
    "explain this picture",
    "What is in this image?",
    "Describe this image in detail",
    "Is this a good picture for the homepage?",
    "nice picture",
    // prompts and wording
    "write an image-generation prompt",
    "help me improve this image prompt",
    "Write a prompt to generate an image of a hippo",
    "Generate an image description for accessibility",
    // questions
    "what would a cartoon hippo look like?",
    "How do I create an image in Photoshop?",
    "Explain how image generation models work",
    // code, diagrams and charts
    "make a flowchart",
    "create a Mermaid diagram",
    "write SVG code",
    "Create an SVG icon in code",
    "Create a React component that shows a picture gallery",
    "Make a flowchart of the signup process",
    "Draw a diagram of the architecture",
    "Draw a line on the chart at 50%",
    "Create a spreadsheet of hippo facts",
    // other senses and other tasks
    "Draw up a plan for the launch",
    "Draw a conclusion from these numbers",
    "Make sure the image upload works",
    "Generate a function that resizes an image",
    "Translate this paragraph into Chinese",
    "Explain Kubernetes.",
    "Hippos are fascinating animals",
    "",
    "给我写一个图片生成提示词",
    "描述这张图片",
    "帮我设计图片的文案",
    "这张图片里有什么？",
    "帮我总结这张图片的内容",
    "怎么用 Photoshop 生成一张图片？",
    "帮我写一个生成图片的提示词",
    "画一个用户注册的流程图",
    "做一个图片压缩的脚本",
    "解释一下图像生成模型的原理",
  ])("keeps %j with the conversational model", (prompt) => {
    expect(isImageGenerationRequest(prompt)).toBe(false);
  });

  it("does not read a bare caption as a request when files are attached, but honours an explicit one", () => {
    expect(isImageGenerationRequest("hippo picture", { hasAttachments: true })).toBe(false);
    expect(isImageGenerationRequest("河马图片", { hasAttachments: true })).toBe(false);
    expect(isImageGenerationRequest("generate an image of a hippo", { hasAttachments: true })).toBe(true);
    expect(isImageGenerationRequest("帮我生成一张河马图片", { hasAttachments: true })).toBe(true);
    expect(isImageGenerationRequest("make a cartoon of this photo", { hasAttachments: true })).toBe(false);
  });
});

describe("routing a message", () => {
  it("keeps the selected model for conversation and sends a picture to the image model, for either selection", () => {
    for (const selected of [GEMINI, CLAUDE]) {
      expect(routeRequest({ content: "Explain Kubernetes.", selectedModelId: selected.id, catalogue: ALL }))
        .toEqual({ capability: "text", option: selected });
      expect(routeRequest({ content: "Create a cartoon hippopotamus.", selectedModelId: selected.id, catalogue: ALL }))
        .toEqual({ capability: "image_generation", option: IMAGE });
    }
  });

  it("sends the screenshot's request to the image model when one is configured", () => {
    expect(routeRequest({ content: "Can you generate a cartoon image of a hippopotamus?", selectedModelId: "claude", catalogue: ALL }))
      .toEqual({ capability: "image_generation", option: IMAGE });
    expect(routeRequest({ content: "帮我生成一张可爱的河马卡通图片", catalogue: ALL })?.option).toBe(IMAGE);
  });

  it("answers a picture request with the selected model when no image model is configured", () => {
    expect(routeRequest({ content: "Can you generate a cartoon image of a hippopotamus?", catalogue: [CLAUDE] }))
      .toEqual({ capability: "text", option: CLAUDE });
  });

  it("uses the selected conversational model, and the default for anything unknown", () => {
    expect(routeRequest({ content: "Hello", selectedModelId: "gemini", catalogue: ALL })?.option).toBe(GEMINI);
    expect(routeRequest({ content: "Hello", selectedModelId: "claude", catalogue: ALL })?.option).toBe(CLAUDE);
    expect(routeRequest({ content: "Hello", selectedModelId: "image", catalogue: ALL })?.option).toBe(CLAUDE);
    expect(routeRequest({ content: "Hello", selectedModelId: "made-up", catalogue: ALL })?.option).toBe(CLAUDE);
    expect(routeRequest({ content: "Hello", selectedModelId: { id: "gemini" }, catalogue: ALL })?.option).toBe(CLAUDE);
  });

  it("marks a message with a document as document understanding, and a caption with files as conversation", () => {
    expect(routeRequest({ content: "Summarise this", attachmentKinds: ["pdf"], selectedModelId: "gemini", catalogue: ALL }))
      .toEqual({ capability: "documents", option: GEMINI });
    expect(routeRequest({ content: "What is this?", attachmentKinds: ["image"], catalogue: ALL })?.capability).toBe("text");
    expect(routeRequest({ content: "hippo picture", attachmentKinds: ["image"], catalogue: ALL })?.capability).toBe("text");
    expect(routeRequest({ content: "hippo picture", hasAttachments: true, catalogue: ALL })?.capability).toBe("text");
  });

  it("has nothing to route to when no conversational model is configured", () => {
    expect(routeRequest({ content: "Hello", catalogue: [] })).toBeNull();
    expect(routeRequest({ content: "Hello", catalogue: [IMAGE] })).toBeNull();
  });
});

describe("model names and stored replies", () => {
  it("names models for people", () => {
    expect(modelLabel("claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(modelLabel("gemini-3.8-flash")).toBe("Gemini 3.8 Flash");
    expect(modelLabel("gemini-3.1-flash-image")).toBe("Nano Banana 2");
    expect(modelLabel("gemini-3-pro-image")).toBe("Nano Banana Pro");
    expect(modelLabel("claude-sonnet-4-20250514")).toBe("Claude Sonnet 4");
  });

  it("finds the configured option a stored reply was written with", () => {
    expect(optionForReply(ALL, "google", "gemini-3.8-flash")).toBe(GEMINI);
    expect(optionForReply(ALL, "anthropic", "claude-older-model")).toBe(CLAUDE);
    expect(optionForReply(ALL, "google", "gemini-2.5-flash-image")).toBe(IMAGE);
    expect(optionForReply([CLAUDE], "google", "gemini-3.8-flash")).toBeNull();
    expect(optionForReply(ALL, null, null)).toBeNull();
    expect(looksLikeImageModel("gemini-3.1-flash-image")).toBe(true);
    expect(looksLikeImageModel("gemini-3.8-flash")).toBe(false);
  });
});
