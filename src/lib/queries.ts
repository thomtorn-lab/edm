import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { artistYoutubePreviewCache, discoveryQueue, events, sourceEventLinks, sources, venues } from "@/db/schema";
import {
  discoveryRowToRecord,
  eventRowToRecord,
  sourceRowToRecord,
  venueRowToRecord,
} from "@/db/mappers";
import { cleanArtistDisplayName, normalizeArtistName } from "./enrichment/genreEnrichment";
import type { DiscoveryQueueItem, DiscoveryQueueStatus, EventRecord, Source, Venue } from "./types";

export interface EventWithVenue extends EventRecord {
  venue: Venue;
}

/**
 * Data-access layer, now backed by Postgres. Function names/shapes are
 * unchanged from the Phase 1 static-fixture version on purpose — pages and
 * components only ever depended on this contract, not on where the data
 * physically lived, so this swap didn't touch app/ or components/.
 */

export async function getVenues(): Promise<Venue[]> {
  const rows = await db.select().from(venues).orderBy(venues.name);
  return rows.map(venueRowToRecord);
}

export async function getVenueBySlug(slug: string): Promise<Venue | undefined> {
  const [row] = await db.select().from(venues).where(eq(venues.slug, slug)).limit(1);
  return row ? venueRowToRecord(row) : undefined;
}

export async function getVenueById(id: string): Promise<Venue | undefined> {
  const [row] = await db.select().from(venues).where(eq(venues.id, id)).limit(1);
  return row ? venueRowToRecord(row) : undefined;
}

export async function getSources(): Promise<Source[]> {
  const rows = await db.select().from(sources).orderBy(sources.sourceName);
  return rows.map(sourceRowToRecord);
}

export async function getSourceById(id: string): Promise<Source | undefined> {
  const [row] = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
  return row ? sourceRowToRecord(row) : undefined;
}

export async function getDiscoveryQueue(
  status: DiscoveryQueueStatus = "pending",
): Promise<DiscoveryQueueItem[]> {
  const rows = await db
    .select()
    .from(discoveryQueue)
    .where(eq(discoveryQueue.status, status))
    .orderBy(desc(discoveryQueue.createdAt));
  return rows.map(discoveryRowToRecord);
}

/**
 * Every discovery_queue row the admin Discovery Queue tabs need to classify
 * (admin Discovery Queue cleanup/actionable views, 2026-09-06): "pending"
 * (the 5 actionable/blocked/insufficient/rejected/past-stale tabs) plus
 * "published"/"merged" (the PUBLISHED tab). Deliberately excludes "ignored"
 * — no tab shows dismissed rows, so fetching them would only cost query
 * time and client payload for data nothing renders (Section 14's
 * performance requirement). One query via inArray rather than 3 separate
 * status queries.
 */
export async function getDiscoveryQueueForAdmin(): Promise<DiscoveryQueueItem[]> {
  const rows = await db
    .select()
    .from(discoveryQueue)
    .where(inArray(discoveryQueue.status, ["pending", "published", "merged"]))
    .orderBy(desc(discoveryQueue.createdAt));
  return rows.map(discoveryRowToRecord);
}

async function attachVenue(eventRows: (typeof events.$inferSelect)[]): Promise<EventWithVenue[]> {
  if (eventRows.length === 0) return [];
  const venueRows = await db.select().from(venues);
  const byId = new Map(venueRows.map((v) => [v.id, venueRowToRecord(v)]));
  const result: EventWithVenue[] = [];
  for (const row of eventRows) {
    const venue = byId.get(row.venueId);
    if (!venue) continue; // an event with no resolvable venue never reaches the public site
    result.push({ ...eventRowToRecord(row), venue });
  }
  return result;
}

/**
 * All published events with their venue attached. Past-event filtering and
 * Tonight/Weekend filtering both depend on "now", which is deliberately
 * computed client-side (the browser's own clock) rather than baked in here,
 * so correctness never depends on cache/revalidation timing.
 */
export async function getPublishedEventsWithVenue(): Promise<EventWithVenue[]> {
  const rows = await db.select().from(events).where(eq(events.published, true));
  return attachVenue(rows);
}

export async function getEventBySlugWithVenue(slug: string): Promise<EventWithVenue | undefined> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.slug, slug), eq(events.published, true)))
    .limit(1);
  const withVenue = await attachVenue(rows);
  return withVenue[0];
}

/**
 * All `source_event_links` rows for one event (public source-link
 * provenance, 2026-09-07 revision) — a single query scoped to this one
 * event, never per-source (no N+1): the event detail page calls this once
 * alongside getEventBySlugWithVenue and passes the result to
 * getSourceProvenance in src/lib/links.ts, which decides what (if anything)
 * to show publicly. Never called from a cards/list page.
 */
export async function getSourceEventLinksForEvent(
  eventId: string,
): Promise<{ sourceId: string; sourceUrl: string; role: string }[]> {
  return db
    .select({
      sourceId: sourceEventLinks.sourceId,
      sourceUrl: sourceEventLinks.sourceUrl,
      role: sourceEventLinks.role,
    })
    .from(sourceEventLinks)
    .where(eq(sourceEventLinks.eventId, eventId));
}

/**
 * YouTube Artist Preview lookup for the event-detail page (automated Rule A
 * V1, 2026-09-25) — read-only, no network, ever: matching itself only ever
 * runs at ingestion (src/db/writes.ts::createEvent, via
 * src/db/youtubePreview.ts::enrichArtistYoutubePreviews), never here.
 * Returns the first artist in lineup order with an accepted, non-blocked
 * cached match, or null (including a cache miss for a lineup no event has
 * warmed the cache for yet — the next ingestion touching that name is what
 * populates it, never this call).
 */
export interface ArtistYoutubePreview {
  artistName: string;
  videoId: string;
  videoTitle: string | null;
  channelTitle: string | null;
}

/**
 * The single acceptance predicate for "does this cache row count as an
 * available Artist Preview" — accepted, not manually blocked, and a real
 * videoId. No expiresAt/freshness check at read time (matching the existing
 * behavior below, unchanged) — that's deliberate, not an oversight: freshness
 * is already enforced upstream, at match/ingestion time, by
 * getOrMatchArtistYoutubePreview (src/lib/enrichment/youtubePreviewMatching.ts)
 * — an expired entry there triggers a fresh lookup (and, for a previously-
 * accepted match, a cheap videos.list re-verification that can flip it to
 * "abstain") the next time an event touches that artist name. This read path
 * only ever runs at render time and never re-verifies or re-queries YouTube,
 * so it has nothing to check expiresAt against beyond trusting the row as it
 * currently stands — exactly what the event-detail page has always done
 * (confirmed live in Production, Rule A V1). Extracted (event-detail CTA
 * hierarchy + homepage video indicator work, 2026-09-26; freshness-parity
 * reviewed same day) so the homepage's batched availability check below
 * reuses the EXACT same real-world condition the event-detail page itself
 * relies on, rather than re-deriving it and risking the two silently
 * drifting apart — by construction they can never disagree, since both call
 * this one function against the same table.
 */
function isAcceptedPreviewRow<
  T extends Pick<typeof artistYoutubePreviewCache.$inferSelect, "status" | "manualBlock" | "videoId">,
>(row: T | undefined): row is T & { videoId: string } {
  return Boolean(row && row.status === "accepted" && !row.manualBlock && row.videoId);
}

export async function getArtistYoutubePreviewForLineup(artistNames: string[]): Promise<ArtistYoutubePreview | null> {
  if (artistNames.length === 0) return null;
  const normalizedToRaw = new Map(artistNames.map((name) => [normalizeArtistName(cleanArtistDisplayName(name)), name]));
  const normalizedNames = [...normalizedToRaw.keys()];

  let rows: (typeof artistYoutubePreviewCache.$inferSelect)[];
  try {
    rows = await db
      .select()
      .from(artistYoutubePreviewCache)
      .where(inArray(artistYoutubePreviewCache.artistNameNormalized, normalizedNames));
  } catch (err) {
    // Deploy-ordering safety (2026-09-25 review): this is optional
    // enrichment, exactly like the write side (enrichArtistYoutubePreviews
    // never throws either) — a query failure here (most notably
    // artist_youtube_preview_cache not existing yet, if application code
    // ever ships before its migration runs) must degrade to "no preview"
    // rather than fail the entire event page. Every other DB-touching
    // function in this file assumes its tables already exist, which is a
    // safe assumption for them; it is deliberately NOT assumed here.
    console.error(`[youtube-preview] lineup lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const byNormalized = new Map(rows.map((r) => [r.artistNameNormalized, r]));

  for (const normalized of normalizedNames) {
    const row = byNormalized.get(normalized);
    if (!isAcceptedPreviewRow(row)) continue;
    return {
      artistName: normalizedToRaw.get(normalized) ?? normalized,
      videoId: row.videoId,
      videoTitle: row.videoTitle,
      channelTitle: row.channelTitle,
    };
  }
  return null;
}

/**
 * Batched "would event detail render an Artist Preview for this lineup"
 * check for the homepage/event-list VIDEO indicator (2026-09-26) — ONE query
 * covering every event's combined lineup, never per-event, so the homepage
 * never issues N+1 cache lookups. Reuses isAcceptedPreviewRow, the exact same
 * acceptance predicate getArtistYoutubePreviewForLineup uses, so the
 * indicator can never show (or hide) for an event where the detail page
 * itself would disagree. Returns one boolean per input lineup, same order.
 * Degrades to all-false on a query failure, matching
 * getArtistYoutubePreviewForLineup's own deploy-safety behavior — this is
 * optional presentation, never worth failing the homepage render over.
 */
export async function getArtistPreviewAvailabilityForLineups(lineups: string[][]): Promise<boolean[]> {
  const allNormalized = new Set<string>();
  for (const artists of lineups) {
    for (const name of artists) {
      allNormalized.add(normalizeArtistName(cleanArtistDisplayName(name)));
    }
  }
  if (allNormalized.size === 0) return lineups.map(() => false);

  let rows: (typeof artistYoutubePreviewCache.$inferSelect)[];
  try {
    rows = await db
      .select()
      .from(artistYoutubePreviewCache)
      .where(inArray(artistYoutubePreviewCache.artistNameNormalized, [...allNormalized]));
  } catch (err) {
    console.error(`[youtube-preview] batched availability lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return lineups.map(() => false);
  }
  const byNormalized = new Map(rows.map((r) => [r.artistNameNormalized, r]));

  return lineups.map((artists) =>
    artists.some((name) => isAcceptedPreviewRow(byNormalized.get(normalizeArtistName(cleanArtistDisplayName(name))))),
  );
}

export async function getEventsForVenue(venueId: string): Promise<EventWithVenue[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.venueId, venueId), eq(events.published, true)));
  return attachVenue(rows);
}

/** Includes unpublished/hidden events — used by the admin tools, never by public pages. */
export async function getEventByIdAdmin(id: string): Promise<EventRecord | undefined> {
  const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return row ? eventRowToRecord(row) : undefined;
}

export async function getAllEventsAdmin(): Promise<EventWithVenue[]> {
  const rows = await db.select().from(events).orderBy(desc(events.startDatetime));
  return attachVenue(rows);
}
