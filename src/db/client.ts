import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and point it at a Postgres " +
      "instance (a local Postgres for development, or a hosted Postgres/Supabase connection " +
      "string in production).",
  );
}

// A single pooled connection reused across requests/route handlers — the
// standard pattern for Postgres from a Node server (Next.js route handlers
// and RSC both run long-lived, so we don't need a per-request client like
// serverless/edge deployments would).
const globalForDb = globalThis as unknown as { pgPool?: Pool };

const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgPool = pool;
}

export const db = drizzle(pool, { schema });

/**
 * The raw pg Pool, exported for src/db/sync.ts's advisory lock: Postgres
 * advisory locks are session-scoped, so acquiring/releasing one must
 * happen on a single dedicated connection checked out from this pool —
 * going through `db`'s query methods would let the pool hand different
 * queries to different connections, making the "lock" a no-op.
 */
export { pool };
