import { cache } from "react";
import { and, desc, eq, gt, gte, inArray, isNull, ne, notExists, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import {
  artistGenreCache,
  artistYoutubePreviewCache,
  artists as artistIdentities,
  discoveryQueue,
  eventArtists,
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
import { matchStoredLinksByIdentityKey, selectLineupSoundcloudLinks, selectReusedSoundcloudProfiles } from "./soundcloudLinks";
import { discogsCacheKey, verifiedDiscogsProfile } from "./soundcloudEvidence/discogsSoundcloud";
import { classifyAboutText, type AboutKind } from "./aboutContent";
import { isPastEvent } from "./datetime";
import { resolveEventOverride, type EventOverrideRow } from "./eventYoutubeOverride";
import type { DiscoveryQueueItem, DiscoveryQueueStatus, EventRecord, Source, Venue } from "./types";
import type { GenreSlug } from "./taxonomy";
import type { EventRowFields, EventRowVenue } from "./homepageEvents";
import type { EventChangeEntry } from "./dataQuality";
import { latestWithheldByEvent, WITHHELD_DESCRIPTION_CHANGE_TYPE } from "./withheldDescriptions";

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

/**
 * Memoized per server request with React `cache` (Supabase egress work,
 * 2026-11-01): /venues/[slug] calls this from both generateMetadata and the
 * page, which used to send the same query twice per view. Outside a React
 * server request (scripts, route handlers, tests) `cache` simply calls
 * through, so every other caller behaves exactly as before.
 */
export const getVenueBySlug = cache(async (slug: string): Promise<Venue | undefined> => {
  const [row] = await db.select().from(venues).where(eq(venues.slug, slug)).limit(1);
  return row ? venueRowToRecord(row) : undefined;
});

/**
 * Only the venues /venues actually lists (its curated slugs), instead of the
 * whole venues table (Supabase egress work, 2026-11-01). Full rows: the page
 * shows each venue's address and descriptions.
 */
export async function getVenuesBySlugs(slugs: readonly string[]): Promise<Venue[]> {
  if (slugs.length === 0) return [];
  const rows = await db.select().from(venues).where(inArray(venues.slug, [...slugs])).orderBy(venues.name);
  return rows.map(venueRowToRecord);
}

/**
 * The two columns the sitemap needs per venue, in the same order getVenues
 * returns them (Supabase egress work, 2026-11-01).
 */
export async function getVenueSitemapEntries(): Promise<{ id: string; slug: string }[]> {
  return db.select({ id: venues.id, slug: venues.slug }).from(venues).orderBy(venues.name);
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
 * src/lib/aboutContent.ts. Pure and deterministic: the stored description
 * is never changed, and every other description is passed through as is, in
 * whatever language the source wrote it. Admin queries never call this.
 */
function withAboutKind(list: EventWithVenue[]): EventWithVenue[] {
  return list.map((e) => {
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

/**
 * The sitemap's per-event fields (Supabase egress work, 2026-11-01): slug and
 * updatedAt for every published event, instead of whole event rows plus
 * their venues. The inner join keeps the exact set getPublishedEventsWithVenue
 * returned — an event whose venue can't be resolved never reached the sitemap
 * (attachVenue skips it) and still doesn't. updatedAt is ISO, as in
 * eventRowToRecord.
 */
export async function getPublishedEventSitemapEntries(): Promise<{ slug: string; updatedAt: string }[]> {
  const rows = await db
    .select({ slug: events.slug, updatedAt: events.updatedAt })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(eq(events.published, true));
  return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
}

/**
 * How far back the SQL pre-filter for "not yet over" looks (Supabase egress
 * work, 2026-11-01). It only has to be a SUPERSET of what isPastEvent
 * (src/lib/datetime.ts) keeps, because every caller still applies
 * isPastEvent itself afterwards:
 * - an event with a trustworthy end (end > start) is over exactly when
 *   end <= now, so `end_datetime > now` keeps every such event still running;
 * - an event without one ends at 06:00 Copenhagen time after its nightlife
 *   day, at most ~25 hours after its start (DST included), so any event that
 *   started within the last 3 days is kept.
 * An event is therefore only left out when it is already past by isPastEvent.
 * Covered by queries.upcomingPrefilter.test.ts.
 */
export const UPCOMING_PREFILTER_LOOKBACK_MS = 3 * 24 * 3_600_000;

export function upcomingCandidateCondition(now: Date): SQL {
  return or(
    gte(events.startDatetime, new Date(now.getTime() - UPCOMING_PREFILTER_LOOKBACK_MS)),
    gt(events.endDatetime, now),
  )!;
}

/**
 * What the public event lists (homepage, genre pages, venue pages) render
 * per event: the EventRow fields plus primaryGenre, with the five venue
 * fields EventRow shows.
 */
export type ListEvent = EventRowFields & { primaryGenre: GenreSlug; venue: EventRowVenue };

const listEventColumns = {
  id: events.id,
  slug: events.slug,
  title: events.title,
  description: events.description,
  artists: events.artists,
  startDatetime: events.startDatetime,
  endDatetime: events.endDatetime,
  venueId: events.venueId,
  subVenue: events.subVenue,
  primaryGenre: events.primaryGenre,
  subgenres: events.subgenres,
  officialEventUrl: events.officialEventUrl,
  ticketUrl: events.ticketUrl,
  facebookUrl: events.facebookUrl,
  residentAdvisorUrl: events.residentAdvisorUrl,
  otherSourceUrls: events.otherSourceUrls,
  canonicalSourceId: events.canonicalSourceId,
  overriddenFields: events.overriddenFields,
  priceFrom: events.priceFrom,
  soldOut: events.soldOut,
  postponed: events.postponed,
  dateChanged: events.dateChanged,
};

const listVenueColumns = {
  id: venues.id,
  slug: venues.slug,
  name: venues.name,
  address: venues.address,
  aliases: venues.aliases,
};

/**
 * Published events that are not over yet, for the public event lists
 * (Supabase egress work, 2026-11-01). Replaces getPublishedEventsWithVenue
 * on the homepage, the genre pages and the venue pages, which read every
 * published event ever (past ones included) with every column, plus every
 * referenced venue's full row, and then dropped the past events in code.
 *
 * Same result for the page: the SQL pre-filter is a superset of
 * isPastEvent (see UPCOMING_PREFILTER_LOOKBACK_MS) and callers keep applying
 * isPastEvent themselves; values are converted exactly as eventRowToRecord
 * does; an event without a resolvable venue is skipped, as in attachVenue;
 * and the description gets the same About-text treatment as withAboutKind
 * (a labels-only text becomes null). `venueIds` narrows it to those venues.
 */
export async function getUpcomingPublishedEventsForList(now: Date, venueIds?: readonly string[]): Promise<ListEvent[]> {
  if (venueIds && venueIds.length === 0) return [];
  const conditions = [eq(events.published, true), upcomingCandidateCondition(now)];
  if (venueIds) conditions.push(inArray(events.venueId, [...venueIds]));
  const rows = await db.select(listEventColumns).from(events).where(and(...conditions));
  if (rows.length === 0) return [];

  const referencedVenueIds = [...new Set(rows.map((row) => row.venueId))];
  const venueRows = await db.select(listVenueColumns).from(venues).where(inArray(venues.id, referencedVenueIds));
  const venueById = new Map(venueRows.map((v) => [v.id, v]));

  const result: ListEvent[] = [];
  for (const row of rows) {
    const venue = venueById.get(row.venueId);
    if (!venue) continue; // an event with no resolvable venue never reaches the public site
    result.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: classifyAboutText(row.description) === "empty" ? null : row.description,
      artists: row.artists,
      startDatetime: row.startDatetime.toISOString(),
      endDatetime: row.endDatetime?.toISOString() ?? null,
      subVenue: row.subVenue,
      primaryGenre: row.primaryGenre as GenreSlug,
      subgenres: row.subgenres as GenreSlug[],
      officialEventUrl: row.officialEventUrl,
      ticketUrl: row.ticketUrl,
      facebookUrl: row.facebookUrl,
      residentAdvisorUrl: row.residentAdvisorUrl,
      otherSourceUrls: row.otherSourceUrls,
      canonicalSourceId: row.canonicalSourceId,
      overriddenFields: row.overriddenFields,
      priceFrom: row.priceFrom,
      soldOut: row.soldOut,
      postponed: row.postponed,
      dateChanged: row.dateChanged,
      venue: { id: venue.id, slug: venue.slug, name: venue.name, address: venue.address, aliases: venue.aliases },
    });
  }
  return result;
}

/**
 * Upcoming published events per venue, for the /venues overview's counts
 * (Supabase egress work, 2026-11-01). One query reading three columns,
 * instead of one full getEventsForVenue read (events + venue rows) per
 * listed venue and group member. Counted with the exact isPastEvent rule
 * the page used before; the SQL pre-filter only drops events that rule
 * already treats as past (see UPCOMING_PREFILTER_LOOKBACK_MS). Venues with
 * no upcoming events are absent from the map.
 */
export async function getUpcomingEventCountsByVenue(venueIds: readonly string[], now: Date): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (venueIds.length === 0) return counts;
  const rows = await db
    .select({ venueId: events.venueId, startDatetime: events.startDatetime, endDatetime: events.endDatetime })
    .from(events)
    .where(and(eq(events.published, true), inArray(events.venueId, [...venueIds]), upcomingCandidateCondition(now)));
  for (const row of rows) {
    const timing = { startDatetime: row.startDatetime.toISOString(), endDatetime: row.endDatetime?.toISOString() ?? null };
    if (isPastEvent(timing, now)) continue;
    counts.set(row.venueId, (counts.get(row.venueId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Memoized per server request with React `cache` (Supabase egress work,
 * 2026-11-01): /events/[slug] calls this from both generateMetadata and the
 * page, which used to send the event query and its venue query twice per
 * view. Outside a React server request (calendar.ics, scripts, tests)
 * `cache` simply calls through, so those callers behave exactly as before.
 */
export const getEventBySlugWithVenue = cache(async (slug: string): Promise<EventWithVenue | undefined> => {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.slug, slug), eq(events.published, true)))
    .limit(1);
  const withVenue = withAboutKind(await attachVenue(rows));
  return withVenue[0];
});

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
 * What the event page embeds. artistName is null for an admin-chosen video
 * recorded without one (every video chosen in the admin UI): the page then
 * names the player after the event, not after a lineup name the video may
 * have nothing to do with.
 */
export type EventYoutubePreview = Omit<ArtistYoutubePreview, "artistName"> & { artistName: string | null };

/**
 * The event page's video: the event's own override when it has one (a chosen
 * video, or deliberately none — hidden, or the chosen video is unavailable),
 * otherwise the automated lineup match (getArtistYoutubePreviewForLineup,
 * unchanged). The artist cache is not even read when an override decides, or
 * when the override read failed (no video then — see readEventOverrides).
 */
export async function getEventYoutubePreview(event: { id: string; artists: string[] }): Promise<EventYoutubePreview | null> {
  const overrides = await readEventOverrides([event.id]);
  if (!overrides) return null;
  const decision = resolveEventOverride(overrides.get(event.id));
  if (decision.kind === "none") return null;
  if (decision.kind === "video") {
    return {
      // Only the name the video was actually chosen for — never a guess from the lineup (2026-10-24).
      artistName: decision.artistName,
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

/** Appearances Artist Alerts resolved to one artist with enough confidence to show that artist's profile. */
const SHOWN_CONFIDENCE = ["high", "confirmed"];

/**
 * Profiles reused across events through Artist Alerts' identities
 * (2026-11-03): for the given events' resolved appearances (high/confirmed),
 * every unblocked stored venue link of the same artist, found two ways:
 *   - through the artist's other resolved appearances (same artist id);
 *   - by identity key on any event, past ones included (2026-11-06): venue
 *     links stored before Artist Alerts began reconciling (it only covers
 *     upcoming events) have no appearance row. Only for an artist whose key
 *     no other active artist shares, so the key names exactly one identity.
 *   - from Discogs (2026-11-07): the profile the Discogs integration's cache
 *     verified for the same unique key (src/lib/soundcloudEvidence/discogsSoundcloud.ts).
 * selectReusedSoundcloudProfiles then decides: exactly one profile per
 * artist across all of these, single-performer entries only.
 */
async function reusedSoundcloudRows(eventIds: string[]) {
  const here = alias(eventArtists, "here");
  const other = alias(eventArtists, "other");
  const viaAppearances = await db
    .select({ eventId: here.eventId, lineupEntry: here.lineupEntry, otherEntry: other.lineupEntry, url: eventSoundcloudLinks.url })
    .from(here)
    .innerJoin(artistIdentities, and(eq(artistIdentities.id, here.artistId), isNull(artistIdentities.mergedIntoId), ne(artistIdentities.status, "rejected")))
    .innerJoin(other, and(eq(other.artistId, here.artistId), inArray(other.confidence, SHOWN_CONFIDENCE), isNull(other.removedAt)))
    .innerJoin(eventSoundcloudLinks, and(eq(eventSoundcloudLinks.eventId, other.eventId), eq(eventSoundcloudLinks.artistName, other.lineupEntry)))
    .where(and(inArray(here.eventId, eventIds), inArray(here.confidence, SHOWN_CONFIDENCE), isNull(here.removedAt), soundcloudLinkNotBlocked()));

  const sameKey = alias(artistIdentities, "same_key");
  const unique = await db
    .select({ eventId: here.eventId, lineupEntry: here.lineupEntry, nameKey: here.nameKey })
    .from(here)
    .innerJoin(artistIdentities, and(eq(artistIdentities.id, here.artistId), isNull(artistIdentities.mergedIntoId), ne(artistIdentities.status, "rejected")))
    .where(
      and(
        inArray(here.eventId, eventIds),
        inArray(here.confidence, SHOWN_CONFIDENCE),
        isNull(here.removedAt),
        notExists(
          db
            .select({ one: sql`1` })
            .from(sameKey)
            .where(and(eq(sameKey.nameKey, here.nameKey), ne(sameKey.id, artistIdentities.id), isNull(sameKey.mergedIntoId), ne(sameKey.status, "rejected"))),
        ),
      ),
    );
  if (unique.length === 0) return viaAppearances;

  // Narrowed in SQL by case-insensitive name, then matched exactly on the identity key.
  const lowered = [...new Set(unique.map((u) => u.lineupEntry.toLowerCase()))];
  const historical = await db
    .select({ artistName: eventSoundcloudLinks.artistName, url: eventSoundcloudLinks.url })
    .from(eventSoundcloudLinks)
    .where(and(inArray(sql`lower(${eventSoundcloudLinks.artistName})`, lowered), soundcloudLinkNotBlocked()));

  // Discogs-verified profiles (2026-11-07) for the same unique appearances,
  // from the Discogs integration's own cache; blocked URLs excluded.
  const cacheKeyOf = new Map(unique.map((u) => [u.lineupEntry, discogsCacheKey(u.lineupEntry)]));
  const discogsRows = await db
    .select({ key: artistGenreCache.artistNameNormalized, lookupStatus: artistGenreCache.lookupStatus, identityConfidence: artistGenreCache.identityConfidence, evidence: artistGenreCache.evidence })
    .from(artistGenreCache)
    .where(and(inArray(artistGenreCache.artistNameNormalized, [...new Set(cacheKeyOf.values())]), eq(artistGenreCache.lookupStatus, "found"), eq(artistGenreCache.identityConfidence, "medium")));
  const discogsProfileByKey = new Map(discogsRows.flatMap((r) => {
    const url = verifiedDiscogsProfile(r);
    return url ? [[r.key, url] as const] : [];
  }));
  const blockedDiscogs =
    discogsProfileByKey.size === 0
      ? new Set<string>()
      : new Set((await db.select({ url: soundcloudLinkBlocks.url }).from(soundcloudLinkBlocks).where(inArray(soundcloudLinkBlocks.url, [...discogsProfileByKey.values()]))).map((b) => b.url));
  const viaDiscogs = unique.flatMap((u) => {
    const url = discogsProfileByKey.get(cacheKeyOf.get(u.lineupEntry)!);
    return url && !blockedDiscogs.has(url) ? [{ eventId: u.eventId, lineupEntry: u.lineupEntry, otherEntry: u.lineupEntry, url }] : [];
  });

  return [...viaAppearances, ...matchStoredLinksByIdentityKey(unique, historical), ...viaDiscogs];
}

/**
 * Artist SoundCloud links for the event-detail page: the venue-provided
 * links stored for this event (2026-10-13), plus, for lineup names without
 * one, the single verified profile Artist Alerts' identity model ties to the
 * same artist on other events (2026-11-03). Unblocked, limited to the
 * event's own current lineup (exact names, lineup order); the event's own
 * link always wins. The reuse query only runs when a name lacks its own
 * link. Like the YouTube preview read, a failure degrades to fewer or no
 * links, never a broken page.
 */
export async function getSoundcloudLinksForLineup(eventId: string, artists: string[]): Promise<{ name: string; url: string }[]> {
  if (artists.length === 0) return [];
  let own: { artistName: string; url: string }[];
  try {
    own = await db
      .select({ artistName: eventSoundcloudLinks.artistName, url: eventSoundcloudLinks.url })
      .from(eventSoundcloudLinks)
      .where(and(eq(eventSoundcloudLinks.eventId, eventId), soundcloudLinkNotBlocked()));
  } catch (err) {
    console.error(`[soundcloud-links] lookup failed for ${eventId}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
  const ownNames = new Set(own.map((r) => r.artistName));
  if (artists.every((name) => ownNames.has(name))) return selectLineupSoundcloudLinks(artists, own);
  let reused: { artistName: string; url: string }[] = [];
  try {
    reused = selectReusedSoundcloudProfiles(await reusedSoundcloudRows([eventId]));
  } catch (err) {
    console.error(`[soundcloud-links] reuse lookup failed for ${eventId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Own rows last: selectLineupSoundcloudLinks keeps the last URL per name.
  return selectLineupSoundcloudLinks(artists, [...reused, ...own]);
}

/**
 * AUDIO indicator for event lists (homepage, venue and genre pages): one
 * batched query for every listed event's own links plus one batched reuse
 * query, true exactly when that event's detail page would show at least one
 * link (same rows, same rules as getSoundcloudLinksForLineup).
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
  const add = (eventId: string, name: string) => {
    if (!namesByEvent.has(eventId)) namesByEvent.set(eventId, new Set());
    namesByEvent.get(eventId)!.add(name);
  };
  for (const r of rows) add(r.eventId, r.artistName);
  const has = (e: { id: string; artists: string[] }) => e.artists.some((name) => namesByEvent.get(e.id)?.has(name) ?? false);
  const missing = list.filter((e) => e.artists.length > 0 && !has(e)).map((e) => e.id);
  if (missing.length > 0) {
    try {
      const reuseRows = await reusedSoundcloudRows(missing);
      const byEvent = new Map<string, typeof reuseRows>();
      for (const r of reuseRows) {
        if (!byEvent.has(r.eventId)) byEvent.set(r.eventId, []);
        byEvent.get(r.eventId)!.push(r);
      }
      for (const [eventId, eventRows] of byEvent) for (const r of selectReusedSoundcloudProfiles(eventRows)) add(eventId, r.artistName);
    } catch (err) {
      console.error(`[soundcloud-links] batched reuse lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return list.map(has);
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

/**
 * Admin only: each event's latest withheld source description (a Danish
 * Poolen/Pumpehuset text the public site does not show) — see
 * src/lib/withheldDescriptions.ts. Never used by a public page.
 */
export async function getWithheldDescriptionsAdmin(): Promise<Record<string, string>> {
  const rows = await db
    .select({ eventId: eventChangeLog.eventId, note: eventChangeLog.note })
    .from(eventChangeLog)
    .where(eq(eventChangeLog.changeType, WITHHELD_DESCRIPTION_CHANGE_TYPE))
    .orderBy(desc(eventChangeLog.createdAt));
  return latestWithheldByEvent(rows);
}

export async function getAllEventsAdmin(): Promise<EventWithVenue[]> {
  const rows = await db.select().from(events).orderBy(desc(events.startDatetime));
  return attachVenue(rows);
}
