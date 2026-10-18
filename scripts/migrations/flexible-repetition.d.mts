export const FREQ_MODES_ADDED: string[];
export const FLEXIBLE_REPETITION_STATEMENTS: string[];
export const FLEXIBLE_REPETITION_CHECKS: [string, string, string][];
export function checkStatement(check: [string, string, string]): string;
export function migrateFlexibleRepetition(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
