/**
 * ElectronicCPH QA snapshot. SELECT-only; no migrations, sync or publishing.
 * GitHub Actions uploads the JSON artifact. Never print DB credentials.
 */
import { Client } from "pg";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { beginReadOnlyTransaction } from "./readOnlyTransaction";
import { technicalFindings, buildQaInputs } from "@/lib/qaSnapshotEnrichment";

export async function exportQaSnapshot(client: Client, generatedAt: string) {
  const events = await client.query(`
    SELECT e.id, e.title, e.slug, e.description, e.artists, e.start_datetime,
      e.end_datetime, e.timezone, e.venue_id, v.name AS venue_name, e.sub_venue,
      e.primary_genre, e.subgenres, e.genre_confidence, e.official_event_url,
      e.ticket_url, e.facebook_url, e.resident_advisor_url, e.sold_out,
      e.cancelled, e.postponed, e.date_changed, e.time_changed,
      e.last_source_check, e.last_changed, e.updated_at,
      e.canonical_source_id, e.manual_override, e.overridden_fields
    FROM events e JOIN venues v ON v.id = e.venue_id
    WHERE e.published = true AND e.start_datetime >= $1::timestamptz
    ORDER BY e.start_datetime, e.id
  `, [generatedAt]);
  const ids = events.rows.map((e: {id: string}) => e.id);
  const [links, changes, sources, discovery] = await Promise.all([
    client.query(`SELECT event_id, source_id, source_url, role, first_seen_at
      FROM source_event_links WHERE event_id = ANY($1::text[])
      ORDER BY event_id, source_id, role`, [ids]),
    client.query(`SELECT id, event_id, changed_by, change_type, fields_changed, created_at
      FROM event_change_log WHERE event_id = ANY($1::text[])
      ORDER BY created_at, id`, [ids]),
    client.query(`SELECT id, source_name, source_type, trust_level, active,
      last_successful_sync, last_attempted_sync, last_complete_sync_at,
      last_error, events_found, events_updated, adapter, sync_frequency
      FROM sources ORDER BY id`),
    client.query(`SELECT id, source_id, probable_title, probable_start, probable_venue_name,
      source_url, status, predicted_genre, detected_lineup, created_at, last_seen_at
      FROM discovery_queue
      WHERE status = 'pending' AND (probable_start IS NULL OR probable_start >= $1::timestamptz)
      ORDER BY probable_start NULLS LAST, id`, [generatedAt]),
  ]);
  const data = { generated_at: generatedAt, events: events.rows, source_event_links: links.rows,
    event_change_log: changes.rows, sources: sources.rows, discovery_queue: discovery.rows };
  return {
    schema_version: 1,
    technical_findings: technicalFindings(data),
    qa_inputs: buildQaInputs(data),
    generated_at: generatedAt,
    scope: "published_upcoming_events",
    counts: { events: events.rows.length, source_links: links.rows.length,
      change_log: changes.rows.length, sources: sources.rows.length,
      discovery_candidates: discovery.rows.length },
    events: events.rows,
    source_event_links: links.rows,
    event_change_log: changes.rows,
    sources: sources.rows,
    discovery_queue: discovery.rows,
    coverage_notice: "Database snapshot only. Does not certify source facts, genres, links, duplicates, discovery completeness, ABOUT or UI.",
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const output = process.argv[2] || "qa-output/qa-snapshot.json";
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await beginReadOnlyTransaction(client);
    await client.query("SET LOCAL statement_timeout = '30s'");
    const snapshot = await exportQaSnapshot(client, new Date().toISOString());
    await client.query("ROLLBACK");
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
    console.log("QA snapshot generated:", JSON.stringify(snapshot.counts));
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* connection may have failed */ }
    throw error;
  } finally {
    await client.end();
  }
}
if (process.argv[1]?.endsWith("exportQaSnapshot.ts")) {
  main().catch(e => { console.error("QA snapshot failed:", e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
}
