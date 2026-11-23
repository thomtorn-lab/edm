/**
 * Read-only QA export for the owner's separate, external QA (2026-11-20).
 *
 * Exports every published event that is not yet over, by the same definition
 * the site's public event lists use (upcoming and in progress): the SQL
 * pre-filter from upcomingCandidateCondition in src/lib/queries.ts, then
 * isPastEvent from src/lib/datetime.ts. For each event it includes the
 * stable database id, date/time, venue, lineup, genres, links, source links,
 * the change log, and a content fingerprint, so the external QA can tell
 * which events are new or changed since it last checked them.
 *
 * Run only by .github/workflows/qa-export-readonly.yml (manual start):
 *
 *   node --import tsx src/db/exportQaSnapshot.ts --out=qa-snapshot.json
 *
 * Safety: it logs in only as the shared read-only report role
 * (DATABASE_URL_REPORT_RO, never DATABASE_URL), proves that role cannot
 * write (reportReadOnlyGuard) before reading any data, and reads inside a
 * READ ONLY, REPEATABLE READ transaction with a short statement timeout that
 * is always rolled back. It contains SELECT statements only. It refuses to
 * write the file unless every validation check passes. It prints only counts
 * and check results, never event data or the connection string.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { isPastEvent } from "@/lib/datetime";
import { SITE_URL } from "@/lib/siteUrl";
import { assertReadOnlyTransaction } from "./readOnlyTransaction";
import { assertReadOnlyRole, readReportConnectionString, type QueryClient, type ReportTable } from "./reportReadOnlyGuard";

export const QA_SNAPSHOT_SCHEMA_VERSION = 2;

/** Must equal UPCOMING_PREFILTER_LOOKBACK_MS in src/lib/queries.ts (asserted by the test). */
export const QA_PREFILTER_LOOKBACK_MS = 3 * 24 * 3_600_000;

/** The tables this export reads. All are in SHARED_REPORT_RO_TABLES (asserted by the test). */
export const QA_EXPORT_TABLES: ReportTable[] = [
  { schema: "public", name: "events", optional: false },
  { schema: "public", name: "venues", optional: false },
  { schema: "public", name: "sources", optional: false },
  { schema: "public", name: "source_event_links", optional: false },
  { schema: "public", name: "event_change_log", optional: false },
];

export const BEGIN_SQL = "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY";
export const TIMEOUT_SQL = "SET LOCAL statement_timeout = '20s'";

/** Published events the site's SQL pre-filter keeps; isPastEvent is applied afterwards. LEFT JOIN so a missing venue is caught by validation, not silently dropped. */
export const EVENTS_SQL = `SELECT e.id, e.slug, e.title, e.description, e.artists, e.start_datetime, e.end_datetime, e.timezone,
  e.venue_id, v.name AS venue_name, v.slug AS venue_slug, e.sub_venue,
  e.primary_genre, e.subgenres, e.genre_confidence,
  e.official_event_url, e.ticket_url, e.facebook_url, e.resident_advisor_url, e.other_source_urls,
  e.sold_out, e.cancelled, e.postponed, e.date_changed, e.time_changed,
  e.canonical_source_id, e.manual_override, e.overridden_fields,
  e.created_at, e.updated_at, e.last_source_check, e.last_changed
FROM events e LEFT JOIN venues v ON v.id = e.venue_id
WHERE e.published = true AND (e.start_datetime >= $1::timestamptz OR e.end_datetime > $2::timestamptz)
ORDER BY e.start_datetime, e.id`;

/** Independent count of the same pre-filter, to prove no row was lost between query and file. */
export const EVENTS_COUNT_SQL = `SELECT count(*)::int AS n FROM events e
WHERE e.published = true AND (e.start_datetime >= $1::timestamptz OR e.end_datetime > $2::timestamptz)`;

export const LINKS_SQL = `SELECT event_id, source_id, source_url, role, first_seen_at
FROM source_event_links WHERE event_id = ANY($1::text[])
ORDER BY event_id, source_id, role`;

export const CHANGES_SQL = `SELECT id, event_id, changed_by, change_type, fields_changed, created_at
FROM event_change_log WHERE event_id = ANY($1::text[])
ORDER BY event_id, created_at, id`;

export const SOURCES_SQL = `SELECT id, source_name, source_type, active FROM sources ORDER BY id`;

type Row = Record<string, unknown>;

const iso = (x: unknown): string | null => (x == null ? null : x instanceof Date ? x.toISOString() : new Date(String(x)).toISOString());
const text = (x: unknown): string | null => (x == null || x === "" ? null : String(x));
const list = (x: unknown): string[] => (Array.isArray(x) ? x.map(String) : []);

export interface QaSourceLink {
  source_id: string;
  source_url: string;
  role: string;
  first_seen_at: string | null;
}

export interface QaChange {
  id: string;
  changed_by: string;
  change_type: string;
  fields_changed: string[];
  created_at: string | null;
}

export interface QaEvent {
  id: string;
  slug: string;
  page_url: string;
  title: string;
  description: string | null;
  artists: string[];
  start_datetime: string;
  end_datetime: string | null;
  timezone: string;
  in_progress: boolean;
  venue: { id: string; name: string | null; slug: string | null };
  sub_venue: string | null;
  primary_genre: string;
  subgenres: string[];
  genre_confidence: string;
  links: {
    official_event_url: string | null;
    ticket_url: string | null;
    facebook_url: string | null;
    resident_advisor_url: string | null;
    other_source_urls: string[];
  };
  status: { sold_out: boolean; cancelled: boolean; postponed: boolean; date_changed: boolean; time_changed: boolean };
  canonical_source_id: string | null;
  manual_override: boolean;
  overridden_fields: string[];
  source_links: QaSourceLink[];
  change_log: QaChange[];
  created_at: string | null;
  updated_at: string | null;
  last_source_check: string | null;
  last_changed: string | null;
  /** sha256 of the event's QA-relevant content (everything above except timestamps, in_progress and change_log). Changes exactly when something the QA checks changed. */
  content_fingerprint: string;
}

export interface QaSnapshot {
  schema_version: number;
  scope: "published_current_events";
  definition: string;
  generated_at: string;
  counts: { events: number; in_progress: number; source_links: number; change_log: number; sources: number };
  validation: { passed: boolean; checks: { name: string; ok: boolean; detail: string }[] };
  events: QaEvent[];
  sources: { id: string; source_name: string; source_type: string; active: boolean }[];
  coverage_notice: string;
}

export interface QaRawData {
  events: Row[];
  prefilterCount: number;
  links: Row[];
  changes: Row[];
  sources: Row[];
}

/** Stable JSON (sorted keys) so the fingerprint never depends on key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Row).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Row)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function contentFingerprint(e: Omit<QaEvent, "content_fingerprint">): string {
  const content = {
    id: e.id, slug: e.slug, title: e.title, description: e.description, artists: e.artists,
    start_datetime: e.start_datetime, end_datetime: e.end_datetime, timezone: e.timezone,
    venue: e.venue, sub_venue: e.sub_venue, primary_genre: e.primary_genre, subgenres: e.subgenres, genre_confidence: e.genre_confidence,
    links: e.links, status: e.status, canonical_source_id: e.canonical_source_id,
    manual_override: e.manual_override, overridden_fields: e.overridden_fields,
    source_links: e.source_links.map((l) => ({ source_id: l.source_id, source_url: l.source_url, role: l.role })),
  };
  return createHash("sha256").update(canonical(content)).digest("hex");
}

/** Pure: turns the query rows into the snapshot, applies the site's isPastEvent, and validates. */
export function buildQaSnapshot(raw: QaRawData, now: Date): QaSnapshot {
  const linksByEvent = new Map<string, QaSourceLink[]>();
  for (const l of raw.links) {
    const id = String(l.event_id);
    linksByEvent.set(id, [...(linksByEvent.get(id) ?? []), { source_id: String(l.source_id), source_url: String(l.source_url), role: String(l.role), first_seen_at: iso(l.first_seen_at) }]);
  }
  const changesByEvent = new Map<string, QaChange[]>();
  for (const c of raw.changes) {
    const id = String(c.event_id);
    changesByEvent.set(id, [
      ...(changesByEvent.get(id) ?? []),
      { id: String(c.id), changed_by: String(c.changed_by), change_type: String(c.change_type), fields_changed: list(c.fields_changed), created_at: iso(c.created_at) },
    ]);
  }

  const current = raw.events.filter((r) => !isPastEvent({ startDatetime: iso(r.start_datetime)!, endDatetime: iso(r.end_datetime) }, now));
  const events: QaEvent[] = current.map((r) => {
    const id = String(r.id);
    const start = iso(r.start_datetime)!;
    const end = iso(r.end_datetime);
    const base: Omit<QaEvent, "content_fingerprint"> = {
      id,
      slug: String(r.slug),
      page_url: `${SITE_URL}/events/${String(r.slug)}`,
      title: String(r.title),
      description: text(r.description),
      artists: list(r.artists),
      start_datetime: start,
      end_datetime: end,
      timezone: String(r.timezone),
      in_progress: new Date(start).getTime() <= now.getTime(),
      venue: { id: String(r.venue_id), name: text(r.venue_name), slug: text(r.venue_slug) },
      sub_venue: text(r.sub_venue),
      primary_genre: String(r.primary_genre),
      subgenres: list(r.subgenres),
      genre_confidence: String(r.genre_confidence),
      links: {
        official_event_url: text(r.official_event_url),
        ticket_url: text(r.ticket_url),
        facebook_url: text(r.facebook_url),
        resident_advisor_url: text(r.resident_advisor_url),
        other_source_urls: list(r.other_source_urls),
      },
      status: {
        sold_out: r.sold_out === true,
        cancelled: r.cancelled === true,
        postponed: r.postponed === true,
        date_changed: r.date_changed === true,
        time_changed: r.time_changed === true,
      },
      canonical_source_id: text(r.canonical_source_id),
      manual_override: r.manual_override === true,
      overridden_fields: list(r.overridden_fields),
      source_links: linksByEvent.get(id) ?? [],
      change_log: changesByEvent.get(id) ?? [],
      created_at: iso(r.created_at),
      updated_at: iso(r.updated_at),
      last_source_check: iso(r.last_source_check),
      last_changed: iso(r.last_changed),
    };
    return { ...base, content_fingerprint: contentFingerprint(base) };
  });

  const sources = raw.sources.map((s) => ({ id: String(s.id), source_name: String(s.source_name), source_type: String(s.source_type), active: s.active === true }));
  const checks = validateQaSnapshot(raw, events, sources);
  const sourceLinks = events.reduce((n, e) => n + e.source_links.length, 0);
  const changeLog = events.reduce((n, e) => n + e.change_log.length, 0);

  return {
    schema_version: QA_SNAPSHOT_SCHEMA_VERSION,
    scope: "published_current_events",
    definition:
      "Every event with published = true that is not over at generated_at (upcoming or in progress), by the site's own list definition: end_datetime when it is after start_datetime, otherwise 06:00 Copenhagen time after the event's nightlife day.",
    generated_at: now.toISOString(),
    counts: { events: events.length, in_progress: events.filter((e) => e.in_progress).length, source_links: sourceLinks, change_log: changeLog, sources: sources.length },
    validation: { passed: checks.every((c) => c.ok), checks },
    events,
    sources,
    coverage_notice: "Database snapshot only. It does not certify that source facts, genres, links or lineups are correct, or that every real event is listed.",
  };
}

function preview(items: string[]): string {
  return items.length > 10 ? `${items.slice(0, 10).join(", ")}, … (+${items.length - 10})` : items.join(", ");
}

export function validateQaSnapshot(raw: QaRawData, events: QaEvent[], sources: QaSnapshot["sources"]): QaSnapshot["validation"]["checks"] {
  const checks: QaSnapshot["validation"]["checks"] = [];
  const add = (name: string, bad: string[], okDetail: string) => checks.push({ name, ok: bad.length === 0, detail: bad.length === 0 ? okDetail : preview(bad) });

  checks.push({
    name: "row_count_matches_independent_count",
    ok: raw.events.length === raw.prefilterCount,
    detail: `${raw.events.length} rows read, ${raw.prefilterCount} counted`,
  });
  checks.push({ name: "at_least_one_event", ok: events.length > 0, detail: `${events.length} current published events` });

  const seen = new Set<string>();
  const dupIds = events.map((e) => e.id).filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  add("event_ids_unique", dupIds, `${seen.size} unique ids`);
  const seenSlugs = new Set<string>();
  const dupSlugs = events.map((e) => e.slug).filter((s) => (seenSlugs.has(s) ? true : (seenSlugs.add(s), false)));
  add("event_slugs_unique", dupSlugs, `${seenSlugs.size} unique slugs`);
  add("events_have_id_slug_title_start", events.filter((e) => !e.id || !e.slug || !e.title || !e.start_datetime).map((e) => e.id), "all present");
  add("events_have_existing_venue", events.filter((e) => !e.venue.name).map((e) => `${e.id} (venue ${e.venue.id})`), "all venues found");

  const rawIds = new Set(raw.events.map((r) => String(r.id)));
  add("source_links_belong_to_read_events", raw.links.map((l) => String(l.event_id)).filter((id) => !rawIds.has(id)), "all linked");
  add("change_log_belongs_to_read_events", raw.changes.map((c) => String(c.event_id)).filter((id) => !rawIds.has(id)), "all linked");

  const sourceIds = new Set(sources.map((s) => s.id));
  add(
    "source_links_reference_known_sources",
    events.flatMap((e) => e.source_links.filter((l) => !sourceIds.has(l.source_id)).map((l) => `${e.id} → ${l.source_id}`)),
    "all sources known",
  );
  add(
    "canonical_source_ids_known",
    events.filter((e) => e.canonical_source_id !== null && !sourceIds.has(e.canonical_source_id)).map((e) => `${e.id} → ${e.canonical_source_id}`),
    "all known (or none: admin-entered)",
  );
  return checks;
}

/** Reads everything inside the caller's verified read-only transaction. Sequential queries on one connection, one snapshot. */
export async function readQaRawData(client: QueryClient, now: Date): Promise<QaRawData> {
  const params = [new Date(now.getTime() - QA_PREFILTER_LOOKBACK_MS).toISOString(), now.toISOString()];
  const events = (await client.query(EVENTS_SQL, params)).rows as Row[];
  const prefilterCount = Number(((await client.query(EVENTS_COUNT_SQL, params)).rows[0] as { n: number }).n);
  const ids = events.map((e) => String(e.id));
  const links = (await client.query(LINKS_SQL, [ids])).rows as Row[];
  const changes = (await client.query(CHANGES_SQL, [ids])).rows as Row[];
  const sources = (await client.query(SOURCES_SQL)).rows as Row[];
  return { events, prefilterCount, links, changes, sources };
}

export async function runQaExport(client: QueryClient, now: Date): Promise<{ snapshot: QaSnapshot; role: string | null; warnings: string[] }> {
  await client.query(BEGIN_SQL);
  try {
    await assertReadOnlyTransaction(client);
    await client.query(TIMEOUT_SQL);
    const guard = await assertReadOnlyRole(client, QA_EXPORT_TABLES);
    const raw = await readQaRawData(client, now);
    return { snapshot: buildQaSnapshot(raw, now), role: guard.role, warnings: guard.warnings };
  } finally {
    await client.query("ROLLBACK");
  }
}

function readOut(): string {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--out="));
  if (!arg) throw new Error("Missing required --out=<file> argument.");
  return arg.slice("--out=".length);
}

async function main() {
  const out = readOut();
  const client = new Client({ connectionString: readReportConnectionString(process.env), connectionTimeoutMillis: 20_000 });
  await client.connect();
  try {
    const { snapshot, role, warnings } = await runQaExport(client, new Date());
    console.log(`Database role ${role} proven read-only; transaction rolled back.`);
    for (const w of warnings) console.log(`::warning::${w}`);
    console.log(`Counts: ${JSON.stringify(snapshot.counts)}`);
    for (const c of snapshot.validation.checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
    if (!snapshot.validation.passed) throw new Error("Validation failed; no snapshot file was written.");
    writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
    console.log(`Snapshot written to ${out}.`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && /exportQaSnapshot\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error("::error::exportQaSnapshot.ts FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
