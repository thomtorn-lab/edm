import type { GenreSlug } from "./taxonomy";
import type { PublishDecision } from "./classification";
import type { HoldReason } from "./adapters/pipeline";

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
  /** Timestamp of this source's most recent COMPLETE fetch (never a partial
   *  one) — see src/lib/sync.ts::isDiscoveryRowCurrent, the only thing this
   *  is compared against to derive a Discovery Queue row's current-vs-stale
   *  freshness. Never sources.lastSuccessfulSync, which also covers a
   *  partial-fetch success. Null when never completed. */
  lastCompleteSyncAt: string | null;
}

/**
 * A room/stage of a parent venue/complex (generalized sub-venue model,
 * 2026-09-06 — VEGA venue model cleanup follow-up). Matched by resolveVenue()
 * the same exact-normalized-match way an alias is, but resolving to a room
 * additionally reports which one via VenueResolution.subVenue rather than
 * collapsing into the parent with no trace. Deliberately not a separate
 * venue identity — see PROTECTED_SUB_VENUE_NAMES in src/lib/venueCreation.ts.
 */
export interface VenueRoom {
  /** Raw source text identifying this room, e.g. "Store VEGA". */
  name: string;
  /** Optional alternate raw strings that also mean this same room. */
  aliases?: string[];
}

export interface Venue {
  id: string;
  slug: string;
  name: string;
  /** Alternate names/spellings that should resolve to this venue. */
  aliases: string[];
  /** Optional rooms/stages of this venue/complex — see VenueRoom above. Defaults to none. */
  rooms?: VenueRoom[];
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

/** Result of resolving a raw venue string against the registry — see src/lib/normalize.ts::resolveVenue. */
export interface VenueResolution {
  venue: Venue;
  /** Which room the raw text named, or null when the venue has no rooms configured or none was named. */
  subVenue: string | null;
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

/**
 * Why an admin explicitly unpublished an event (admin unpublish/
 * cancellation safety, 2026-09-06). "cancelled" is one of these reasons,
 * not a separate public display state — a cancelled event disappears from
 * the public site entirely via published=false, never via a "Cancelled"
 * badge on an event that's still visible.
 */
export type AdminUnpublishReason = "cancelled" | "irrelevant" | "duplicate" | "incorrect_data" | "other";

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
  /** Which room/stage of venueId this event is at (generalized sub-venue model, 2026-09-06) — see Venue.rooms/VenueRoom. Null when not applicable/unknown. */
  subVenue: string | null;
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
  postponed: boolean;
  dateChanged: boolean;
  timeChanged: boolean;
  published: boolean;
  /** Non-null means an admin explicitly took this event down — see AdminUnpublishReason and src/db/writes.ts::adminUnpublishEvent. Never set by an automated process. */
  adminUnpublishReason: AdminUnpublishReason | null;
  adminUnpublishedAt: string | null;
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

/**
 * Public edition-status model for the /festivals guide. Exactly one of
 * these applies at a time — never combine a status with a separately
 * shown approximate date, and never fabricate exact dates that aren't
 * confirmed by an official/organizer source.
 */
export type FestivalEditionStatus =
  | { kind: "confirmed"; dates: string }
  | { kind: "dates-tba" }
  | { kind: "next-edition-tba" }
  | { kind: "no-edition"; year: number }
  | { kind: "cancelled" }
  | { kind: "returns"; year: number }
  | { kind: "biennial"; nextYear: number };

export interface FestivalRecord {
  id: string;
  slug: string;
  name: string;
  country: string;
  location: string;
  typicalMonth: string;
  edition: FestivalEditionStatus;
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
  /** Optional pre-publish end time / ticket URL / explicit free-admission
   *  flag (admin/manual-event work package, 2026-08-24) — see
   *  src/db/schema.ts's column comment. Carried straight onto the created
   *  event's endDatetime/ticketUrl/priceFrom by publishDiscoveryItem. */
  probableEnd: string | null;
  probableTicketUrl: string | null;
  probableFree: boolean;
  probableVenueName: string | null;
  /** Which room the raw venue text resolved to (generalized sub-venue model, 2026-09-06) — see src/db/schema.ts's column comment. */
  probableSubVenue: string | null;
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
  /** The REAL (non-counterfactual) pipeline hold reason for this row's most
   *  recent classification — see src/db/schema.ts's holdReason column
   *  comment and src/lib/adminQueue.ts::classifyAdminQueueRow, the reason
   *  this is exposed at all. Null when the fresh decision isn't "hold", or
   *  for a row not yet re-synced since this field existed. */
  holdReason: HoldReason;
  /** Source-freshness timestamp — see src/db/schema.ts's lastSeenAt column comment. */
  lastSeenAt: string | null;
  /** Venue-resolution counterfactual — see src/db/schema.ts's venueResolvedDecision column comment. */
  venueResolvedDecision: PublishDecision | null;
  /** Companion to venueResolvedDecision — see src/db/schema.ts's venueResolvedHoldReason column comment. */
  venueResolvedHoldReason: HoldReason;
}
