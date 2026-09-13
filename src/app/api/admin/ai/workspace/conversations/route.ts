import * as ai from "@/lib/aiWorkspace/queries";
import { readJson, workspaceJson } from "@/lib/aiWorkspaceRuntime/http";

export async function GET(request: Request) {
  return workspaceJson(async (admin) => {
    const q = new URL(request.url).searchParams;
    return {
      conversations: await ai.listConversations(admin.id, {
        projectId: q.get("projectId") ?? undefined,
        archived: q.get("archived") === "1",
        before: q.get("before"),
        limit: 100,
      }),
    };
  });
}

/** A standalone conversation, or one in a project when `projectId` is given. */
export async function POST(request: Request) {
  return workspaceJson(async (admin) => {
    const b = await readJson(request);
    return { conversation: await ai.createConversation(admin.id, { projectId: b.projectId ?? null }) };
  });
}

export const dynamic = "force-dynamic";
