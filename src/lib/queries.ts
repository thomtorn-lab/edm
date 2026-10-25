import { and, desc, eq, gte, inArray, ne, notExists, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  artistYoutubePreviewCache,
  discoveryQueue,
  eventChangeLog,
  eventSoundcloudLinks,
  eventYoutubePreviewOverrides,
  events,
  soundcloudLinkBlocks,
  sourceEventLinks,
  sources,
  venues,
} from "@/db/schema";
import {
  discoveryRowToRecord,
  eventRowToRecord,
  sourceRowToRecord,
  venueRowToRecord,
} from "@/db/mappers";
import { cleanArtistDisplayName, normalizeArtistName } from "./enrichment/genreEnrichment";
import { selectLineupSoundcloudLinks } from "./soundcloudLinks";
import { classifyAboutText, isWithheldSourceDescription, type AboutKind } from "./aboutContent";
import { resolveEventOverride, type EventOverrideRow } from "./eventYoutubeOverride";
import type { DiscoveryQueueItem, DiscoveryQueueStatus, EventRecord, Source, Venue } from "./types";
import type { EventChangeEntry } from "./dataQuality";

export interface EventWithVenue extends EventRecord {
  venue: Venue;
  /**
   * Set by the public queries (withAboutKind): whether the About
   * text is about the event or only practical venue information — see
   * src/lib/aboutContent.ts. Classified from the ORIGINAL stored text.
   */
  aboutKind?: AboutKind | null;
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
  // Only the venues these events actually reference (Supabase egress work,
  // 2026-10-12): this used to read the whole venues table on every call, so
  // a single event page, its calendar.ics download, and each per-venue
  // getEventsForVenue call all shipped every venue row (long descriptions,
  // profiles, rooms JSON) to look up one or a handful by id. The lookup below
  // is by id only, so fetching just the referenced ids gives the same result.
  const venueIds = [...new Set(eventRows.map((row) => row.venueId))];
  const venueRows = await db.select().from(venues).where(inArray(venues.id, venueIds));
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
 * About-text presentation for the public queries (About-text formatting,
 * 2026-10-25): marks each event's description as about the event or only
 * practical venue information, and drops a description that is nothing but
 * bare labels with no value ("Praktisk info:.", "Entré") — see
 * src/lib/aboutContent.ts. Also keeps hiding a Poolen/Pumpehuset Danish
 * description, which those sources' import guard used to drop before it was
 * stored (isWithheldSourceDescription) — so the public site shows exactly
 * what it did. Pure and deterministic: the stored description is never
 * changed, and any other description is passed through as is, in whatever
 * language the source wrote it. Admin queries never call this.
 */
function withAboutKind(list: EventWithVenue[]): EventWithVenue[] {
  return list.map((e) => {
    if (isWithheldSourceDescription(e)) return { ...e, description: null, aboutKind: null };
    const aboutKind = classifyAboutText(e.description);
    return aboutKind === "empty" ? { ...e, description: null, aboutKind: null } : { ...e, aboutKind };
  });
}

/**
 * All published events with their venue attached. Past-event filtering and
 * Tonight/Weekend filtering both depend on "now", which is deliberately
 * computed client-side (the browser's own clock) rather than baked in here,
 * so correctness never depends on cache/revalidation timing.
 */
export async function getPublishedEventsWithVenue(): Promise<EventWithVenue[]> {
  const rows = await db.select().from(events).where(eq(events.published, true));
  return withAboutKind(await attachVenue(rows));
}

export async function getEventBySlugWithVenue(slug: string): Promise<EventWithVenue | undefined> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.slug, slug), eq(events.published, true)))
    .limit(1);
  const withVenue = withAboutKind(await attachVenue(rows));
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

/**
 * Column projections for the two render-time cache reads below (Supabase
 * egress work, 2026-10-12). Neither read ever uses `evidence` (the full
 * YouTube search record kept for audits and re-verification, by far the
 * largest column), `query`, the channel id or the timestamps, so they are
 * never fetched here. The write/match path (src/db/youtubePreview.ts) and
 * the diagnostics keep reading whole rows.
 */
const previewAvailabilityColumns = {
  artistNameNormalized: artistYoutubePreviewCache.artistNameNormalized,
  status: artistYoutubePreviewCache.status,
  manualBlock: artistYoutubePreviewCache.manualBlock,
  videoId: artistYoutubePreviewCache.videoId,
};
const previewDetailColumns = {
  ...previewAvailabilityColumns,
  videoTitle: artistYoutubePreviewCache.videoTitle,
  channelTitle: artistYoutubePreviewCache.channelTitle,
};

export async function getArtistYoutubePreviewForLineup(artistNames: string[]): Promise<ArtistYoutubePreview | null> {
  if (artistNames.length === 0) return null;
  const normalizedToRaw = new Map(artistNames.map((name) => [normalizeArtistName(cleanArtistDisplayName(name)), name]));
  const normalizedNames = [...normalizedToRaw.keys()];

  let rows: Pick<typeof artistYoutubePreviewCache.$inferSelect, keyof typeof previewDetailColumns>[];
  try {
    rows = await db
      .select(previewDetailColumns)
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

  let rows: Pick<typeof artistYoutubePreviewCache.$inferSelect, keyof typeof previewAvailabilityColumns>[];
  try {
    rows = await db
      .select(previewAvailabilityColumns)
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

/**
 * Admin per-event video overrides (2026-10-23, event_youtube_preview_overrides
 * — rules in src/lib/eventYoutubeOverride.ts). Reads only the columns the
 * display rule needs. A failed read returns null, NOT an empty map: callers
 * then show no video at all (fail closed) rather than treating "couldn't read"
 * as "no override" and letting the automated match replace a video an admin
 * deliberately chose or hid. The page itself still renders, like the
 * artist-cache reads above. (Production applies migration 0023 before build,
 * so a missing table only happens on a database without it, e.g. Preview.)
 */
async function readEventOverrides(eventIds: string[]): Promise<Map<string, EventOverrideRow> | null> {
  if (eventIds.length === 0) return new Map();
  try {
    const rows = await db
      .select({
        eventId: eventYoutubePreviewOverrides.eventId,
        mode: eventYoutubePreviewOverrides.mode,
        videoId: eventYoutubePreviewOverrides.videoId,
        videoTitle: eventYoutubePreviewOverrides.videoTitle,
        channelTitle: eventYoutubePreviewOverrides.channelTitle,
        artistName: eventYoutubePreviewOverrides.artistName,
        available: eventYoutubePreviewOverrides.available,
      })
      .from(eventYoutubePreviewOverrides)
      .where(inArray(eventYoutubePreviewOverrides.eventId, eventIds));
    return new Map(rows.map((r) => [r.eventId, r]));
  } catch (err) {
    console.error(`[youtube-preview] event override lookup failed (showing no video): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * The event page's video: the event's own override when it has one (a chosen
 * video, or deliberately none — hidden, or the chosen video is unavailable),
 * otherwise the automated lineup match (getArtistYoutubePreviewForLineup,
 * unchanged). The artist cache is not even read when an override decides, or
 * when the override read failed (no video then — see readEventOverrides).
 */
export async function getEventYoutubePreview(event: { id: string; artists: string[] }): Promise<ArtistYoutubePreview | null> {
  const overrides = await readEventOverrides([event.id]);
  if (!overrides) return null;
  const decision = resolveEventOverride(overrides.get(event.id));
  if (decision.kind === "none") return null;
  if (decision.kind === "video") {
    return {
      artistName: decision.artistName ?? event.artists[0] ?? "Artist",
      videoId: decision.videoId,
      videoTitle: decision.videoTitle,
      channelTitle: decision.channelTitle,
    };
  }
  return getArtistYoutubePreviewForLineup(event.artists);
}

/**
 * Batched VIDEO-indicator availability per event — the same rule as
 * getEventYoutubePreview: an override decides on its own; only events without
 * one fall through to getArtistPreviewAvailabilityForLineups (unchanged, one
 * query). Two queries total for the whole list, never per event. A failed
 * override read means no indicator anywhere, matching the event page.
 */
export async function getPreviewAvailabilityForEvents(list: { id: string; artists: string[] }[]): Promise<boolean[]> {
  const overrides = await readEventOverrides(list.map((e) => e.id));
  if (!overrides) return list.map(() => false);
  const decisions = list.map((e) => resolveEventOverride(overrides.get(e.id)));
  const autoIndexes = decisions.flatMap((d, i) => (d.kind === "auto" ? [i] : []));
  const auto = await getArtistPreviewAvailabilityForLineups(autoIndexes.map((i) => list[i].artists));
  const result = decisions.map((d) => d.kind === "video");
  autoIndexes.forEach((listIndex, j) => {
    result[listIndex] = auto[j];
  });
  return result;
}

/** Excludes link rows whose profile URL is manually blocked (soundcloud_link_blocks). */
function soundcloudLinkNotBlocked() {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(soundcloudLinkBlocks)
      .where(eq(soundcloudLinkBlocks.url, eventSoundcloudLinks.url)),
  );
}

/**
 * Venue-provided artist SoundCloud links for the event-detail page
 * (2026-10-13): this event's stored rows, unblocked, limited to its own
 * current lineup (exact names, lineup order). One narrow query; none at all
 * for an event without a lineup. Like the YouTube preview read, a failure
 * degrades to "no links", never a broken page.
 */
export async function getSoundcloudLinksForLineup(eventId: string, artists: string[]): Promise<{ name: string; url: string }[]> {
  if (artists.length === 0) return [];
  try {
    const rows = await db
      .select({ artistName: eventSoundcloudLinks.artistName, url: eventSoundcloudLinks.url })
      .from(eventSoundcloudLinks)
      .where(and(eq(eventSoundcloudLinks.eventId, eventId), soundcloudLinkNotBlocked()));
    return selectLineupSoundcloudLinks(artists, rows);
  } catch (err) {
    console.error(`[soundcloud-links] lookup failed for ${eventId}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * AUDIO indicator for event lists (homepage, venue and genre pages): ONE
 * batched query for every listed event, true exactly when that event's
 * detail page would show at least one link (same rows, same lineup rule as
 * getSoundcloudLinksForLineup). Reads only event_id and artist_name.
 */
export async function getSoundcloudAvailabilityForEvents(list: { id: string; artists: string[] }[]): Promise<boolean[]> {
  const ids = list.filter((e) => e.artists.length > 0).map((e) => e.id);
  if (ids.length === 0) return list.map(() => false);
  let rows: { eventId: string; artistName: string }[];
  try {
    rows = await db
      .select({ eventId: eventSoundcloudLinks.eventId, artistName: eventSoundcloudLinks.artistName })
      .from(eventSoundcloudLinks)
      .where(and(inArray(eventSoundcloudLinks.eventId, ids), soundcloudLinkNotBlocked()));
  } catch (err) {
    console.error(`[soundcloud-links] batched availability lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return list.map(() => false);
  }
  const namesByEvent = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!namesByEvent.has(r.eventId)) namesByEvent.set(r.eventId, new Set());
    namesByEvent.get(r.eventId)!.add(r.artistName);
  }
  return list.map((e) => e.artists.some((name) => namesByEvent.get(e.id)?.has(name) ?? false));
}

export async function getEventsForVenue(venueId: string): Promise<EventWithVenue[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.venueId, venueId), eq(events.published, true)));
  return withAboutKind(await attachVenue(rows));
}

/** Includes unpublished/hidden events — used by the admin tools, never by public pages. */
export async function getEventByIdAdmin(id: string): Promise<EventRecord | undefined> {
  const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return row ? eventRowToRecord(row) : undefined;
}

/**
 * Sync-driven changes to an event's date, venue or official URL in the last
 * `days` days — the only event_change_log rows the admin data-quality
 * warnings read (see src/lib/dataQuality.ts). Read-only; narrow columns.
 */
export async function getRecentSyncIdentityChanges(days = 14): Promise<EventChangeEntry[]> {
  const since = new Date(Date.now() - days * 24 * 3_600_000);
  const rows = await db
    .select({
      eventId: eventChangeLog.eventId,
      changedBy: eventChangeLog.changedBy,
      changeType: eventChangeLog.changeType,
      fieldsChanged: eventChangeLog.fieldsChanged,
      createdAt: eventChangeLog.createdAt,
    })
    .from(eventChangeLog)
    .where(
      and(
        gte(eventChangeLog.createdAt, since),
        ne(eventChangeLog.changedBy, "admin"),
        sql`${eventChangeLog.fieldsChanged} && ARRAY['startDatetime', 'venueId', 'officialEventUrl']::text[]`,
      ),
    );
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function getAllEventsAdmin(): Promise<EventWithVenue[]> {
  const rows = await db.select().from(events).orderBy(desc(events.startDatetime));
  return attachVenue(rows);
}
