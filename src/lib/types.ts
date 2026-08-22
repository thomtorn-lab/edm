import type { GenreSlug } from "./taxonomy";

export type ConfidenceLevel = "high" | "medium" | "low";

export type SourceRole = "discovery" | "ingestion" | "verification" | "link";

export type SourceType =
  | "official-venue"
  | "official-promoter"
  | "ticketing"
  | "specialist-aggregator"
  | "general-aggregator"
  | "social";

/**
 * Canonical authority order used to resolve conflicting field values
 * across sources. Lower index = higher authority. See spec section 32.
 */
export const SOURCE_TYPE_PRIORITY: SourceType[] = [
  "official-promoter",
  "official-venue",
  "ticketing",
  "specialist-aggregator",
  "general-aggregator",
  "social",
];

export interface Source {
  id: string;
  sourceName: string;
  sourceType: SourceType;
  baseUrl: string;
  roles: SourceRole[];
  adapter: string | null;
  trustLevel: ConfidenceLevel;
  autoPublish: boolean;
  syncFrequency: string;
  active: boolean;
  lastSuccessfulSync: string | null;
  lastAttemptedSync: string | null;
  lastError: string | null;
  eventsFound: number;
  eventsUpdated: number;
  /** Human-readable note on integration method / permission status (spec section 59). */
  integrationNote: string;
}

export interface Venue {
  id: string;
  slug: string;
  name: string;
  /** Alternate names/spellings that should resolve to this venue. */
  aliases: string[];
  address: string;
  city: "Copenhagen" | "Frederiksberg";
  postalCode: string;
  websiteUrl: string | null;
  description: string;
  /** ~20-35 words for the /venues overview list. Falls back to `description` when unset. */
  shortDescription: string | null;
  /** ~100-170 words for the venue's own detail page. Falls back to `description` when unset. */
  venueProfile: string | null;
}

export interface Artist {
  id: string;
  name: string;
  aliases: string[];
}

export type EventSourceRole = "official" | "ticket" | "facebook" | "resident-advisor" | "other";

export interface EventSourceRef {
  role: EventSourceRole;
  url: string;
  sourceId: string;
}

export interface EventRecord {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  artists: string[];
  startDatetime: string; // ISO 8601 with UTC offset, Europe/Copenhagen wall clock
  endDatetime: string | null; // ISO 8601 with UTC offset
  timezone: "Europe/Copenhagen";
  venueId: string;
  primaryGenre: GenreSlug;
  subgenres: GenreSlug[];
  genreConfidence: ConfidenceLevel;
  officialEventUrl: string | null;
  ticketUrl: string | null;
  facebookUrl: string | null;
  residentAdvisorUrl: string | null;
  otherSourceUrls: string[];
  imageUrl: string | null;
  priceFrom: number | null;
  currency: "DKK" | null;
  soldOut: boolean;
  cancelled: boolean;
  dateChanged: boolean;
  timeChanged: boolean;
  published: boolean;
  manualOverride: boolean;
  /** Field names an admin has hand-corrected — a later sync must never overwrite these (see src/lib/override.ts). */
  overriddenFields: string[];
  confidence: ConfidenceLevel;
  canonicalSourceId: string | null;
  createdAt: string;
  updatedAt: string;
  lastSourceCheck: string | null;
  lastChanged: string | null;
}

export interface FestivalRecord {
  id: string;
  slug: string;
  name: string;
  country: string;
  location: string;
  typicalMonth: string;
  currentDates: string | null;
  genres: GenreSlug[];
  description: string;
  officialUrl: string;
  ticketUrl: string | null;
  imageUrl: string | null;
}

export type DiscoveryAction = "publish" | "edit" | "ignore" | "merge";

export type DiscoveryQueueStatus = "pending" | "published" | "ignored" | "merged";

export interface DiscoveryQueueItem {
  id: string;
  probableTitle: string;
  probableStart: string | null;
  probableVenueName: string | null;
  sourceName: string;
  sourceUrl: string;
  sourceId: string | null;
  detectedLineup: string[];
  predictedGenre: GenreSlug | null;
  genreConfidence: ConfidenceLevel;
  suspectedDuplicateOfEventId: string | null;
  missingFields: string[];
  overallConfidence: ConfidenceLevel;
  status: DiscoveryQueueStatus;
}
