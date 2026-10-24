/**
 * VENDORED from #141 (claude/brave-dijkstra-jnn932 @ 11f1abb) for the Artist
 * Alerts identity audit, with ONE change: the table list is a parameter
 * (defaulting to #141's REPORT_TABLES), exactly as proposed for a shared
 * standalone PR. Replace this copy with that shared module once it lands;
 * do not edit the rules here.
 *
 * Fail-closed proof that the report's database login cannot write
 * (owner requirement 2026-10-24). `transaction_read_only = on` alone is not
 * enough — any role, including one that can write, can open a READ ONLY
 * transaction — so before reading a single data row the report checks the
 * login role itself, from the catalogs:
 *
 *   - role attributes: no SUPERUSER, CREATEROLE, CREATEDB, REPLICATION, BYPASSRLS;
 *   - no membership in any other role (whose rights it could inherit or SET ROLE to);
 *   - database: no CREATE, not its owner (TEMPORARY — session-local scratch
 *     tables, granted to PUBLIC by default — is reported as a warning);
 *   - every table, view, materialized view, foreign table and sequence in every
 *     non-system schema: no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
 *     (table- or column-level), no sequence USAGE/UPDATE, and not owned;
 *   - every schema: no CREATE, not owned;
 *   - functions: none it can execute that run as their owner (SECURITY
 *     DEFINER) or that it owns, in a schema it can use;
 *   - the tables the report reads: SELECT granted, and row-level security
 *     cannot hide rows (no RLS, or one permissive `USING (true)` SELECT policy
 *     for this role and no restrictive policy).
 *
 * Every check is a catalog SELECT, run inside the report's verified READ ONLY
 * transaction (kept as a second layer). Any violation — or any check that
 * cannot be evaluated — stops the report before its first data query.
 */

export type QueryClient = {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
};

/** The secret the report workflow passes — and the only variable the CLI reads. */
export const REPORT_DATABASE_ENV = "DATABASE_URL_REPORT_RO";

const SYSTEM_SCHEMA_FILTER = `n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp\\_%'`;

export const ROLE_SQL = `SELECT r.rolname::text AS rolname, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls,
  COALESCE((SELECT array_agg(b.rolname::text ORDER BY b.rolname) FROM pg_auth_members m JOIN pg_roles b ON b.oid = m.roleid WHERE m.member = r.oid), '{}') AS member_of,
  has_database_privilege(current_database(), 'CREATE') AS db_create,
  has_database_privilege(current_database(), 'TEMPORARY') AS db_temp,
  (SELECT pg_has_role(d.datdba, 'USAGE') FROM pg_database d WHERE d.datname = current_database()) AS db_owner,
  current_setting('default_transaction_read_only') AS default_read_only
FROM pg_roles r WHERE r.rolname = current_user`;

export const WRITABLE_RELATIONS_SQL = `SELECT n.nspname::text AS schema, c.relname::text AS name, c.relkind::text AS kind
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE ${SYSTEM_SCHEMA_FILTER}
  AND (
    (c.relkind IN ('r', 'p', 'v', 'm', 'f') AND (
      has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
      OR has_any_column_privilege(c.oid, 'INSERT, UPDATE, REFERENCES')))
    OR (c.relkind = 'S' AND has_sequence_privilege(c.oid, 'USAGE, UPDATE'))
    OR pg_has_role(c.relowner, 'USAGE')
  )
ORDER BY 1, 2
LIMIT 50`;

export const WRITABLE_SCHEMAS_SQL = `SELECT n.nspname::text AS schema
FROM pg_namespace n
WHERE n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp\\_%'
  AND (has_schema_privilege(n.oid, 'CREATE') OR pg_has_role(n.nspowner, 'USAGE'))
ORDER BY 1`;

export const DEFINER_FUNCTIONS_SQL = `SELECT n.nspname::text AS schema, p.proname::text AS name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE ${SYSTEM_SCHEMA_FILTER}
  AND (p.prosecdef OR pg_has_role(p.proowner, 'USAGE'))
  AND has_schema_privilege(n.oid, 'USAGE')
  AND has_function_privilege(p.oid, 'EXECUTE')
ORDER BY 1, 2
LIMIT 50`;

/** The tables the report reads. The override table is optional: before migration 0023 it does not exist. */
export const REPORT_TABLES: ReportTable[] = [
  { schema: "public", name: "artist_youtube_preview_cache", optional: false },
  { schema: "public", name: "events", optional: false },
  { schema: "public", name: "discovery_queue", optional: false },
  { schema: "public", name: "source_event_links", optional: false },
  { schema: "public", name: "event_youtube_preview_overrides", optional: true },
  { schema: "drizzle", name: "__drizzle_migrations", optional: false },
];

export type ReportTable = { schema: string; name: string; optional: boolean };

export function readAccessSql(tables: readonly ReportTable[]): string {
  for (const t of tables) {
    if (!/^[a-z_][a-z0-9_]*$/.test(t.schema) || !/^[a-z_][a-z0-9_]*$/.test(t.name)) throw new Error(`Invalid report table name: ${t.schema}.${t.name}`);
  }
  return `SELECT n.nspname::text AS schema, c.relname::text AS name,
  has_schema_privilege(n.oid, 'USAGE') AND has_table_privilege(c.oid, 'SELECT') AS can_select,
  c.relrowsecurity AS rls,
  EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname
    AND p.permissive = 'PERMISSIVE' AND p.cmd IN ('SELECT', 'ALL') AND p.qual = 'true'
    AND (p.roles @> ARRAY[current_user]::name[] OR p.roles @> ARRAY['public']::name[])) AS open_policy,
  EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname AND p.permissive = 'RESTRICTIVE') AS restrictive_policy
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (n.nspname, c.relname) IN (${tables.map((t) => `('${t.schema}', '${t.name}')`).join(", ")})
ORDER BY 1, 2`;
}

export const READ_ACCESS_SQL = readAccessSql(REPORT_TABLES);

export const GUARD_STATEMENTS = [ROLE_SQL, WRITABLE_RELATIONS_SQL, WRITABLE_SCHEMAS_SQL, DEFINER_FUNCTIONS_SQL, READ_ACCESS_SQL] as const;

export interface RoleFacts {
  rolname: string;
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  member_of: string[];
  db_create: boolean;
  db_temp?: boolean;
  db_owner: boolean | null;
  default_read_only: string;
}

export interface GuardFacts {
  role: RoleFacts | undefined;
  writableRelations: { schema: string; name: string; kind: string }[];
  writableSchemas: { schema: string }[];
  definerFunctions: { schema: string; name: string }[];
  readAccess: { schema: string; name: string; can_select: boolean; rls: boolean; open_policy: boolean; restrictive_policy: boolean }[];
}

export interface GuardResult {
  ok: boolean;
  role: string | null;
  violations: string[];
  warnings: string[];
}

const list = (items: string[]) => (items.length > 10 ? `${items.slice(0, 10).join(", ")}, … (+${items.length - 10})` : items.join(", "));

/** Pure: anything not positively proven harmless is a violation. */
export function evaluateGuard(f: GuardFacts, tables: readonly ReportTable[] = REPORT_TABLES): GuardResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const r = f.role;
  if (!r) {
    return { ok: false, role: null, violations: ["the login role could not be found in pg_roles"], warnings };
  }
  for (const [attr, on] of [
    ["SUPERUSER", r.rolsuper],
    ["CREATEROLE", r.rolcreaterole],
    ["CREATEDB", r.rolcreatedb],
    ["REPLICATION", r.rolreplication],
    ["BYPASSRLS", r.rolbypassrls],
  ] as const) {
    if (on !== false) violations.push(`role has ${attr}`);
  }
  if (!Array.isArray(r.member_of) || r.member_of.length > 0) violations.push(`role is a member of other roles: ${list(r.member_of ?? ["?"])}`);
  if (r.db_create !== false) violations.push("role has CREATE on the database");
  if (r.db_owner !== false) violations.push("role owns the database");
  if (f.writableRelations.length > 0) violations.push(`role can write to or owns: ${list(f.writableRelations.map((x) => `${x.schema}.${x.name}`))}`);
  if (f.writableSchemas.length > 0) violations.push(`role has CREATE on or owns schema: ${list(f.writableSchemas.map((x) => x.schema))}`);
  if (f.definerFunctions.length > 0) {
    violations.push(`role can execute functions that run with their owner's rights (or owns them): ${list(f.definerFunctions.map((x) => `${x.schema}.${x.name}`))}`);
  }
  for (const t of tables) {
    const a = f.readAccess.find((x) => x.schema === t.schema && x.name === t.name);
    const label = `${t.schema}.${t.name}`;
    if (!a) {
      if (!t.optional) violations.push(`${label} does not exist or is not visible`);
      continue;
    }
    if (a.can_select !== true) violations.push(`no SELECT on ${label}`);
    if (a.rls !== false && (a.open_policy !== true || a.restrictive_policy !== false)) {
      violations.push(`row-level security on ${label} could hide rows from this role (needs one permissive USING (true) SELECT policy for it, and no restrictive policy)`);
    }
  }
  // Postgres grants TEMPORARY to PUBLIC by default: session-local scratch
  // tables that vanish at disconnect and never touch stored data.
  if (r.db_temp !== false) warnings.push("role can create session-local temporary tables (PostgreSQL's default for PUBLIC; they never touch stored data)");
  if (r.default_read_only !== "on") warnings.push("default_transaction_read_only is not on for this role (the report's own READ ONLY transaction still applies)");
  return { ok: violations.length === 0, role: r.rolname, violations, warnings };
}

/** Runs the catalog checks (inside the caller's READ ONLY transaction) and throws unless the role is proven read-only. */
export async function assertReadOnlyRole(client: QueryClient, tables: readonly ReportTable[] = REPORT_TABLES): Promise<GuardResult> {
  const facts: GuardFacts = {
    role: (await client.query(ROLE_SQL)).rows[0] as RoleFacts | undefined,
    writableRelations: (await client.query(WRITABLE_RELATIONS_SQL)).rows as GuardFacts["writableRelations"],
    writableSchemas: (await client.query(WRITABLE_SCHEMAS_SQL)).rows as GuardFacts["writableSchemas"],
    definerFunctions: (await client.query(DEFINER_FUNCTIONS_SQL)).rows as GuardFacts["definerFunctions"],
    readAccess: (await client.query(readAccessSql(tables))).rows as GuardFacts["readAccess"],
  };
  const result = evaluateGuard(facts, tables);
  if (!result.ok) {
    throw new Error(`Refusing to run: database role ${result.role ?? "(unknown)"} is not proven read-only:\n  - ${result.violations.join("\n  - ")}`);
  }
  return result;
}

/**
 * Reads the report's connection string from DATABASE_URL_REPORT_RO only —
 * never DATABASE_URL — and rejects an obviously wrong one before connecting.
 * Error messages never contain the value.
 */
export function readReportConnectionString(env: Record<string, string | undefined>): string {
  const raw = env[REPORT_DATABASE_ENV]?.trim();
  if (!raw) throw new Error(`${REPORT_DATABASE_ENV} is not set.`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${REPORT_DATABASE_ENV} is not a valid URL.`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error(`${REPORT_DATABASE_ENV} must be a postgres:// or postgresql:// URL.`);
  const user = decodeURIComponent(url.username);
  if (!user) throw new Error(`${REPORT_DATABASE_ENV} has no user name.`);
  // Supabase's admin login is "postgres" (direct) or "postgres.<project-ref>" (pooler).
  if (/^(postgres|supabase_admin|service_role|authenticator)(\.|$)/i.test(user)) {
    throw new Error(`${REPORT_DATABASE_ENV} uses an admin/built-in role; it must be the dedicated read-only report role.`);
  }
  if (env.DATABASE_URL && env.DATABASE_URL.trim() === raw) throw new Error(`${REPORT_DATABASE_ENV} is identical to DATABASE_URL; it must be the dedicated read-only report role.`);
  return raw;
}
