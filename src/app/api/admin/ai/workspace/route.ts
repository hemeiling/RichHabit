import * as ai from "@/lib/aiWorkspace/queries";
import {
  MAX_ATTACHMENTS_PER_MESSAGE, MAX_INSTRUCTIONS, MAX_PROJECT_NAME, MAX_TITLE, MAX_USER_MESSAGE_CHARS,
} from "@/lib/aiWorkspace/validate";
import { workspaceJson } from "@/lib/aiWorkspaceRuntime/http";
import { workspaceProvider } from "@/lib/aiWorkspaceRuntime/provider";
import { aiWorkspace } from "@/lib/env";

/**
 * Everything the workspace needs to open: the upload notice state, storage,
 * projects, recent conversations and the limits the composer enforces. Admin
 * only; 404 for anyone else.
 */
export async function GET() {
  return workspaceJson(async (admin) => {
    const [settings, storage, projects, archivedProjects, conversations, archivedConversations, provider] =
      await Promise.all([
        ai.getWorkspaceSettings(admin.id),
        ai.storageUsage(admin.id),
        ai.listProjects(admin.id),
        ai.listProjects(admin.id, { archived: true }),
        ai.listConversations(admin.id, { limit: 100 }),
        ai.listConversations(admin.id, { archived: true, limit: 100 }),
        workspaceProvider(),
      ]);
    return {
      settings, storage, projects, archivedProjects, conversations, archivedConversations,
      available: provider !== null,
      limits: {
        maxAttachments: MAX_ATTACHMENTS_PER_MESSAGE,
        maxMessageChars: MAX_USER_MESSAGE_CHARS,
        maxInstructions: MAX_INSTRUCTIONS,
        maxProjectName: MAX_PROJECT_NAME,
        maxTitle: MAX_TITLE,
        maxPdfBytes: aiWorkspace.maxPdfBytes,
        maxImageBytes: aiWorkspace.maxImageBytes,
        maxTextBytes: aiWorkspace.maxTextBytes,
      },
    };
  });
}

export const dynamic = "force-dynamic";
