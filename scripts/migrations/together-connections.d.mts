export const TOGETHER_CONNECTIONS_TABLES: string[];
export const TOGETHER_CONNECTIONS_STATEMENTS: string[];
export function migrateTogetherConnections(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
