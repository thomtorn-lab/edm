// One-off, read-only Production audit for the event-status-system task —
// mirrors src/db/inspectSource.ts's withReadOnlyTx safety pattern exactly
// (BEGIN; SET LOCAL default_transaction_read_only = on; ...; ROLLBACK).
// Answers: which events currently have cancelled/soldOut/dateChanged/
// timeChanged set, and what event_change_log recorded when each changed.
// Deleted again once the audit is read — see the disposable workflow that
// runs this.
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set.");
}

const client = new Client({ connectionString });
await client.connect();

function log(title, rows) {
  console.log(`\n-- ${title} (${rows.length} rows) --`);
  console.log(JSON.stringify(rows, null, 2));
}

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL default_transaction_read_only = on");
  await client.query("SET LOCAL statement_timeout = '20s'");

  const flagged = await client.query(`
    SELECT e.id, e.slug, e.title, e.start_datetime, e.published, e.cancelled, e.sold_out,
           e.date_changed, e.time_changed, e.manual_override, e.overridden_fields,
           e.canonical_source_id, s.source_name, s.trust_level,
           e.created_at, e.updated_at, e.last_changed, e.last_source_check
    FROM events e
    LEFT JOIN sources s ON s.id = e.canonical_source_id
    WHERE e.cancelled = true OR e.sold_out = true OR e.date_changed = true OR e.time_changed = true
    ORDER BY e.updated_at DESC
  `);
  log("Flagged events (cancelled/soldOut/dateChanged/timeChanged)", flagged.rows);

  for (const row of flagged.rows) {
    const logRows = await client.query(
      `SELECT changed_by, change_type, fields_changed, note, created_at
       FROM event_change_log WHERE event_id = $1 ORDER BY created_at ASC`,
      [row.id],
    );
    console.log(`\n-- change log for ${row.id} (${row.slug}) --`);
    console.log(JSON.stringify(logRows.rows, null, 2));
  }

  const counts = await client.query(`
    SELECT
      count(*) FILTER (WHERE cancelled) AS cancelled_count,
      count(*) FILTER (WHERE sold_out) AS sold_out_count,
      count(*) FILTER (WHERE date_changed) AS date_changed_count,
      count(*) FILTER (WHERE time_changed) AS time_changed_count,
      count(*) AS total_events
    FROM events
  `);
  log("Global counts", counts.rows);

  const syncTouched = await client.query(`
    SELECT event_id, changed_by, change_type, fields_changed, note, created_at
    FROM event_change_log
    WHERE 'dateChanged' = ANY(fields_changed) OR 'timeChanged' = ANY(fields_changed)
       OR 'cancelled' = ANY(fields_changed) OR 'soldOut' = ANY(fields_changed)
    ORDER BY created_at DESC
  `);
  log("Change-log entries that ever touched these fields", syncTouched.rows);

  await client.query("ROLLBACK");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  throw err;
} finally {
  await client.end();
}
