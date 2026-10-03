export const WHATS_NEW_COLUMN: [string, string, string];
export function migrateWhatsNew(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
