import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  FIXTURE_DISCOVERY_IDS,
  FIXTURE_DISCOVERY_SIGNATURES,
  FIXTURE_EVENT_IDS,
  FIXTURE_EVENT_SIGNATURES,
  RECENCY_DAYS,
  RECENCY_DISPLAY_LIMIT,
  evaluateSnapshot,
  verdict,
  type Finding,
  type RecencyRow,
  type Snapshot,
} from "./verifyDbReadonly";

/**
 * Run by .github/workflows/verify-db-readonly.yml. Reads DATABASE_URL from
 * the environment and never prints it. One connection, one READ ONLY
 * transaction (verified via SHOW transaction_read_only before any query),
 * SELECT statements only, always ROLLBACK. Rules: src/db/verifyDbReadonly.ts.
 *
 * Exit code: 1 on confirmed contamination or a script error; 0 otherwise
 * (findings that need investigation are printed as warnings).
 */

type Client = Pick<pg.Client, "query">;

/** Fixed table/column pairs — never built from input. */
const RECENCY: { table: string; column: string }[] = [
  { table: "venues", column: "updated_at" },
  { table: "sources", column: "last_attempted_sync" },
  { table: "events", column: "updated_at" },
  { table: "discovery_queue", column: "created_at" },
];

export async function readSnapshot(client: Client): Promise<Snapshot> {
  const q = async <T>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];

  const fixtureIdEvents = await q<{ id: string; title: string }>(`SELECT id, title FROM events WHERE id = ANY($1::text[]) ORDER BY id`, [FIXTURE_EVENT_IDS]);
  const fixtureLookalikeEvents = await q<{ id: string; title: string }>(
    `SELECT e.id, e.title FROM events e
     JOIN unnest($1::text[], $2::timestamptz[], $3::text[]) AS f(title, start_datetime, venue_id)
       ON e.title = f.title AND e.start_datetime = f.start_datetime AND e.venue_id = f.venue_id
     ORDER BY e.id`,
    [FIXTURE_EVENT_SIGNATURES.map((f) => f.title), FIXTURE_EVENT_SIGNATURES.map((f) => f.start), FIXTURE_EVENT_SIGNATURES.map((f) => f.venueId)],
  );
  const fixtureIdDiscovery = await q<{ id: string; probable_title: string | null }>(
    `SELECT id, probable_title FROM discovery_queue WHERE id = ANY($1::text[]) ORDER BY id`,
    [FIXTURE_DISCOVERY_IDS],
  );
  const fixtureLookalikeDiscovery = await q<{ id: string; probable_title: string | null }>(
    `SELECT d.id, d.probable_title FROM discovery_queue d
     JOIN unnest($1::text[], $2::text[]) AS f(probable_title, source_name)
       ON d.probable_title = f.probable_title AND d.source_name = f.source_name
     ORDER BY d.id`,
    [FIXTURE_DISCOVERY_SIGNATURES.map((f) => f.title), FIXTURE_DISCOVERY_SIGNATURES.map((f) => f.sourceName)],
  );
  const sources = await q<Snapshot["sources"][number]>(
    `SELECT id, last_successful_sync, last_attempted_sync, last_error, events_found, events_updated FROM sources ORDER BY id`,
  );
  const venues = await q<Snapshot["venues"][number]>(
    `SELECT v.id, v.name, (SELECT count(*)::int FROM events e WHERE e.venue_id = v.id) AS event_count FROM venues v ORDER BY v.id`,
  );

  const recency: RecencyRow[] = [];
  for (const { table, column } of RECENCY) {
    const where = `${column} > now() - interval '${RECENCY_DAYS} days'`;
    const [{ total }] = await q<{ total: number }>(`SELECT count(*)::int AS total FROM ${table} WHERE ${where}`);
    const shown = await q<{ id: string; at: Date }>(`SELECT id, ${column} AS at FROM ${table} WHERE ${where} ORDER BY ${column} DESC LIMIT ${RECENCY_DISPLAY_LIMIT}`);
    recency.push({ table, column, total, shown });
  }

  const [totals] = await q<Snapshot["totals"]>(
    `SELECT (SELECT count(*)::int FROM events) AS events, (SELECT count(*)::int FROM discovery_queue) AS discovery_queue,
            (SELECT count(*)::int FROM venues) AS venues, (SELECT count(*)::int FROM sources) AS sources`,
  );
  return { fixtureIdEvents, fixtureLookalikeEvents, fixtureIdDiscovery, fixtureLookalikeDiscovery, sources, venues, recency, totals };
}

const HEADINGS: Record<Finding["class"], string> = {
  confirmed: "CONFIRMED CONTAMINATION (fails the run)",
  investigate: "NEEDS INVESTIGATION (warning — not contamination by itself)",
  info: "NORMAL ACTIVITY (information only)",
};

export function formatReport(snapshot: Snapshot, findings: Finding[]): string[] {
  const lines: string[] = [];
  const t = snapshot.totals;
  lines.push(`Totals: events ${t.events}, discovery_queue ${t.discovery_queue}, venues ${t.venues}, sources ${t.sources}.`);
  lines.push(
    `Checked: ${FIXTURE_EVENT_IDS.length} fixture event ids + signatures, ${FIXTURE_DISCOVERY_IDS.length} fixture discovery ids + signatures, staged source health, sources and venues against src/lib/data.`,
  );
  for (const cls of ["confirmed", "investigate", "info"] as const) {
    const items = findings.filter((f) => f.class === cls);
    lines.push("", `=== ${HEADINGS[cls]}: ${items.length} ===`);
    for (const f of items) lines.push(`  [${f.check}] ${f.detail}`);
  }
  lines.push("", `=== Recent rows (newest first, at most ${RECENCY_DISPLAY_LIMIT} per table — a display limit, not the total) ===`);
  for (const r of snapshot.recency) {
    lines.push(`${r.table}.${r.column}: ${r.total} row(s) in the last ${RECENCY_DAYS} days, ${r.shown.length} shown`);
    for (const row of r.shown) lines.push(`  ${row.id}  ${row.at instanceof Date ? row.at.toISOString() : String(row.at)}`);
  }
  return lines;
}

async function main(): Promise<number> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("::error::DATABASE_URL is not set.");
    return 1;
  }
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '20s'");
    const ro = await client.query("SHOW transaction_read_only");
    if (ro.rows[0]?.transaction_read_only !== "on") throw new Error(`transaction_read_only is "${ro.rows[0]?.transaction_read_only}", expected "on".`);
    const snapshot = await readSnapshot(client);
    await client.query("ROLLBACK");
    console.log("Transaction rolled back (read-only).");

    const findings = evaluateSnapshot(snapshot);
    for (const line of formatReport(snapshot, findings)) console.log(line);
    for (const f of findings.filter((x) => x.class === "investigate")) console.log(`::warning::${f.check}: ${f.detail}`);
    const v = verdict(findings);
    console.log("");
    console.log(v.failed ? `::error::${v.line}` : v.line);
    return v.failed ? 1 : 0;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error(`::error::VERIFICATION ERROR (not a contamination verdict): ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await client.end().catch(() => {});
    console.log("Connection closed.");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code));
}
