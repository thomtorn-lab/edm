import { Client } from "pg";
import { getSourceHealth, describeSourceHealth } from "@/lib/sourceHealth";
import { resolveVenue } from "@/lib/normalize";
import { findBestDuplicateMatch, decideDuplicateAction, type DuplicateCandidate } from "@/lib/dedup";
import { buildApiKeypairHeader } from "@/lib/adapters/billettoAdapter";
import type { Source, Venue } from "@/lib/types";

/**
 * Permanent, parameterized, READ-ONLY source diagnostic tool (source
 * onboarding factory, Phase 2.1). Replaces the old pattern of hand-writing
 * a fresh one-off GitHub Actions workflow (verify-db-readonly.yml,
 * verify-discogs-reachability.yml, monitor-source-health.yml's bespoke
 * script) every time someone needed to look at a source's state. Every mode
 * here is invoked the same way, scoped to one source id, and never mutates
 * anything.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/inspectSource.ts \
 *     --mode=<inventory|discovery-queue|source-links|health|lock-status|dedup-simulate|reachability|snapshot> \
 *     [--source=<sourceId>] [--limit=20] [--endpoint=<url>] [--with-credentials]
 *     [--title=... --artists="A, B" --venue=... --start=<ISO> --url=<officialEventUrl>]  (dedup-simulate only)
 *
 * Also runnable via: npm run db:inspect-source -- --mode=... [...]
 *
 * Safety, matching the existing verify-db-readonly.yml / snapshot.cjs
 * convention used by this repo's preview-verification workflows:
 *   - Every DB-touching mode opens exactly ONE dedicated pg connection,
 *     BEGINs an explicit transaction, sets default_transaction_read_only via
 *     SET LOCAL (transaction-scoped, never session/role/database-scoped),
 *     issues only SELECT statements, always ROLLBACKs, then closes the
 *     connection. No migration, seed, sync, or write path is ever reached
 *     from this file.
 *   - DATABASE_URL is read only from the environment — never echoed,
 *     logged, or written to a file by this script.
 *   - "reachability" mode never prints a credential value, only whether one
 *     was configured and the HTTP status a request using it returned.
 *   - Every mode is scoped to a single source id where meaningful ("all
 *     sources" is only ever a deliberate, explicit choice for `inventory`
 *     and `lock-status` with no --source given).
 */

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const body = raw.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) out[body] = true;
    else out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return out;
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function withReadOnlyTx<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local, or set the DATABASE_URL repository secret for the inspect-source.yml workflow.",
    );
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL default_transaction_read_only = on");
    await client.query("SET LOCAL statement_timeout = '20s'");
    const result = await fn(client);
    await client.query("ROLLBACK");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection may already be broken — nothing more to do */
    }
    throw err;
  } finally {
    await client.end();
  }
}

// ---- row -> app-shape mapping (mirrors src/db/mappers.ts field names, no DB import needed) ----

function rowToSource(r: Record<string, unknown>): Source {
  return {
    id: r.id as string,
    sourceName: r.source_name as string,
    sourceType: r.source_type as Source["sourceType"],
    baseUrl: r.base_url as string,
    roles: r.roles as Source["roles"],
    adapter: r.adapter as string | null,
    trustLevel: r.trust_level as Source["trustLevel"],
    autoPublish: r.auto_publish as boolean,
    syncFrequency: r.sync_frequency as string,
    active: r.active as boolean,
    lastSuccessfulSync: r.last_successful_sync ? new Date(r.last_successful_sync as string).toISOString() : null,
    lastAttemptedSync: r.last_attempted_sync ? new Date(r.last_attempted_sync as string).toISOString() : null,
    lastError: r.last_error as string | null,
    eventsFound: r.events_found as number,
    eventsUpdated: r.events_updated as number,
    integrationNote: r.integration_note as string,
  };
}

function rowToVenue(r: Record<string, unknown>): Venue {
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    aliases: r.aliases as string[],
    address: r.address as string,
    city: r.city as Venue["city"],
    postalCode: r.postal_code as string,
    websiteUrl: r.website_url as string | null,
    description: r.description as string,
  };
}

function requireSource(args: Record<string, string | boolean>): string {
  const source = args.source;
  if (typeof source !== "string" || !/^src-[a-z0-9-]+$/.test(source)) {
    throw new Error("--source=<sourceId> is required for this mode and must match src-[a-z0-9-]+ (e.g. src-hangaren).");
  }
  return source;
}

// ---- modes ----

async function modeInventory(client: Client, args: Record<string, string | boolean>) {
  const source = typeof args.source === "string" ? args.source : null;
  section(source ? `Source inventory: ${source}` : "Source inventory: all sources");
  const rows = source
    ? (await client.query("SELECT * FROM sources WHERE id = $1", [source])).rows
    : (await client.query("SELECT * FROM sources ORDER BY source_name")).rows;
  if (rows.length === 0) {
    console.log(source ? `No source row found for "${source}".` : "No sources found.");
    return;
  }
  const now = new Date();
  for (const row of rows) {
    const src = rowToSource(row);
    const health = getSourceHealth(src, now);
    const reason = describeSourceHealth(src, now);
    const eventCount = await client.query("SELECT count(*)::int AS n FROM events WHERE canonical_source_id = $1", [src.id]);
    console.log(
      JSON.stringify(
        {
          id: src.id,
          sourceName: src.sourceName,
          adapter: src.adapter,
          active: src.active,
          autoPublish: src.autoPublish,
          syncFrequency: src.syncFrequency,
          health,
          reason,
          lastSuccessfulSync: src.lastSuccessfulSync,
          lastAttemptedSync: src.lastAttemptedSync,
          lastError: src.lastError,
          eventsFound: src.eventsFound,
          eventsUpdated: src.eventsUpdated,
          canonicalEventsInProduction: eventCount.rows[0].n,
        },
        null,
        2,
      ),
    );
  }
}

async function modeHealth(client: Client, args: Record<string, string | boolean>) {
  const sourceId = requireSource(args);
  const res = await client.query("SELECT * FROM sources WHERE id = $1", [sourceId]);
  if (res.rows.length === 0) {
    console.log(`::error::No source row found for "${sourceId}" — it may not be registered yet (see src/lib/data/sources.ts and npm run db:seed:production).`);
    process.exitCode = 1;
    return;
  }
  const src = rowToSource(res.rows[0]);
  const now = new Date();
  const health = getSourceHealth(src, now);
  const reason = describeSourceHealth(src, now);
  section(`Source health: ${sourceId}`);
  console.log(JSON.stringify({ id: src.id, sourceName: src.sourceName, health, reason }, null, 2));
  if (health === "degraded" || health === "stale") {
    console.log(`::error::${src.sourceName} (${src.id}) is ${health}: ${reason}`);
    process.exitCode = 1;
  }
}

async function modeDiscoveryQueue(client: Client, args: Record<string, string | boolean>) {
  const sourceId = requireSource(args);
  const limit = typeof args.limit === "string" ? Number(args.limit) : 20;
  section(`discovery_queue for ${sourceId}: grouped by status + confidence`);
  const grouped = await client.query(
    `SELECT status, overall_confidence, count(*)::int AS n FROM discovery_queue WHERE source_id = $1 GROUP BY status, overall_confidence ORDER BY status, overall_confidence`,
    [sourceId],
  );
  console.log(JSON.stringify(grouped.rows, null, 2));

  section(`discovery_queue for ${sourceId}: most recent ${limit} rows`);
  const rows = await client.query(
    `SELECT id, probable_title, status, predicted_genre, genre_confidence, overall_confidence,
            suspected_duplicate_of_event_id, missing_fields, source_url, created_at
     FROM discovery_queue WHERE source_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [sourceId, limit],
  );
  console.log(JSON.stringify(rows.rows, null, 2));
}

async function modeSourceLinks(client: Client, args: Record<string, string | boolean>) {
  const sourceId = requireSource(args);
  const limit = typeof args.limit === "string" ? Number(args.limit) : 20;
  section(`source_event_links for ${sourceId}`);
  const count = await client.query("SELECT count(*)::int AS n FROM source_event_links WHERE source_id = $1", [sourceId]);
  console.log(`Total links: ${count.rows[0].n}`);
  const rows = await client.query(
    `SELECT event_id, source_id, source_url, role, first_seen_at
     FROM source_event_links WHERE source_id = $1 ORDER BY first_seen_at DESC LIMIT $2`,
    [sourceId, limit],
  );
  console.log(JSON.stringify(rows.rows, null, 2));
}

async function modeLockStatus(client: Client, args: Record<string, string | boolean>) {
  const sourceId = typeof args.source === "string" ? args.source : null;
  section(sourceId ? `sync_locks: ${sourceId}` : "sync_locks: all sources");
  const rows = sourceId
    ? (await client.query("SELECT * FROM sync_locks WHERE source_id = $1", [sourceId])).rows
    : (await client.query("SELECT * FROM sync_locks ORDER BY source_id")).rows;
  if (rows.length === 0) {
    console.log("No lock rows found (no sync currently in flight, or none ever taken for this source).");
    return;
  }
  const now = Date.now();
  for (const row of rows) {
    const expiresAt = new Date(row.expires_at as string);
    console.log(
      JSON.stringify(
        {
          sourceId: row.source_id,
          lockedAt: row.locked_at,
          expiresAt: row.expires_at,
          expired: expiresAt.getTime() <= now,
          note: expiresAt.getTime() <= now
            ? "Lease has expired — the next sync attempt will acquire it normally, no manual cleanup needed."
            : "Lease still active — a sync for this source is currently believed to be in flight (or a crashed run hasn't hit its 5-minute TTL yet).",
        },
        null,
        2,
      ),
    );
  }
}

async function modeDedupSimulate(client: Client, args: Record<string, string | boolean>) {
  const sourceId = requireSource(args);
  const title = typeof args.title === "string" ? args.title : "";
  if (!title) throw new Error("dedup-simulate requires --title=<candidate title>");
  const artists = typeof args.artists === "string" ? args.artists.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const venueName = typeof args.venue === "string" ? args.venue : null;
  const startDatetime = typeof args.start === "string" ? args.start : null;
  if (!startDatetime) throw new Error("dedup-simulate requires --start=<ISO datetime>");
  const officialEventUrl = typeof args.url === "string" ? args.url : null;

  const venueRows = await client.query("SELECT * FROM venues");
  const venues = venueRows.rows.map(rowToVenue);
  const resolvedVenue = venueName ? resolveVenue(venueName, venues) : undefined;

  const eventRows = await client.query(
    `SELECT id, title, artists, venue_id, start_datetime, canonical_source_id, official_event_url, ticket_url, resident_advisor_url
     FROM events`,
  );
  const existing = eventRows.rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    artists: r.artists as string[],
    venueId: r.venue_id as string | null,
    startDatetime: new Date(r.start_datetime as string).toISOString(),
    sourceId: r.canonical_source_id as string | null,
    officialEventUrl: r.official_event_url as string | null,
    ticketUrl: r.ticket_url as string | null,
    residentAdvisorUrl: r.resident_advisor_url as string | null,
  }));

  const candidate: DuplicateCandidate = {
    title,
    artists,
    venueId: resolvedVenue?.id ?? null,
    startDatetime: new Date(startDatetime).toISOString(),
    sourceId,
    officialEventUrl,
    ticketUrl: null,
    residentAdvisorUrl: null,
  };

  section(`Dedup simulation for candidate "${title}" (${sourceId})`);
  console.log(`Resolved venue: ${resolvedVenue ? `${resolvedVenue.name} (${resolvedVenue.id})` : venueName ? `UNRESOLVED ("${venueName}" not in venues registry)` : "(none given)"}`);
  console.log(`Existing events checked: ${existing.length}`);

  const best = findBestDuplicateMatch(candidate, existing);
  if (!best) {
    console.log(JSON.stringify({ result: "no_duplicate_candidate_found", action: "keep_separate" }, null, 2));
    return;
  }
  console.log(
    JSON.stringify(
      {
        result: "candidate_match_found",
        matchedEventId: best.match.id,
        matchedEventTitle: best.match.title,
        confidence: best.assessment.confidence,
        action: decideDuplicateAction(best.assessment.confidence),
        reasons: best.assessment.reasons,
        titleSimilarity: best.assessment.titleSimilarity,
        artistOverlap: best.assessment.artistOverlap,
        sameVenue: best.assessment.sameVenue,
        sameNight: best.assessment.sameNight,
      },
      null,
      2,
    ),
  );
}

async function modeReachability(_client: Client, args: Record<string, string | boolean>) {
  const endpoint = typeof args.endpoint === "string" ? args.endpoint : null;
  if (!endpoint) throw new Error("reachability requires --endpoint=<https url>");
  if (!/^https:\/\//i.test(endpoint)) throw new Error("reachability only accepts https:// endpoints.");

  section(`Reachability: ${endpoint}`);
  const res = await fetch(endpoint, {
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "ElectronicCPHSourceInspector/1.0 (+https://electroniccph.com/about; diagnostic)" },
  });
  console.log(`HTTP status: ${res.status}`);
  console.log(`content-type: ${res.headers.get("content-type") ?? "(none)"}`);
  console.log(`content-length: ${res.headers.get("content-length") ?? "(unknown)"}`);

  // Body preview + optional full-body save, so DIAGNOSE/IMPLEMENT (per
  // SOURCE_ONBOARDING.md) can confirm robots.txt permission and capture a
  // real, unmodified fixture from a GitHub-hosted runner (agent sandboxes
  // in this project cannot reach external hosts at all) without a fresh
  // one-off diagnostic workflow per source. Never used for anything but a
  // plain GET against a public https:// URL — no credentials, no DB.
  const bodyText = await res.text();
  console.log(`body length: ${bodyText.length} chars`);
  const saveBodyPath = typeof args["save-body"] === "string" ? args["save-body"] : null;
  if (saveBodyPath) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(saveBodyPath), { recursive: true });
    writeFileSync(saveBodyPath, bodyText, "utf-8");
    console.log(`Full body saved to ${saveBodyPath} (not printed here — see uploaded artifact).`);
  } else {
    console.log("-- body preview (first 4000 chars; pass --save-body=<path> for the full body as an artifact) --");
    console.log(bodyText.slice(0, 4000));
  }

  if (args["with-credentials"] && typeof args.source === "string" && args.source === "src-billetto") {
    const accessKeyId = process.env.BILLETTO_ACCESS_KEY_ID;
    const accessKeySecret = process.env.BILLETTO_ACCESS_KEY_SECRET;
    if (!accessKeyId || !accessKeySecret) {
      console.log("Billetto credential check requested but BILLETTO_ACCESS_KEY_ID / BILLETTO_ACCESS_KEY_SECRET are not set — skipping (never printed regardless).");
    } else {
      const authRes = await fetch(endpoint, {
        signal: AbortSignal.timeout(15_000),
        headers: {
          "user-agent": "ElectronicCPHSourceInspector/1.0 (+https://electroniccph.com/about; diagnostic)",
          "Api-Keypair": buildApiKeypairHeader(accessKeyId, accessKeySecret),
        },
      });
      console.log(`Authenticated HTTP status: ${authRes.status} (credential value never printed)`);
    }
  } else if (args["with-credentials"]) {
    console.log("--with-credentials is currently only wired for src-billetto (BILLETTO_ACCESS_KEY_ID/SECRET) — extend this branch if a future source needs a different credential check.");
  }
}

async function modeSnapshot(client: Client, args: Record<string, string | boolean>) {
  const sourceId = requireSource(args);
  const label = typeof args.label === "string" ? args.label : "SNAPSHOT";
  section(`${label}: ${sourceId}`);

  const src = await client.query("SELECT * FROM sources WHERE id = $1", [sourceId]);
  console.log("-- sources row --");
  console.log(JSON.stringify(src.rows[0] ?? null, null, 2));

  const dq = await client.query(
    `SELECT id, probable_title, status, predicted_genre, genre_confidence, overall_confidence,
            suspected_duplicate_of_event_id, source_url, created_at
     FROM discovery_queue WHERE source_id = $1 ORDER BY created_at`,
    [sourceId],
  );
  console.log(`-- discovery_queue (${dq.rows.length} rows) --`);
  console.log(JSON.stringify(dq.rows));

  const ev = await client.query(
    `SELECT id, title, venue_id, start_datetime, primary_genre, genre_confidence, confidence,
            published, manual_override, overridden_fields, official_event_url, created_at
     FROM events WHERE canonical_source_id = $1 ORDER BY created_at`,
    [sourceId],
  );
  console.log(`-- events (${ev.rows.length} rows) --`);
  console.log(JSON.stringify(ev.rows));

  const links = await client.query(
    `SELECT event_id, source_url, role, first_seen_at FROM source_event_links WHERE source_id = $1 ORDER BY first_seen_at`,
    [sourceId],
  );
  console.log(`-- source_event_links (${links.rows.length} rows) --`);
  console.log(JSON.stringify(links.rows));

  // Regression fingerprint for every OTHER source that has a real adapter —
  // computed dynamically from the sources table, never a hardcoded name
  // list, so this stays correct as sources are added/removed. A compact
  // count+md5 (not a full dump) is enough to prove "did anything change".
  const others = await client.query("SELECT id FROM sources WHERE id != $1 AND adapter IS NOT NULL ORDER BY id", [sourceId]);
  section(`Regression fingerprints (other adapter-backed sources, ${others.rows.length})`);
  for (const { id: otherId } of others.rows) {
    const fp = await client.query(
      `SELECT
         (SELECT count(*)::int FROM discovery_queue WHERE source_id = $1) AS dq_count,
         (SELECT md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) FROM discovery_queue WHERE source_id = $1) AS dq_md5,
         (SELECT count(*)::int FROM events WHERE canonical_source_id = $1) AS ev_count,
         (SELECT md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) FROM events WHERE canonical_source_id = $1) AS ev_md5,
         (SELECT count(*)::int FROM source_event_links WHERE source_id = $1) AS links_count,
         (SELECT md5(coalesce(string_agg(event_id::text, ',' ORDER BY event_id), '')) FROM source_event_links WHERE source_id = $1) AS links_md5`,
      [otherId],
    );
    console.log(JSON.stringify({ sourceId: otherId, ...fp.rows[0] }));
  }

  const overridden = await client.query(
    `SELECT count(*)::int AS n FROM events WHERE array_length(overridden_fields, 1) > 0 OR manual_override = true`,
  );
  console.log(`-- global manual-override event count: ${overridden.rows[0].n} (must never move because of a sync) --`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (typeof mode !== "string") {
    console.error("::error::--mode=<inventory|discovery-queue|source-links|health|lock-status|dedup-simulate|reachability|snapshot> is required.");
    process.exit(1);
  }

  const runners: Record<string, (client: Client, args: Record<string, string | boolean>) => Promise<void>> = {
    inventory: modeInventory,
    health: modeHealth,
    "discovery-queue": modeDiscoveryQueue,
    "source-links": modeSourceLinks,
    "lock-status": modeLockStatus,
    "dedup-simulate": modeDedupSimulate,
    snapshot: modeSnapshot,
  };

  if (mode === "reachability") {
    // No DB connection needed at all for a pure HTTP check.
    await modeReachability(null as unknown as Client, args);
    return;
  }

  const runner = runners[mode];
  if (!runner) {
    console.error(`::error::Unknown --mode="${mode}". Valid modes: inventory, discovery-queue, source-links, health, lock-status, dedup-simulate, reachability, snapshot.`);
    process.exit(1);
  }

  await withReadOnlyTx((client) => runner(client, args));
}

main().catch((err) => {
  console.error("::error::inspectSource.ts FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
