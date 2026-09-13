export interface AiWorkspaceStep {
  table: string;
  statements: string[];
}
export const AI_WORKSPACE_STEPS: AiWorkspaceStep[];
export const AI_WORKSPACE_TABLES: string[];
export function migrateAiWorkspace(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
