export interface PasswordResetStep {
  table: string;
  statements: string[];
}
export const PASSWORD_RESET_STEPS: PasswordResetStep[];
export const PASSWORD_RESET_TABLES: string[];
export function migratePasswordResets(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
