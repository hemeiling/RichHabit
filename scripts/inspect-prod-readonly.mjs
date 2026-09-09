import pg from 'pg';

const VALID_TABLE_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const VALID_SCHEMA_PRIVS = ['USAGE', 'CREATE'];
const VALID_DATABASE_PRIVS = ['CONNECT', 'CREATE', 'TEMPORARY'];

function redactUrl(raw) {
  if (!raw) return '<missing>';
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.hostname}${u.pathname || ''}`;
  } catch {
    return '<invalid-url>';
  }
}

export function validateReadOnlyProductionConfig(env = process.env) {
  const raw = env.RH_PROD_READONLY_URL;
  if (!raw || !String(raw).trim()) {
    throw new Error('RH_PROD_READONLY_URL is missing. Refusing to inspect production without a dedicated read-only credential.');
  }

  try {
    const u = new URL(raw);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1') {
      throw new Error('RH_PROD_READONLY_URL points to a local database, not production.');
    }
  } catch (err) {
    if (err instanceof Error && /local database|RH_PROD_READONLY_URL/.test(err.message)) throw err;
    throw new Error('RH_PROD_READONLY_URL is not a valid URL.');
  }

  return raw;
}

async function getPrivilegeRows(client) {
  const databaseSql = `
    SELECT
      has_database_privilege(current_user, current_database(), 'CONNECT') AS connect,
      has_database_privilege(current_user, current_database(), 'CREATE') AS create_db,
      has_database_privilege(current_user, current_database(), 'TEMPORARY') AS temporary
  `;
  const schemaSql = `
    SELECT
      has_schema_privilege(current_user, 'public', 'USAGE') AS usage,
      has_schema_privilege(current_user, 'public', 'CREATE') AS create_schema
  `;
  const tableSql = `
    SELECT
      has_table_privilege(current_user, 'public.priorities', 'SELECT') AS select_priv,
      has_table_privilege(current_user, 'public.priorities', 'INSERT') AS insert,
      has_table_privilege(current_user, 'public.priorities', 'UPDATE') AS update,
      has_table_privilege(current_user, 'public.priorities', 'DELETE') AS delete,
      has_table_privilege(current_user, 'public.priorities', 'TRUNCATE') AS truncate,
      has_table_privilege(current_user, 'public.priorities', 'REFERENCES') AS references,
      has_table_privilege(current_user, 'public.priorities', 'TRIGGER') AS trigger
  `;
  const roleSql = `
    SELECT
      rolsuper,
      rolcreaterole,
      rolcreatedb,
      rolinherit
    FROM pg_roles
    WHERE rolname = current_user;
  `;
  const membershipSql = `
    SELECT EXISTS (
      SELECT 1
      FROM pg_auth_members am
      JOIN pg_roles member ON member.oid = am.member
      JOIN pg_roles role ON role.oid = am.roleid
      WHERE member.rolname = current_user
        AND (role.rolsuper OR role.rolcreaterole OR role.rolcreatedb OR role.rolinherit)
    ) AS inherited_privileged_membership;
  `;

  const [databaseRes, schemaRes, tableRes, roleRes, membershipRes] = await Promise.all([
    client.query(databaseSql),
    client.query(schemaSql),
    client.query(tableSql),
    client.query(roleSql),
    client.query(membershipSql),
  ]);

  return {
    database: databaseRes.rows[0] ?? {},
    schema: schemaRes.rows[0] ?? {},
    table: tableRes.rows[0] ?? {},
    role: roleRes.rows[0] ?? {},
    membership: membershipRes.rows[0] ?? {},
  };
}

export async function inspectProductionReadOnly({ env = process.env, client } = {}) {
  const url = validateReadOnlyProductionConfig(env);
  const dbClient = client ?? new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  try {
    if (!client) await dbClient.connect();

    const currentUserQuery = `SELECT current_user AS current_user, current_database() AS database;`;
    const currentUser = await dbClient.query(currentUserQuery);
    const currentUserName = currentUser.rows[0]?.current_user || 'unknown';

    const privileges = await getPrivilegeRows(dbClient);
    const schemaFlags = privileges.schema;
    const tableFlags = privileges.table;
    const databaseFlags = privileges.database;
    const roleFlags = privileges.role;
    const membershipFlags = privileges.membership;

    const hasWriteCapability = [
      databaseFlags.connect,
      databaseFlags.create_db,
      databaseFlags.temporary,
      schemaFlags.usage,
      schemaFlags.create_schema,
      tableFlags.insert,
      tableFlags.update,
      tableFlags.delete,
      tableFlags.truncate,
      tableFlags.references,
      tableFlags.trigger,
      roleFlags.rolsuper,
      roleFlags.rolcreaterole,
      roleFlags.rolcreatedb,
      roleFlags.rolinherit,
      membershipFlags.inherited_privileged_membership,
    ].some(Boolean);

    if (hasWriteCapability) {
      const message = 'ABORTED: production inspection credential is not read-only';
      console.error(message);
      console.error(`ROLE=${currentUserName}`);
      console.error(`TARGET=PRODUCTION`);
      console.error(`MODE=READ_ONLY`);
      throw new Error(message);
    }

    const inspection = {
      TARGET: 'PRODUCTION',
      MODE: 'READ_ONLY',
      HOST: redactUrl(url).replace(/^.*\/\//, '').split('/')[0],
      ROLE: currentUserName,
      ROLE_READ_ONLY: 'confirmed',
      SCHEMA_CHECK: 'passed',
      PRIORITY_TABLE_EXISTS: 'unknown',
      TOTAL_PRIORITY_ROWS: null,
      UNFINISHED_PRIORITY_ROWS: null,
      HAS_CATEGORY_COLUMN: 'unknown',
      BODY_PRESENT: 'unknown',
      PRODUCTION_ACCOUNT_PRIORITY_ROWS: null,
      SAMPLE_IDS: [],
      SCHEMA_VERSION: 'unknown',
    };

    const priorityTableCheck = await dbClient.query(`
      SELECT to_regclass('public.priorities') AS table_name;
    `);
    const tableName = priorityTableCheck.rows[0]?.table_name;
    if (tableName) {
      inspection.PRIORITY_TABLE_EXISTS = 'yes';

      const totals = await dbClient.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE completed_on IS NULL)::int AS unfinished
        FROM public.priorities;
      `);
      const counts = totals.rows[0] || {};
      inspection.TOTAL_PRIORITY_ROWS = Number(counts.total ?? 0);
      inspection.UNFINISHED_PRIORITY_ROWS = Number(counts.unfinished ?? 0);
      inspection.PRODUCTION_ACCOUNT_PRIORITY_ROWS = inspection.TOTAL_PRIORITY_ROWS;

      const categoryColumn = await dbClient.query(`
        SELECT coalesce(
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'priorities'
              AND column_name = 'category'
          ), false
        ) AS has_category;
      `);
      inspection.HAS_CATEGORY_COLUMN = categoryColumn.rows[0]?.has_category === true ? 'yes' : 'no';

      const sampleRows = await dbClient.query(`
        SELECT
          id,
          user_id,
          body,
          created_on,
          completed_on,
          sort_order
        FROM public.priorities
        ORDER BY created_on ASC, sort_order ASC
        LIMIT 5;
      `);

      inspection.SAMPLE_IDS = sampleRows.rows.map((row) => row.id);
      inspection.PRODUCTION_ACCOUNT_PRIORITY_ROWS = sampleRows.rows.length;

      for (const row of sampleRows.rows) {
        if (row.body && row.body.length > 0) {
          inspection.BODY_PRESENT = 'yes';
          break;
        }
      }
    } else {
      inspection.PRIORITY_TABLE_EXISTS = 'no';
    }

    const versionCheck = await dbClient.query(`
      SELECT version() AS version;
    `);
    inspection.SCHEMA_VERSION = versionCheck.rows[0]?.version ? 'postgres-version-present' : 'unknown';

    return inspection;
  } finally {
    if (!client) await dbClient.end();
  }
}

if (process.argv[1] && process.argv[1].includes('inspect-prod-readonly.mjs')) {
  try {
    const result = await inspectProductionReadOnly();
    console.log(`TARGET=${result.TARGET}`);
    console.log(`MODE=${result.MODE}`);
    console.log(`HOST=${result.HOST}`);
    console.log(`ROLE=${result.ROLE}`);
    console.log(`ROLE_READ_ONLY=${result.ROLE_READ_ONLY}`);
    console.log(`SCHEMA_CHECK=${result.SCHEMA_CHECK}`);
    console.log(`PRIORITY_TABLE_EXISTS=${result.PRIORITY_TABLE_EXISTS}`);
    console.log(`TOTAL_PRIORITY_ROWS=${result.TOTAL_PRIORITY_ROWS ?? 'unknown'}`);
    console.log(`UNFINISHED_PRIORITY_ROWS=${result.UNFINISHED_PRIORITY_ROWS ?? 'unknown'}`);
    console.log(`HAS_CATEGORY_COLUMN=${result.HAS_CATEGORY_COLUMN}`);
    console.log(`BODY_PRESENT=${result.BODY_PRESENT ?? 'unknown'}`);
    console.log(`PRODUCTION_ACCOUNT_PRIORITY_ROWS=${result.PRODUCTION_ACCOUNT_PRIORITY_ROWS ?? 'unknown'}`);
    console.log(`SAMPLE_IDS=${(result.SAMPLE_IDS || []).join(',') || 'none'}`);
    console.log(`SCHEMA_VERSION=${result.SCHEMA_VERSION}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
