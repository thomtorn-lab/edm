import { Client } from "pg";
import { getSourceHealth, describeSourceHealth } from "@/lib/sourceHealth";
import { resolveVenue } from "@/lib/normalize";
import { findBestDuplicateMatch, decideDuplicateAction, type DuplicateCandidate } from "@/lib/dedup";
import { isDiscoveryRowCurrent, classifyVenueBlock } from "@/lib/sync";
import { buildApiKeypairHeader } from "@/lib/adapters/billettoAdapter";
import { isPastEvent } from "@/lib/datetime";
import type { Source, Venue } from "@/lib/types";
import type { PublishDecision } from "@/lib/classification";
import type { HoldReason } from "@/lib/adapters/pipeline";

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
 *     --mode=<inventory|discovery-queue|source-links|health|lock-status|dedup-simulate|reachability|snapshot|venues|venue-events|discovery-queue-venues|venue-blocks|event-integrity|link-role-audit|db-integrity> \
 *     [--source=<sourceId>] [--limit=20] [--endpoint=<url>] [--with-credentials]
 *     [--title=... --artists="A, B" --venue=... --start=<ISO> --url=<officialEventUrl>]  (dedup-simulate only)
 *     [--table=<venues|sources|events|discovery_queue|source_event_links|sync_locks>]  (db-integrity only, optional)
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
    shortDescription: (r.short_description as string | null) ?? null,
    venueProfile: (r.venue_profile as string | null) ?? null,
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
    `SELECT id, probable_title, probable_start, probable_venue_name, status, predicted_genre, genre_confidence, overall_confidence,
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

/**
 * Decodes a fetch Response body using the ACTUAL charset it was served
 * with, rather than `res.text()`'s blind UTF-8 assumption. Real bug found
 * capturing KultuNaut fixtures (2026-09-05): that site serves
 * `Content-Type: text/html` with no charset param, but its bytes are
 * iso-8859-1 — every non-ASCII byte (æøå etc.) is a value invalid as a
 * lone UTF-8 sequence, so `res.text()` silently replaces each one with
 * U+FFFD, permanently destroying the character (not recoverable by
 * re-decoding afterward, unlike ordinary mojibake). This diagnostic tool
 * exists precisely to capture byte-accurate real pages for fixture/DIAGNOSE
 * use, so it must get the charset right for ANY future source, not just
 * this one: prefer the header's declared charset, fall back to sniffing a
 * `<meta charset>`/`<meta http-equiv=Content-Type ... charset=...>` tag
 * (read via iso-8859-1, which is ASCII-safe for the tag's own characters
 * regardless of the body's real encoding), and only default to utf-8 if
 * neither is present.
 */
async function decodeResponseBody(res: Response): Promise<string> {
  const buffer = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "";
  const headerCharset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase();
  let charset = headerCharset || null;
  if (!charset) {
    const head = new TextDecoder("iso-8859-1").decode(buffer.slice(0, 4096));
    charset = head.match(/<meta[^>]+charset=["']?([a-z0-9_-]+)/i)?.[1]?.toLowerCase() ?? "utf-8";
  }
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  }
}

async function modeReachability(_client: Client, args: Record<string, string | boolean>) {
  const endpoint = typeof args.endpoint === "string" ? args.endpoint : null;
  if (!endpoint) throw new Error("reachability requires --endpoint=<https url>");
  if (!/^https:\/\//i.test(endpoint)) throw new Error("reachability only accepts https:// endpoints.");

  const method = typeof args.method === "string" ? args.method.toUpperCase() : "GET";
  const body = typeof args.body === "string" ? args.body : undefined;
  if (method !== "GET" && method !== "POST") throw new Error('reachability --method must be "GET" or "POST".');

  section(`Reachability: ${method} ${endpoint}`);
  const res = await fetch(endpoint, {
    method,
    signal: AbortSignal.timeout(15_000),
    headers: {
      "user-agent": "ElectronicCPHSourceInspector/1.0 (+https://electroniccph.com/about; diagnostic)",
      ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(method === "POST" ? { body } : {}),
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
  const bodyText = await decodeResponseBody(res);
  console.log(`body length: ${bodyText.length} chars`);
  const saveBodyPath = typeof args["save-body"] === "string" ? args["save-body"] : null;
  const printFull = args["print-full-body"] === true;
  // Bounded slice of the body, printed instead of the whole thing — for a
  // page large enough that neither --print-full-body (the job log's own
  // retrieval API has a fixed, tail-anchored output-size cap regardless of
  // how many lines are requested — confirmed live against Hangaren's
  // events page, 2026-08-30) nor --save-body's artifact (its download URL
  // redirects to blob storage a caller's own network policy may not permit
  // reaching) can get the WHOLE body back to the caller. `--body-start`
  // (default 0) and `--body-length` (default 200000) select a byte range
  // of `bodyText` — e.g. the first 200000 chars, which for a long page
  // reliably lands well inside the job log's own return cap, letting a
  // caller walk the page in a few bounded requests instead of none.
  const bodyStart = typeof args["body-start"] === "string" ? Number(args["body-start"]) : 0;
  const bodyLength = typeof args["body-length"] === "string" ? Number(args["body-length"]) : 200_000;
  if (saveBodyPath) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(saveBodyPath), { recursive: true });
    writeFileSync(saveBodyPath, bodyText, "utf-8");
    console.log(`Full body saved to ${saveBodyPath} (not printed here — see uploaded artifact).`);
  } else if (printFull) {
    // Printed to the job log (not saved as an artifact) — for callers whose
    // network path can reach the GitHub Actions API/log endpoint but not
    // arbitrary blob storage hosts the artifact download redirects to.
    if (Number.isFinite(bodyStart) && (bodyStart > 0 || (typeof args["body-length"] === "string" && Number.isFinite(bodyLength)))) {
      const slice = bodyText.slice(bodyStart, bodyStart + bodyLength);
      console.log(`-- BODY SLICE chars [${bodyStart}, ${bodyStart + bodyLength}) of ${bodyText.length} total (--body-start/--body-length) --`);
      console.log(slice);
      console.log("-- end of slice --");
    } else {
      console.log("-- FULL body (--print-full-body) --");
      console.log(bodyText);
      console.log("-- end of body --");
    }
  } else {
    console.log("-- body preview (first 4000 chars; pass --save-body=<path> for an artifact, or --print-full-body to print the full body to this log) --");
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

      // Same save/print-full/preview options as the unauthenticated fetch
      // above, reused here so a real authenticated response body (the only
      // way to see actual Billetto categorization/description payloads) can
      // be captured without a one-off diagnostic script. Never prints or
      // saves anything credential-related — only the response body.
      const authBodyText = await decodeResponseBody(authRes);
      console.log(`Authenticated body length: ${authBodyText.length} chars`);
      if (saveBodyPath) {
        const { writeFileSync, mkdirSync } = await import("node:fs");
        const { dirname } = await import("node:path");
        const authSavePath = saveBodyPath.replace(/(\.[^./]+)?$/, (ext) => `.authenticated${ext || ""}`);
        mkdirSync(dirname(authSavePath), { recursive: true });
        writeFileSync(authSavePath, authBodyText, "utf-8");
        console.log(`Authenticated full body saved to ${authSavePath} (not printed here — see uploaded artifact).`);
      } else if (printFull) {
        console.log("-- FULL authenticated body (--print-full-body) --");
        console.log(authBodyText);
        console.log("-- end of authenticated body --");
      } else {
        console.log("-- authenticated body preview (first 4000 chars; pass --save-body=<path> for an artifact, or --print-full-body to print the full body to this log) --");
        console.log(authBodyText.slice(0, 4000));
      }
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
    `SELECT id, slug, title, description, artists, venue_id, start_datetime, primary_genre, genre_confidence, confidence,
            published, cancelled, manual_override, overridden_fields, official_event_url, ticket_url,
            resident_advisor_url, facebook_url, image_url, price_from, created_at
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

/** Read-only venue registry dump — id, name, address, content fields (and alias/city/postal) — optionally filtered to one venue id. */
async function modeVenues(client: Client, args: Record<string, string | boolean>) {
  const venueId = typeof args.venue === "string" ? args.venue : null;
  const cols = "id, slug, name, aliases, address, city, postal_code, website_url, description, short_description, venue_profile, updated_at";
  section(venueId ? `Venue: ${venueId}` : "All venues");
  const rows = venueId
    ? (await client.query(`SELECT ${cols} FROM venues WHERE id = $1`, [venueId])).rows
    : (await client.query(`SELECT ${cols} FROM venues ORDER BY name`)).rows;
  console.log(JSON.stringify(rows, null, 2));
}

/**
 * Read-only venue x events cross-tab (venue-coverage-expansion audit,
 * 2026-08-29): for every venue row, how many events reference it (published
 * vs not) and how many of the published ones are currently upcoming
 * (isPastEvent, same semantics the public site uses — src/lib/datetime.ts),
 * plus up to 3 example upcoming event titles/dates. Generalizes the
 * "which curated venues have upcoming events" question modeVenues alone
 * can't answer (it only dumps venue rows, no event join), without a
 * one-off script per audit.
 */
async function modeVenueEvents(client: Client, _args: Record<string, string | boolean>) {
  section("Venues x events cross-tab");
  const venueRows = await client.query(
    "SELECT id, slug, name, address, website_url FROM venues ORDER BY name",
  );
  const now = new Date();
  for (const v of venueRows.rows) {
    const evRows = await client.query(
      `SELECT id, title, start_datetime, end_datetime, published, canonical_source_id
       FROM events WHERE venue_id = $1 ORDER BY start_datetime`,
      [v.id],
    );
    const published = evRows.rows.filter((r) => r.published === true);
    const upcoming = published.filter(
      (r) => !isPastEvent({ startDatetime: new Date(r.start_datetime as string).toISOString(), endDatetime: r.end_datetime ? new Date(r.end_datetime as string).toISOString() : null }, now),
    );
    console.log(
      JSON.stringify(
        {
          id: v.id,
          slug: v.slug,
          name: v.name,
          address: v.address,
          websiteUrl: v.website_url,
          totalEvents: evRows.rows.length,
          publishedEvents: published.length,
          upcomingPublishedEvents: upcoming.length,
          upcomingSourceIds: Array.from(new Set(upcoming.map((r) => r.canonical_source_id).filter(Boolean))),
          upcomingExamples: upcoming.slice(0, 3).map((r) => ({ title: r.title, start: new Date(r.start_datetime as string).toISOString() })),
        },
        null,
        2,
      ),
    );
  }
}

/**
 * Read-only discovery_queue probable_venue_name frequency, across ALL
 * sources (unlike modeDiscoveryQueue, which requires --source) — for the
 * venue-coverage-expansion audit's "repeated unresolved venue name" signal
 * (a real, repeated probable_venue_name across many pending rows is
 * stronger registry-addition evidence than a web listicle). Scoped to
 * status='pending' only; never touches or previews queue-row publishing.
 */
async function modeDiscoveryQueueVenues(client: Client, args: Record<string, string | boolean>) {
  const limit = typeof args.limit === "string" ? Number(args.limit) : 40;
  section("discovery_queue: pending rows grouped by probable_venue_name (all sources)");
  const grouped = await client.query(
    `SELECT probable_venue_name, source_id, count(*)::int AS n
     FROM discovery_queue
     WHERE status = 'pending' AND probable_venue_name IS NOT NULL AND probable_venue_name != ''
     GROUP BY probable_venue_name, source_id
     ORDER BY n DESC
     LIMIT $1`,
    [limit],
  );
  console.log(JSON.stringify(grouped.rows, null, 2));

  section("discovery_queue: pending rows with NO probable_venue_name (all sources)");
  const nullCount = await client.query(
    `SELECT source_id, count(*)::int AS n FROM discovery_queue
     WHERE status = 'pending' AND (probable_venue_name IS NULL OR probable_venue_name = '')
     GROUP BY source_id ORDER BY n DESC`,
  );
  console.log(JSON.stringify(nullCount.rows, null, 2));
}

/**
 * Read-only "which unresolved venues are actually worth registering right
 * now" report (unknown-venue visibility work package, 2026-08-31; precision
 * fix follow-up) — across ALL sources, not scoped to one. Directly answers
 * the operational question the Billetto activation test kept having to
 * answer by hand: "which candidates are blocked ONLY by an unresolved
 * venue, right now, upcoming, and would actually qualify (auto-publish or
 * review) once that venue registers" — as opposed to a stale row left over
 * from an event the source no longer returns (real case: High Energy
 * Movement/Rørt), a past event the source still happens to return, or a
 * row that carries some genre evidence yet would still hold for an
 * unrelated reason even with its venue resolved.
 *
 * Four mutually exclusive dimensions are never conflated (precision fix,
 * follow-up to the first cut of this diagnostic, which conflated all of
 * them): SOURCE FRESHNESS (current vs. stale upstream — derived exactly as
 * before, never stored, via isDiscoveryRowCurrent), EVENT TIME (upcoming vs.
 * past — via the same isPastEvent the rest of the app uses, never a
 * hand-rolled date comparison), and PIPELINE BLOCK (venue-only vs. venue +
 * another blocker vs. not actually relevant — via
 * discovery_queue.venue_resolved_decision/venue_resolved_hold_reason, the
 * REAL quality-gate outcome computed by src/lib/adapters/pipeline.ts's
 * computeVenueResolvedCounterfactual on every sync, never approximated here
 * from predicted_genre/genre_confidence). A row lands in exactly one of:
 *
 *   ACTIVE            current upstream + upcoming + venue is the ONLY
 *                     blocker + counterfactual = auto_publish or
 *                     review_queue. The only bucket that should ever
 *                     justify registering a venue.
 *   STALE             not confirmed present in the most recent complete
 *                     sync (freshness alone decides this, regardless of
 *                     event time or pipeline block).
 *   CURRENT_BUT_PAST  still returned upstream, but the event's own date/
 *                     time has passed (or is entirely unknown — nothing to
 *                     confirm as "upcoming"). Useful diagnostically
 *                     (a source still serving expired inventory), never an
 *                     onboarding signal.
 *   OTHER_BLOCKERS    current + upcoming + venue unresolved, but the real
 *                     pipeline says it would still hold for another reason
 *                     (or the counterfactual hasn't been (re)computed yet
 *                     for a pre-precision-fix row) — a genre-evidenced
 *                     candidate that is NOT the same claim as "would
 *                     qualify if this venue registered".
 *
 * Deliberately still pre-filters on predicted_genre IS NOT NULL — the
 * hundreds of Billetto rows with zero genre evidence at all would trivially
 * land in OTHER_BLOCKERS (their counterfactual is always "hold") and add
 * pure noise to a bucket meant to surface genuinely close calls, not
 * restate that Discovery Queue has a long tail of irrelevant candidates.
 *
 * `venue_now_resolves` cross-checks each distinct probable_venue_name
 * against the REAL, live resolveVenue() and current venues table — a "yes"
 * here alongside a still-set venue-unresolved missing_fields entry would be
 * a genuine inconsistency worth flagging, not expected in normal operation.
 */
async function modeVenueBlocks(client: Client) {
  const rows = await client.query(`
    SELECT
      dq.id, dq.probable_title, dq.probable_start, dq.probable_end, dq.probable_venue_name, dq.source_id,
      dq.predicted_genre, dq.genre_confidence, dq.overall_confidence, dq.source_url, dq.missing_fields,
      dq.venue_resolved_decision, dq.venue_resolved_hold_reason,
      dq.last_seen_at, dq.created_at,
      s.source_name, s.last_complete_sync_at
    FROM discovery_queue dq
    LEFT JOIN sources s ON s.id = dq.source_id
    WHERE dq.status = 'pending'
      AND dq.predicted_genre IS NOT NULL
      AND dq.probable_venue_name IS NOT NULL AND dq.probable_venue_name != ''
      AND 'venue (unresolved against registry)' = ANY(dq.missing_fields)
    ORDER BY dq.probable_venue_name, dq.source_id, dq.probable_start
  `);

  const venueRows = await client.query("SELECT * FROM venues");
  const venues = venueRows.rows.map(rowToVenue);
  const now = new Date();

  /** Human-readable "exact blocker" for OTHER_BLOCKERS, derived entirely
   *  from already-computed fields — never re-deriving relevance/quality-gate
   *  logic here. */
  function describeOtherBlocker(holdReason: HoldReason, missingFields: string[]): string {
    if (holdReason === "negative_relevance") {
      return "negative relevance signal once genre is considered (event/artist text reads as non-electronic)";
    }
    if (holdReason === "low_confidence") {
      return "genre confidence below the auto-publish/review threshold";
    }
    if (holdReason === "incomplete_data") {
      const otherMissing = missingFields.filter((f) => f !== "venue (unresolved against registry)");
      return otherMissing.length > 0 ? `missing required field(s): ${otherMissing.join(", ")}` : "incomplete data this run";
    }
    return "not yet evaluated (row not re-synced since this precision fix shipped)";
  }

  const active: Record<string, unknown>[] = [];
  const stale: Record<string, unknown>[] = [];
  const currentButPast: Record<string, unknown>[] = [];
  const otherBlockers: Record<string, unknown>[] = [];

  for (const r of rows.rows) {
    const lastSeenAt = r.last_seen_at ? new Date(r.last_seen_at as string) : null;
    const lastCompleteSyncAt = r.last_complete_sync_at ? new Date(r.last_complete_sync_at as string) : null;
    const isCurrent = isDiscoveryRowCurrent(lastSeenAt, lastCompleteSyncAt);
    const probableStart = r.probable_start as string | null;
    // Reuses the exact same "is this event over" logic the rest of the app
    // uses (accounts for endDatetime/default duration) rather than a naive
    // start-time-only comparison — null start is "unknown", never "past".
    const isPast = probableStart ? isPastEvent({ startDatetime: probableStart, endDatetime: r.probable_end as string | null }, now) : null;
    const resolved = resolveVenue(r.probable_venue_name as string, venues);
    const venueResolvedDecision = r.venue_resolved_decision as PublishDecision | null;
    const venueResolvedHoldReason = r.venue_resolved_hold_reason as HoldReason;
    const missingFields = (r.missing_fields as string[]) ?? [];

    const entry = {
      queueId: r.id,
      venue: r.probable_venue_name,
      sourceId: r.source_id,
      sourceName: r.source_name,
      title: r.probable_title,
      date: r.probable_start,
      stillUpcoming: probableStart ? !isPast : null,
      predictedGenre: r.predicted_genre,
      genreConfidence: r.genre_confidence,
      overallConfidence: r.overall_confidence,
      sourceUrl: r.source_url,
      lastSeenAt: r.last_seen_at,
      lastCompleteSyncAt: r.last_complete_sync_at,
      createdAt: r.created_at,
      venueNowResolves: resolved ? { id: resolved.id, name: resolved.name } : null,
      counterfactualDecision: venueResolvedDecision,
    };

    // See classifyVenueBlock's own doc comment (src/lib/sync.ts) for exactly
    // how the three dimensions — freshness, event time, pipeline block —
    // combine into one bucket without conflating them.
    const bucket = classifyVenueBlock({ isCurrent, isPast, venueResolvedDecision });
    switch (bucket) {
      case "stale":
        stale.push(entry);
        break;
      case "current_but_past":
        currentButPast.push({ ...entry, otherBlockers: "NONE" });
        break;
      case "active":
        active.push({ ...entry, otherBlockers: "NONE" });
        break;
      case "other_blockers":
        otherBlockers.push({ ...entry, otherBlockers: describeOtherBlocker(venueResolvedHoldReason, missingFields) });
        break;
    }
  }

  const groupBy = (list: Record<string, unknown>[]) => {
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const e of list) {
      const key = `${e.venue}|||${e.sourceId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    return Array.from(groups.values())
      .map((items) => ({
        venue: items[0].venue,
        sourceId: items[0].sourceId,
        sourceName: items[0].sourceName,
        blockedEventCount: items.length,
        events: items.map(({ venue: _v, sourceId: _s, sourceName: _sn, ...rest }) => rest),
      }))
      .sort((a, b) => b.blockedEventCount - a.blockedEventCount);
  };

  section("ACTIVE venue blocks (current upstream + upcoming + venue is the ONLY blocker + would auto-publish or reach review) — the only bucket that should justify registering a venue");
  console.log(JSON.stringify(groupBy(active), null, 2));

  section("CURRENT_BUT_PAST (still returned upstream, but the event's own date has passed or is unknown) — diagnostic only, never an onboarding signal");
  console.log(JSON.stringify(groupBy(currentButPast), null, 2));

  section("OTHER_BLOCKERS (current + upcoming + venue unresolved, but the real pipeline says it would still hold for another reason)");
  console.log(JSON.stringify(groupBy(otherBlockers), null, 2));

  section("STALE venue blocks (NOT confirmed present in the most recent complete sync — do not use these to justify venue onboarding)");
  console.log(JSON.stringify(groupBy(stale), null, 2));
}

/**
 * Read-only schema/row-count integrity check (migration verification
 * follow-up, 2026-08-24): confirms a migration's actual effect —
 * before/after — without any per-source scoping. Two independent things:
 *
 * 1. `--table=<name>` (optional, one of DB_INTEGRITY_ALLOWED_TABLES below):
 *    information_schema.columns for that table — name, type, nullable,
 *    default — so a specific column's existence/shape can be confirmed
 *    directly rather than inferred from a query merely not erroring.
 * 2. Always: total row counts for venues, sources, events, and
 *    source_event_links, plus discovery_queue's count broken down by
 *    status. Diffing this output before and after a migration proves no
 *    reference-data table or row was touched by a schema-only change —
 *    exactly the same regression-fingerprint idea modeSnapshot already
 *    uses for one source, generalized to the whole database.
 *
 * The table name is validated against a fixed allowlist (never
 * interpolated from free-form input beyond that check) before being
 * substituted into the information_schema query.
 */
/**
 * Read-only public-event integrity audit (title contamination + expired-
 * event-visibility work package, 2026-09-04) — across every PUBLISHED
 * canonical event, joined to venue/source names. Two independent things,
 * from the same base query, never mutating anything:
 *
 *   1. TITLE CONTAMINATION: flags a title against several deterministic,
 *      source-agnostic heuristics (unusual length, multiple sentence-ending
 *      punctuation marks, a known CTA phrase, an embedded URL) — never a
 *      guess at what the "real" title should be, just which stored titles
 *      look like they swallowed description/body copy. Every flagged
 *      event's real source title/description/link text still has to be
 *      independently re-derived from the actual source (this mode only
 *      says WHICH events to look at, not what's wrong with each one).
 *   2. END-TIME DATA QUALITY: reports, per source, how many published
 *      events carry a real end_datetime vs. rely on the no-end-time
 *      fallback (src/lib/datetime.ts's effectiveEndInstant), plus flags any
 *      end_datetime that is structurally suspicious (before its own
 *      start_datetime, or absurdly far after it — more than 18h, longer
 *      than any real Copenhagen club night) so those can be treated as
 *      untrustworthy rather than taken at face value.
 *
 * `--title=<substring>` narrows to events whose title contains the given
 * (case-insensitive) substring — used to pull up the exact reference cases
 * this work package started from without dumping the entire table.
 */
async function modeEventIntegrity(client: Client, args: Record<string, string | boolean>) {
  const titleFilter = typeof args.title === "string" ? args.title : null;
  const rows = await client.query(
    `SELECT e.id, e.slug, e.title, e.description, e.start_datetime, e.end_datetime,
            e.published, e.official_event_url, e.canonical_source_id,
            v.name AS venue_name, s.source_name
     FROM events e
     LEFT JOIN venues v ON v.id = e.venue_id
     LEFT JOIN sources s ON s.id = e.canonical_source_id
     WHERE e.published = true
     ${titleFilter ? "AND e.title ILIKE $1" : ""}
     ORDER BY e.start_datetime`,
    titleFilter ? [`%${titleFilter}%`] : [],
  );

  const CTA_PATTERNS = /\b(view event|read more|learn more|buy tickets?|get tickets?|book now|find out more|see more)\b/i;
  const SENTENCE_END_RE = /[.!?]/g;

  function titleFlags(title: string): string[] {
    const flags: string[] = [];
    if (title.length > 100) flags.push(`unusually_long(${title.length}_chars)`);
    const sentenceEnders = (title.match(SENTENCE_END_RE) ?? []).length;
    if (sentenceEnders >= 2) flags.push(`multiple_sentence_terminators(${sentenceEnders})`);
    if (CTA_PATTERNS.test(title)) flags.push(`cta_text("${title.match(CTA_PATTERNS)![0]}")`);
    if (/https?:\/\//i.test(title)) flags.push("embedded_url");
    if (/\.\.\.| — |…/.test(title) && title.length > 60) flags.push("ellipsis_or_dash_with_length");
    return flags;
  }

  const titleFlagged: Record<string, unknown>[] = [];
  const endTimeRows: Record<string, unknown>[] = [];
  const sourceBreakdown = new Map<string, { withEnd: number; withoutEnd: number; suspicious: number }>();

  for (const r of rows.rows) {
    const title = r.title as string;
    const flags = titleFlags(title);
    if (flags.length > 0) {
      titleFlagged.push({
        id: r.id,
        slug: r.slug,
        venue: r.venue_name,
        source: r.source_name,
        title,
        titleLength: title.length,
        flags,
        officialEventUrl: r.official_event_url,
      });
    }

    const start = r.start_datetime ? new Date(r.start_datetime as string) : null;
    const end = r.end_datetime ? new Date(r.end_datetime as string) : null;
    const sourceKey = (r.source_name as string | null) ?? "(no source)";
    if (!sourceBreakdown.has(sourceKey)) sourceBreakdown.set(sourceKey, { withEnd: 0, withoutEnd: 0, suspicious: 0 });
    const bucket = sourceBreakdown.get(sourceKey)!;

    let suspicious: string | null = null;
    if (end && start) {
      const diffHours = (end.getTime() - start.getTime()) / 3_600_000;
      if (diffHours < 0) suspicious = `end_before_start(${diffHours.toFixed(1)}h)`;
      else if (diffHours > 18) suspicious = `end_over_18h_after_start(${diffHours.toFixed(1)}h)`;
    }

    if (end) bucket.withEnd++;
    else bucket.withoutEnd++;
    if (suspicious) bucket.suspicious++;

    endTimeRows.push({
      id: r.id,
      title,
      venue: r.venue_name,
      source: r.source_name,
      startDatetime: r.start_datetime,
      endDatetime: r.end_datetime,
      hasEndDatetime: end != null,
      suspicious,
    });
  }

  section(`TITLE CONTAMINATION — flagged events (${titleFlagged.length} of ${rows.rows.length} published events inspected)`);
  console.log(JSON.stringify(titleFlagged, null, 2));

  section(`END-TIME DATA QUALITY — per-source breakdown (${rows.rows.length} published events inspected)`);
  console.log(JSON.stringify(Array.from(sourceBreakdown.entries()).map(([source, n]) => ({ source, ...n })), null, 2));

  section("END-TIME DATA QUALITY — every inspected event (start/end/suspicious flag)");
  console.log(JSON.stringify(endTimeRows, null, 2));
}

/**
 * Event-link role audit (event-link-role-classification work package,
 * 2026-09-05 — Zoumer reference case). Mirrors src/lib/links.ts's own
 * officialUrlRole() classification (event's canonicalSourceId's
 * source_type: official-venue/official-promoter -> keep "Official event";
 * ticketing -> "Tickets"; specialist-aggregator/general-aggregator/social ->
 * "Source"; no resolvable source -> unchanged/"Official event") so this
 * diagnostic reports exactly what the public site now renders, not a
 * separate judgment call. Read-only — never writes; see this file's header
 * comment for the shared withReadOnlyTx safety guarantee every mode uses.
 */
async function modeLinkRoleAudit(client: Client, args: Record<string, string | boolean>) {
  const titleFilter = typeof args.title === "string" ? args.title : null;
  const rows = await client.query(
    `SELECT e.id, e.title, e.official_event_url, e.ticket_url, e.resident_advisor_url,
            e.canonical_source_id, s.source_name, s.source_type,
            v.name AS venue_name
     FROM events e
     LEFT JOIN venues v ON v.id = e.venue_id
     LEFT JOIN sources s ON s.id = e.canonical_source_id
     WHERE e.published = true
     ${titleFilter ? "AND e.title ILIKE $1" : ""}
     ORDER BY e.start_datetime`,
    titleFilter ? [`%${titleFilter}%`] : [],
  );

  function roleForSourceType(sourceType: string | null): "official" | "tickets" | "unknown" {
    if (!sourceType) return "official"; // no resolvable source (e.g. admin-added) — unchanged, matches links.ts
    if (sourceType === "ticketing") return "tickets";
    if (sourceType === "official-venue" || sourceType === "official-promoter") return "official";
    return "unknown";
  }

  function normalize(url: string | null): string | null {
    if (!url) return null;
    try {
      const u = new URL(url);
      u.searchParams.forEach((_, key) => {
        if (/^utm_/i.test(key)) u.searchParams.delete(key);
      });
      return `${u.origin}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    } catch {
      return url.trim();
    }
  }

  const flagged: Record<string, unknown>[] = [];
  const noUsableLink: Record<string, unknown>[] = [];
  let sameUrlCount = 0;
  let sameUrlMismatchCount = 0;

  for (const r of rows.rows) {
    const officialUrl = r.official_event_url as string | null;
    const ticketUrl = r.ticket_url as string | null;
    const sourceType = r.source_type as string | null;
    const officialNorm = normalize(officialUrl);
    const ticketNorm = normalize(ticketUrl);
    const sameDestination = officialNorm !== null && officialNorm === ticketNorm;
    const role = officialUrl ? roleForSourceType(sourceType) : null;
    const renderedLabelToday = officialUrl ? (role === "tickets" ? "Tickets" : role === "unknown" ? "Source" : "Official event") : null;
    // "Historically rendered as" reconstructs what the OLD (pre-fix)
    // insertion-order dedup would have shown, for comparison purposes only.
    const historicallyRendered = officialUrl ? "Official event" : ticketUrl ? "Tickets" : null;

    if (sameDestination) {
      sameUrlCount++;
      if (renderedLabelToday !== historicallyRendered) sameUrlMismatchCount++;
    }
    if (!officialUrl && !ticketUrl && !r.resident_advisor_url) {
      noUsableLink.push({ id: r.id, title: r.title, venue: r.venue_name, source: r.source_name });
    }
    if (sameDestination && role !== "official") {
      flagged.push({
        id: r.id,
        title: r.title,
        venue: r.venue_name,
        source: r.source_name,
        sourceType,
        officialEventUrl: officialUrl,
        ticketUrl,
        renderedLabelToday,
        historicallyRenderedAsOfficialEvent: historicallyRendered === "Official event",
        trueFunctionalRole: role,
      });
    }
  }

  section(`LINK-ROLE AUDIT — same official/ticket destination, now correctly relabeled (${flagged.length} of ${rows.rows.length} published events inspected)`);
  console.log(JSON.stringify(flagged, null, 2));

  section("LINK-ROLE AUDIT — summary");
  console.log(
    JSON.stringify(
      {
        totalInspected: rows.rows.length,
        officialAndTicketSameDestination: sameUrlCount,
        ofThoseRelabeledAwayFromOfficialEvent: sameUrlMismatchCount,
        eventsWithNoUsableLink: noUsableLink.length,
      },
      null,
      2,
    ),
  );

  section(`LINK-ROLE AUDIT — events with no usable public link (${noUsableLink.length})`);
  console.log(JSON.stringify(noUsableLink, null, 2));
}

const DB_INTEGRITY_ALLOWED_TABLES = ["venues", "sources", "events", "discovery_queue", "source_event_links", "sync_locks"];

async function modeDbIntegrity(client: Client, args: Record<string, string | boolean>) {
  const table = typeof args.table === "string" ? args.table : null;
  if (table) {
    if (!DB_INTEGRITY_ALLOWED_TABLES.includes(table)) {
      throw new Error(`--table="${table}" is not in the allowed list: ${DB_INTEGRITY_ALLOWED_TABLES.join(", ")}.`);
    }
    section(`Schema columns: ${table}`);
    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table],
    );
    console.log(JSON.stringify(cols.rows, null, 2));
  }

  section("Row counts (all reference/event tables)");
  const counts = await client.query(`
    SELECT 'venues' AS table_name, count(*)::int AS n FROM venues
    UNION ALL SELECT 'sources', count(*)::int FROM sources
    UNION ALL SELECT 'events', count(*)::int FROM events
    UNION ALL SELECT 'discovery_queue', count(*)::int FROM discovery_queue
    UNION ALL SELECT 'source_event_links', count(*)::int FROM source_event_links
    ORDER BY table_name
  `);
  console.log(JSON.stringify(counts.rows, null, 2));

  section("discovery_queue by status");
  const byStatus = await client.query(
    "SELECT status, count(*)::int AS n FROM discovery_queue GROUP BY status ORDER BY status",
  );
  console.log(JSON.stringify(byStatus.rows, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (typeof mode !== "string") {
    console.error(
      "::error::--mode=<inventory|discovery-queue|source-links|health|lock-status|dedup-simulate|reachability|snapshot|venues|db-integrity> is required.",
    );
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
    venues: modeVenues,
    "venue-events": modeVenueEvents,
    "discovery-queue-venues": modeDiscoveryQueueVenues,
    "venue-blocks": modeVenueBlocks,
    "event-integrity": modeEventIntegrity,
    "link-role-audit": modeLinkRoleAudit,
    "db-integrity": modeDbIntegrity,
  };

  if (mode === "reachability") {
    // No DB connection needed at all for a pure HTTP check.
    await modeReachability(null as unknown as Client, args);
    return;
  }

  const runner = runners[mode];
  if (!runner) {
    console.error(
      `::error::Unknown --mode="${mode}". Valid modes: inventory, discovery-queue, source-links, health, lock-status, dedup-simulate, reachability, snapshot, venues, venue-events, discovery-queue-venues, venue-blocks, event-integrity, link-role-audit, db-integrity.`,
    );
    process.exit(1);
  }

  await withReadOnlyTx((client) => runner(client, args));
}

main().catch((err) => {
  console.error("::error::inspectSource.ts FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
