export const NOTIFICATION_TABLES: string[];
export const NOTIFICATION_INDEXES: string[];
export const NOTIFICATIONS_STATEMENTS: string[];
export function migrateNotifications(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
