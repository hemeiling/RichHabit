import { describe, it, expect } from 'vitest';

describe('inspect-prod-readonly', () => {
  it('requires RH_PROD_READONLY_URL and refuses to proceed without it', async () => {
    const { validateReadOnlyProductionConfig } = await import('../scripts/inspect-prod-readonly.mjs');
    expect(() => validateReadOnlyProductionConfig({})).toThrow(/RH_PROD_READONLY_URL is missing/i);
  });

  it('aborts when the connected role has write privileges', async () => {
    const { inspectProductionReadOnly } = await import('../scripts/inspect-prod-readonly.mjs');
    const fakeClient = {
      query: async (sql: string) => {
        if (sql.includes('has_schema_privilege')) {
          return { rows: [{ create: true, alter: true, drop: true }] };
        }
        if (sql.includes('has_table_privilege')) {
          return { rows: [{ insert: true, update: true, delete: true, truncate: true }] };
        }
        return { rows: [] };
      },
      end: async () => undefined,
    };

    await expect(
      inspectProductionReadOnly({
        env: { RH_PROD_READONLY_URL: 'postgresql://readonly:secret@prod.example.com/richhabits' },
        client: fakeClient as any,
      }),
    ).rejects.toThrow(/ABORTED: production inspection credential is not read-only/i);
  });

  it('returns a sanitized production inspection summary when the role is read-only', async () => {
    const fakeClient = {
      query: async (sql: string) => {
        if (sql.includes('current_user')) {
          return { rows: [{ current_user: 'rh_inspect_ro', database: 'richhabits' }] };
        }
        if (sql.includes('has_schema_privilege')) {
          return { rows: [{ create: false, alter: false, drop: false }] };
        }
        if (sql.includes('has_table_privilege')) {
          return { rows: [{ insert: false, update: false, delete: false, truncate: false, references: false, trigger: false }] };
        }
        if (sql.includes('to_regclass')) {
          return { rows: [{ table_name: 'public.priorities' }] };
        }
        if (sql.includes('information_schema.columns') && sql.includes('has_category')) {
          return { rows: [{ has_category: true }] };
        }
        if (sql.includes('information_schema.columns')) {
          return {
            rows: [
              { column_name: 'id' },
              { column_name: 'user_id' },
              { column_name: 'body' },
              { column_name: 'created_on' },
              { column_name: 'completed_on' },
              { column_name: 'sort_order' },
              { column_name: 'category' },
            ],
          };
        }
        if (sql.includes('COUNT(*)') && sql.includes('public.priorities')) {
          return { rows: [{ total: 42, unfinished: 11 }] };
        }
        if (sql.includes('SELECT\n          id') || sql.includes('SELECT\n          id,') || sql.includes('SELECT\n          id,\n          user_id')) {
          return {
            rows: [
              { id: '11111111-1111-1111-1111-111111111111', user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', body: 'masked body 1', created_on: '2024-01-01', completed_on: null, sort_order: 0 },
            ],
          };
        }
        return { rows: [] };
      },
      end: async () => undefined,
    };

    const { inspectProductionReadOnly } = await import('../scripts/inspect-prod-readonly.mjs');
    const result = await inspectProductionReadOnly({
      env: { RH_PROD_READONLY_URL: 'postgresql://readonly:secret@prod.example.com/richhabits' },
      client: fakeClient as any,
    });

    expect(result.TARGET).toBe('PRODUCTION');
    expect(result.MODE).toBe('READ_ONLY');
    expect(result.ROLE_READ_ONLY).toBe('confirmed');
    expect(result.TOTAL_PRIORITY_ROWS).toBe(42);
    expect(result.UNFINISHED_PRIORITY_ROWS).toBe(11);
    expect(result.HAS_CATEGORY_COLUMN).toBe('yes');
    expect(result.PRODUCTION_ACCOUNT_PRIORITY_ROWS).toBeGreaterThan(0);
  });
});
