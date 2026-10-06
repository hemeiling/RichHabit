export const TOGETHER_RANK_STATEMENTS: string[];
export const TOGETHER_RANK_BACKFILL: string;
export function migrateTogetherTaskRank(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
