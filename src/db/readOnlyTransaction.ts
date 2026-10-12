/**
 * Genuinely read-only Postgres transactions for Production diagnostics.
 *
 * `BEGIN; SET LOCAL default_transaction_read_only = on` does NOT make the
 * current transaction read-only: `default_transaction_read_only` only sets
 * the default for transactions started AFTER it, so the open transaction's
 * own `transaction_read_only` stays "off" and INSERT/UPDATE/DELETE/DDL all
 * succeed (proven against a real database in readOnlyTransaction.test.ts).
 * `BEGIN READ ONLY` sets the open transaction's own mode, so Postgres itself
 * rejects every write with SQLSTATE 25006 (read_only_sql_transaction).
 *
 * beginReadOnlyTransaction also asserts the mode with `SHOW
 * transaction_read_only` and refuses to continue unless it is "on" — the
 * same belt-and-braces check src/db/auditEventsWindow.ts already uses.
 */

/** Minimal client shape (pg's Client/PoolClient both satisfy it). */
export type ReadOnlyQueryClient = {
  query(sql: string): Promise<{ rows: unknown[] }>;
};

export const READ_ONLY_BEGIN = "BEGIN READ ONLY";
export const READ_ONLY_CHECK = "SHOW transaction_read_only";

/** Throws unless the client's current transaction is read-only. */
export async function assertReadOnlyTransaction(client: ReadOnlyQueryClient): Promise<void> {
  const row = (await client.query(READ_ONLY_CHECK)).rows[0] as { transaction_read_only?: unknown } | undefined;
  const mode = row?.transaction_read_only;
  if (mode !== "on") {
    throw new Error(`Refusing to run: transaction_read_only is "${String(mode)}", expected "on".`);
  }
}

/**
 * Opens a read-only transaction and verifies it. The caller remains
 * responsible for ROLLBACK (nothing is ever committed from a read-only
 * transaction anyway).
 */
export async function beginReadOnlyTransaction(client: ReadOnlyQueryClient): Promise<void> {
  await client.query(READ_ONLY_BEGIN);
  await assertReadOnlyTransaction(client);
}
