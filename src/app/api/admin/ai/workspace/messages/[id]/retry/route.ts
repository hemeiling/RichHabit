import * as ai from "@/lib/aiWorkspace/queries";
import { readJson } from "@/lib/aiWorkspaceRuntime/http";
import { isImageModel, looksLikeImageModel, optionForReply } from "@/lib/aiWorkspaceRuntime/models";
import { replyResponse } from "@/lib/aiWorkspaceRuntime/reply";
import { routeRequest, type Route } from "@/lib/aiWorkspaceRuntime/routing";
import { aiWorkspace } from "@/lib/env";
import { ApiError } from "@/lib/http";

type Params = { params: { id: string } };

/**
 * Writes a new answer that replaces the visible one. Streams NDJSON.
 *
 * A picture is made again with the image model. Anything else is routed afresh:
 * with the model the admin has selected now (`modelId`), or the one that wrote
 * the reply.
 */
export async function POST(request: Request, { params }: Params) {
  return replyResponse(request, async (admin, tools) => {
    const b = await readJson(request).catch(() => ({} as Record<string, unknown>));
    const target = await ai.replyTarget(admin.id, params.id);
    if (!target) throw new ApiError("Message not found", 404);

    const previous = optionForReply(tools.catalogue, target.provider, target.model);
    const image = tools.catalogue.find(isImageModel);
    const wasImage = previous ? isImageModel(previous) : looksLikeImageModel(target.model);
    const route: Route | null = wasImage && image
      ? { capability: "image_generation", option: image }
      : routeRequest({
        content: target.userContent, attachmentKinds: target.attachmentKinds,
        selectedModelId: b.modelId ?? previous?.id, catalogue: tools.catalogue,
      });
    if (!route) throw new ApiError("Message not found", 404);
    await tools.use(route.option);

    const assistant = await ai.startRetry(admin.id, {
      messageId: params.id, provider: route.option.provider,
      model: route.option.model, maxOutputTokens: aiWorkspace.maxOutputTokens,
    });
    const conversation = await ai.getConversation(admin.id, assistant.conversationId);
    if (!conversation) throw new ApiError("Message not found", 404);
    return {
      conversation, userMessage: null, assistant,
      mode: { kind: "retry", targetMessageId: params.id.toLowerCase() }, option: route.option,
    };
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
