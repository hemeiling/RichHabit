/** Types for intention-links.mjs, so the test suite can call the migration step directly. */
export declare const HABIT_IDS_COMMENT: string;
export declare const PRIORITY_IDS_COMMENT: string;
export declare const PRIORITY_ID_COMMENT: string;
export declare function migrateIntentionLinks(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> },
  log?: (line: string) => void,
): Promise<number>;
