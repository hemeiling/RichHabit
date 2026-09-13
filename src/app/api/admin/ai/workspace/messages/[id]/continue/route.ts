import * as ai from "@/lib/aiWorkspace/queries";
import { isChatModel, isImageModel, looksLikeImageModel, optionForReply } from "@/lib/aiWorkspaceRuntime/models";
import { replyResponse } from "@/lib/aiWorkspaceRuntime/reply";
import { aiWorkspace } from "@/lib/env";
import { ApiError } from "@/lib/http";

type Params = { params: { id: string } };

/**
 * Continues a stopped reply, or one that reached the length limit, with the
 * model that wrote it while that model is configured. Streams NDJSON. A
 * generated picture cannot be continued; Retry makes a new one.
 */
export async function POST(request: Request, { params }: Params) {
  return replyResponse(request, async (admin, tools) => {
    const target = await ai.replyTarget(admin.id, params.id);
    if (!target) throw new ApiError("Message not found", 404);
    const previous = optionForReply(tools.catalogue, target.provider, target.model);
    if (previous ? isImageModel(previous) : looksLikeImageModel(target.model)) {
      throw new ApiError("This reply can't be continued", 409);
    }
    const option = previous ?? tools.catalogue.find(isChatModel);
    if (!option) throw new ApiError("Message not found", 404);
    await tools.use(option);

    const assistant = await ai.startContinuation(admin.id, {
      messageId: params.id, provider: option.provider,
      model: option.model, maxOutputTokens: aiWorkspace.maxOutputTokens,
    });
    const conversation = await ai.getConversation(admin.id, assistant.conversationId);
    if (!conversation) throw new ApiError("Message not found", 404);
    return {
      conversation, userMessage: null, assistant,
      mode: { kind: "continue", targetMessageId: params.id.toLowerCase() }, option,
    };
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
