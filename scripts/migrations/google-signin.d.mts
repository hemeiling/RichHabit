export const GOOGLE_SIGNIN_STATEMENTS: string[];
export function migrateGoogleSignin(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
