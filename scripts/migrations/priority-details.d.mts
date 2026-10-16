export const PRIORITY_DETAILS_STATEMENTS: string[];
export function migratePriorityDetails(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
  log?: (line: string) => void,
): Promise<number>;
