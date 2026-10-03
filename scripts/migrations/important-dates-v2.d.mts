export const IMPORTANT_DATES_V2_COLUMNS: [string, string][];
export const IMPORTANT_DATES_V2_CONSTRAINTS: [string, string][];
export function migrateImportantDatesV2(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
