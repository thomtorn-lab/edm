import fs from "node:fs";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";

/**
 * Production migrate-on-deploy (2026-10-06 /admin outage follow-up).
 *
 * Root cause of that outage: PR #105 shipped code selecting
 * discovery_queue.predicted_secondary_genre while migration 0021 had never
 * been applied to Production (migrations only ever ran via the manual
 * prepare-production-db.yml workflow). Every Drizzle `db.select().from(t)`
 * lists every schema column explicitly, so /admin and every sync (which all
 * run on Vercel via /api/sync/*) failed with "column does not exist".
 *
 * Fix: `npm run build` runs src/db/migrateOnDeploy.ts first; on a Vercel
 * Production build it applies pending migrations, and any failure fails the
 * build — so dependent code can never be promoted ahead of its schema.
 *
 * Why not just `drizzle-kit migrate`: drizzle-orm's pg migrator (which
 * drizzle-kit calls) reads the last-applied row BEFORE opening its
 * transaction and takes no lock, so two concurrent builds can both decide
 * the same migration is pending. This runner does the identical
 * bookkeeping (same drizzle.__drizzle_migrations table, same
 * readMigrationFiles hash/folderMillis, same "created_at < folderMillis"
 * rule — fully interchangeable with `npm run db:migrate` and the manual
 * workflow) but inside ONE transaction that first takes a transaction-scoped
 * advisory lock. pg_advisory_xact_lock is used (not the session-level
 * variant) because it stays correct behind Supabase's transaction-mode
 * pooler: the lock, the read and the writes all live in one transaction on
 * one backend.
 */

// Arbitrary constant, only needs to be unique among this app's advisory locks
// (src/db/sync.ts's per-source sync locks hash a source id — a different key space).
export const MIGRATION_LOCK_KEY = 727_011_021;
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

export type DeployEnv = Record<string, string | undefined>;

export type MigrationDecision =
  | { action: "migrate" }
  | { action: "skip"; reason: string }
  | { action: "fail"; reason: string };

/** Only a Vercel Production build ever touches the database. Fails closed when it can't tell. */
export function decideMigration(env: DeployEnv): MigrationDecision {
  if (!env.VERCEL) return { action: "skip", reason: "not a Vercel build (local/CI) — migrations not run" };
  if (!env.VERCEL_ENV) {
    return { action: "fail", reason: "VERCEL is set but VERCEL_ENV is not — refusing to guess whether this is Production" };
  }
  if (env.VERCEL_ENV !== "production") {
    return { action: "skip", reason: `VERCEL_ENV=${env.VERCEL_ENV} — only Production builds migrate` };
  }
  if (!env.DATABASE_URL) return { action: "fail", reason: "Production build without DATABASE_URL" };
  return { action: "migrate" };
}

/**
 * Allowlist of statement shapes that cannot break the code that is still
 * live while this build runs (the old deployment keeps serving until the
 * new one is promoted, and stays the rollback target afterwards). Every one
 * of the repo's first 22 migrations uses only the first three shapes.
 * Anything not matched — DROP, RENAME, type changes, SET NOT NULL, data
 * UPDATE/DELETE, or simply something unfamiliar — is rejected, never
 * guessed at. There is deliberately no in-file override: a rejected
 * migration must be applied with the manual "Prepare Production Database"
 * workflow once the live code no longer depends on what it removes, then
 * the deployment is redeployed (the migration is then no longer pending).
 */
const ALLOWED_STATEMENTS: { shape: string; pattern: RegExp; check?: (stmt: string) => string | null }[] = [
  { shape: "CREATE TABLE", pattern: /^CREATE TABLE (IF NOT EXISTS )?I\b/ },
  {
    shape: "ALTER TABLE … ADD COLUMN",
    pattern: /^ALTER TABLE (ONLY )?I ADD COLUMN (IF NOT EXISTS )?I\b/,
    // Live code doesn't know the column and won't write it: NOT NULL needs a DEFAULT or its inserts fail.
    check: (s) => (/\bNOT NULL\b/.test(s) && !/\bDEFAULT\b/.test(s) ? "NOT NULL column without a DEFAULT" : null),
  },
  { shape: "ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY", pattern: /^ALTER TABLE (ONLY )?I ADD CONSTRAINT I FOREIGN KEY\b/ },
  // Non-unique only: a new UNIQUE index can reject writes the live code still makes.
  { shape: "CREATE INDEX", pattern: /^CREATE INDEX (IF NOT EXISTS )?I ON\b/ },
];

/** Strip comments, quoted identifiers ("x" → I) and string literals ('x' → S); collapse whitespace; uppercase. */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "S")
    .replace(/"(?:[^"]|"")*"/g, "I")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function splitStatements(sql: string): string[] {
  return normalizeSql(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** null = allowed; otherwise the reason it is rejected. */
export function rejectReason(normalizedStatement: string): string | null {
  for (const { pattern, check } of ALLOWED_STATEMENTS) {
    if (pattern.test(normalizedStatement)) return check?.(normalizedStatement) ?? null;
  }
  return "not an allowlisted additive statement";
}

export type RejectedStatement = { migration: string; statement: string; reason: string };

export function findRejectedStatements(migrations: { tag: string; sql: string[] }[]): RejectedStatement[] {
  const rejected: RejectedStatement[] = [];
  for (const m of migrations) {
    for (const statement of splitStatements(m.sql.join(";"))) {
      const reason = rejectReason(statement);
      if (reason) rejected.push({ migration: m.tag, statement: statement.slice(0, 200), reason });
    }
  }
  return rejected;
}

export type TaggedMigration = MigrationMeta & { tag: string };

export function readTaggedMigrations(migrationsFolder: string): TaggedMigration[] {
  const metas = readMigrationFiles({ migrationsFolder });
  // readMigrationFiles drops the tag; recover it from the same journal (same order, one entry per file).
  const journal = JSON.parse(fs.readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8")) as {
    entries: { tag: string }[];
  };
  return metas.map((m, i) => ({ ...m, tag: journal.entries[i].tag }));
}

/** Minimal surface of pg.Client this runner needs (lets tests use a fake). */
export interface QueryClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export type MigrationResult = { applied: string[] };

export class UnsafeMigrationError extends Error {
  constructor(public readonly rejected: RejectedStatement[]) {
    super(
      "Pending migration(s) contain statements that could break the code still serving Production:\n" +
        rejected.map((r) => `  - ${r.migration}: ${r.reason}: ${r.statement}`).join("\n") +
        "\nApply them with the manual \"Prepare Production Database\" workflow (migrations_only) once the live code no " +
        "longer depends on what they change, then redeploy.",
    );
  }
}

/**
 * Applies every pending migration in one transaction, serialised by an
 * advisory lock. Any error (including an unsafe statement or a lock wait
 * longer than lockTimeout) rolls back everything and is rethrown.
 */
export async function applyPendingMigrations(
  client: QueryClient,
  migrations: TaggedMigration[],
  opts: { lockTimeout?: string; log?: (msg: string) => void } = {},
): Promise<MigrationResult> {
  const log = opts.log ?? (() => {});
  await client.query("BEGIN");
  try {
    // Concurrent Production builds queue here; the second then sees the first's rows and applies nothing.
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    // Set after taking our own lock: bounds how long DDL may queue behind live queries
    // (a waiting ALTER TABLE would otherwise block every later read of that table).
    await client.query(`SET LOCAL lock_timeout = '${opts.lockTimeout ?? "10s"}'`);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    );
    const { rows } = await client.query(
      `SELECT created_at FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`,
    );
    const last = rows[0] ? Number(rows[0].created_at) : null;
    const pending = migrations.filter((m) => last === null || last < m.folderMillis);

    const rejected = findRejectedStatements(pending);
    if (rejected.length > 0) throw new UnsafeMigrationError(rejected);

    for (const m of pending) {
      log(`applying ${m.tag}`);
      for (const stmt of m.sql) {
        if (stmt.trim()) await client.query(stmt);
      }
      await client.query(`INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES ($1, $2)`, [
        m.hash,
        m.folderMillis,
      ]);
    }
    await client.query("COMMIT");
    return { applied: pending.map((m) => m.tag) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}
