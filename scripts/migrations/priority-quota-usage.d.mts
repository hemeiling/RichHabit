export interface PriorityQuotaStep {
  table: string;
  statements: string[];
}
export const PRIORITY_QUOTA_STEPS: PriorityQuotaStep[];
export const PRIORITY_QUOTA_TABLES: string[];
export function migratePriorityQuota(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
