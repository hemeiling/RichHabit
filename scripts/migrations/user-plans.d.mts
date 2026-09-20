export interface UserPlanStep {
  table: string;
  statements: string[];
}
export const USER_PLAN_STEPS: UserPlanStep[];
export const USER_PLAN_TABLES: string[];
export function migrateUserPlans(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
