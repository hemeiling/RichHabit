import * as ai from "@/lib/aiWorkspace/queries";
import { readJson, workspaceJson } from "@/lib/aiWorkspaceRuntime/http";

export async function GET(request: Request) {
  return workspaceJson(async (admin) => {
    const archived = new URL(request.url).searchParams.get("archived") === "1";
    return { projects: await ai.listProjects(admin.id, { archived }) };
  });
}

export async function POST(request: Request) {
  return workspaceJson(async (admin) => {
    const b = await readJson(request);
    return { project: await ai.createProject(admin.id, { name: b.name, instructions: b.instructions }) };
  });
}

export const dynamic = "force-dynamic";
