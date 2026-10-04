export const TOGETHER_V1A_TABLES: string[];
export const TOGETHER_V1A_STATEMENTS: string[];
export const TOGETHER_V1A_TRIGGER: string;
export function migrateTogetherV1A(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
