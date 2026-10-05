export const TOGETHER_V1B_TABLES: string[];
export const TOGETHER_V1B_STATEMENTS: string[];
export function migrateTogetherV1B(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
