export interface CoachRequestStep {
  table: string;
  statements: string[];
}
export const COACH_REQUEST_STEPS: CoachRequestStep[];
export const COACH_REQUEST_TABLES: string[];
export function migrateCoachRequests(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
