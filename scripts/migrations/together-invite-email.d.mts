export const TOGETHER_INVITE_EMAIL_STATEMENTS: string[];
export function migrateTogetherInviteEmail(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
