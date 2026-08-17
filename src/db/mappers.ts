import type {
  ConfidenceLevel,
  DiscoveryQueueItem,
  DiscoveryQueueStatus,
  EventRecord,
  Source,
  SourceRole,
  SourceType,
  Venue,
} from "../lib/types";
import type { GenreSlug } from "../lib/taxonomy";
import type { events, venues, sources, discoveryQueue } from "./schema";

type EventRow = typeof events.$inferSelect;
type VenueRow = typeof venues.$inferSelect;
type SourceRow = typeof sources.$inferSelect;
type DiscoveryQueueRow = typeof discoveryQueue.$inferSelect;

/** DB rows use real Date objects and SQL-friendly nulls; the app layer (and its existing
 * tests/components) expects ISO strings, matching the shapes defined before the DB existed. */

export function venueRowToRecord(row: VenueRow): Venue {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    aliases: row.aliases,
    address: row.address,
    city: row.city as Venue["city"],
    postalCode: row.postalCode,
    websiteUrl: row.websiteUrl,
    description: row.description,
  };
}

export function sourceRowToRecord(row: SourceRow): Source {
  return {
    id: row.id,
    sourceName: row.sourceName,
    sourceType: row.sourceType as SourceType,
    baseUrl: row.baseUrl,
    roles: row.roles as SourceRole[],
    adapter: row.adapter,
    trustLevel: row.trustLevel as ConfidenceLevel,
    autoPublish: row.autoPublish,
    syncFrequency: row.syncFrequency,
    active: row.active,
    lastSuccessfulSync: row.lastSuccessfulSync?.toISOString() ?? null,
    lastAttemptedSync: row.lastAttemptedSync?.toISOString() ?? null,
    lastError: row.lastError,
    eventsFound: row.eventsFound,
    eventsUpdated: row.eventsUpdated,
    integrationNote: row.integrationNote,
  };
}

export function eventRowToRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    artists: row.artists,
    startDatetime: row.startDatetime.toISOString(),
    endDatetime: row.endDatetime?.toISOString() ?? null,
    timezone: "Europe/Copenhagen",
    venueId: row.venueId,
    primaryGenre: row.primaryGenre as GenreSlug,
    subgenres: row.subgenres as GenreSlug[],
    genreConfidence: row.genreConfidence as ConfidenceLevel,
    officialEventUrl: row.officialEventUrl,
    ticketUrl: row.ticketUrl,
    facebookUrl: row.facebookUrl,
    residentAdvisorUrl: row.residentAdvisorUrl,
    otherSourceUrls: row.otherSourceUrls,
    imageUrl: row.imageUrl,
    priceFrom: row.priceFrom,
    currency: row.currency as EventRecord["currency"],
    soldOut: row.soldOut,
    cancelled: row.cancelled,
    dateChanged: row.dateChanged,
    timeChanged: row.timeChanged,
    published: row.published,
    manualOverride: row.manualOverride,
    overriddenFields: row.overriddenFields,
    confidence: row.confidence as ConfidenceLevel,
    canonicalSourceId: row.canonicalSourceId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastSourceCheck: row.lastSourceCheck?.toISOString() ?? null,
    lastChanged: row.lastChanged?.toISOString() ?? null,
  };
}

export function discoveryRowToRecord(row: DiscoveryQueueRow): DiscoveryQueueItem {
  return {
    id: row.id,
    probableTitle: row.probableTitle,
    probableStart: row.probableStart?.toISOString() ?? null,
    probableVenueName: row.probableVenueName,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    sourceId: row.sourceId,
    detectedLineup: row.detectedLineup,
    predictedGenre: row.predictedGenre as GenreSlug | null,
    genreConfidence: row.genreConfidence as ConfidenceLevel,
    suspectedDuplicateOfEventId: row.suspectedDuplicateOfEventId,
    missingFields: row.missingFields,
    overallConfidence: row.overallConfidence as ConfidenceLevel,
    status: row.status as DiscoveryQueueStatus,
  };
}

export type { EventRow, VenueRow, SourceRow, DiscoveryQueueRow };
