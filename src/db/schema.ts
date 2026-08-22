import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";

/**
 * Canonical persistent schema. Mirrors the shapes in src/lib/types.ts
 * closely on purpose — the app-facing query layer (src/lib/queries.ts)
 * keeps the same function signatures/return shapes it had over the static
 * fixtures, so swapping the storage backend didn't require touching pages
 * or components.
 */

export const venues = pgTable("venues", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  aliases: text("aliases").array().notNull().default([]),
  address: text("address").notNull(),
  city: text("city").notNull(), // "Copenhagen" | "Frederiksberg"
  postalCode: text("postal_code").notNull(),
  websiteUrl: text("website_url"),
  // Legacy single-purpose field, superseded by shortDescription/venueProfile
  // below but kept (nullable-compatible callers still read it) until every
  // venue has been migrated onto the new two-field content model.
  description: text("description").notNull(),
  /** ~20-35 words for the /venues overview list: type + electronic relevance + broad programming. */
  shortDescription: text("short_description"),
  /** ~100-170 words for the venue's own detail page — genuinely more than the short description, not a restatement of it. */
  venueProfile: text("venue_profile"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  sourceName: text("source_name").notNull(),
  sourceType: text("source_type").notNull(),
  baseUrl: text("base_url").notNull(),
  roles: text("roles").array().notNull().default([]),
  adapter: text("adapter"),
  trustLevel: text("trust_level").notNull(),
  autoPublish: boolean("auto_publish").notNull().default(false),
  syncFrequency: text("sync_frequency").notNull(),
  active: boolean("active").notNull().default(true),
  lastSuccessfulSync: timestamp("last_successful_sync", { withTimezone: true }),
  lastAttemptedSync: timestamp("last_attempted_sync", { withTimezone: true }),
  lastError: text("last_error"),
  eventsFound: integer("events_found").notNull().default(0),
  eventsUpdated: integer("events_updated").notNull().default(0),
  integrationNote: text("integration_note").notNull().default(""),
});

export const events = pgTable("events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  artists: text("artists").array().notNull().default([]),
  startDatetime: timestamp("start_datetime", { withTimezone: true }).notNull(),
  endDatetime: timestamp("end_datetime", { withTimezone: true }),
  timezone: text("timezone").notNull().default("Europe/Copenhagen"),
  venueId: text("venue_id").notNull().references(() => venues.id),
  primaryGenre: text("primary_genre").notNull(),
  subgenres: text("subgenres").array().notNull().default([]),
  genreConfidence: text("genre_confidence").notNull().default("medium"),
  officialEventUrl: text("official_event_url"),
  ticketUrl: text("ticket_url"),
  facebookUrl: text("facebook_url"),
  residentAdvisorUrl: text("resident_advisor_url"),
  otherSourceUrls: text("other_source_urls").array().notNull().default([]),
  imageUrl: text("image_url"),
  priceFrom: integer("price_from"),
  currency: text("currency"),
  soldOut: boolean("sold_out").notNull().default(false),
  cancelled: boolean("cancelled").notNull().default(false),
  dateChanged: boolean("date_changed").notNull().default(false),
  timeChanged: boolean("time_changed").notNull().default(false),
  published: boolean("published").notNull().default(true),
  manualOverride: boolean("manual_override").notNull().default(false),
  /**
   * Field-level manual-override protection (spec section 46 / user
   * directive step 3): names of fields an admin has hand-corrected.
   * runIngestionPipeline's merge step must never let an automated sync
   * overwrite a field listed here. See src/lib/sync.ts::mergeSourceUpdate.
   */
  overriddenFields: text("overridden_fields").array().notNull().default([]),
  confidence: text("confidence").notNull().default("medium"),
  canonicalSourceId: text("canonical_source_id").references(() => sources.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastSourceCheck: timestamp("last_source_check", { withTimezone: true }),
  lastChanged: timestamp("last_changed", { withTimezone: true }),
});

export const discoveryQueue = pgTable("discovery_queue", {
  id: text("id").primaryKey(),
  probableTitle: text("probable_title").notNull(),
  probableStart: timestamp("probable_start", { withTimezone: true }),
  probableVenueName: text("probable_venue_name"),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  /**
   * Registered source this item came from (src-hangaren, etc.), so
   * publishDiscoveryItem can persist provenance immediately instead of
   * relying on a later sync to reconstruct it via fuzzy matching. Null for
   * items with no registered source — e.g. the admin "Add event from URL"
   * tool, which isn't tied to any src-* row.
   */
  sourceId: text("source_id").references(() => sources.id),
  detectedLineup: text("detected_lineup").array().notNull().default([]),
  predictedGenre: text("predicted_genre"),
  genreConfidence: text("genre_confidence").notNull().default("low"),
  suspectedDuplicateOfEventId: text("suspected_duplicate_of_event_id").references(() => events.id),
  missingFields: text("missing_fields").array().notNull().default([]),
  overallConfidence: text("overall_confidence").notNull().default("low"),
  /** pending | published | ignored | merged — persisted so a refresh never loses admin decisions. */
  status: text("status").notNull().default("pending"),
  /**
   * Field-level manual-override protection, mirroring events.overriddenFields
   * (src/lib/override.ts). Set by updateDiscoveryItem whenever an admin
   * hand-edits a field on a still-pending item; a later sync refreshing this
   * item's machine-generated classification (src/lib/sync.ts::
   * buildDiscoveryQueueClassificationPatch) must never clobber a field listed
   * here.
   */
  overriddenFields: text("overridden_fields").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

/**
 * Append-only audit trail: every admin write and every sync-driven change
 * gets one row. This is what makes "a page refresh must not lose changes"
 * and "preserve provenance" verifiable rather than asserted.
 */
export const eventChangeLog = pgTable("event_change_log", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  changedBy: text("changed_by").notNull(), // "admin" | a source id, e.g. "src-culture-box"
  changeType: text("change_type").notNull(), // "create" | "update" | "publish" | "unpublish" | "merge" | "sync"
  fieldsChanged: text("fields_changed").array().notNull().default([]),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Genre enrichment cache (Discogs MVP). One row per distinct artist name,
 * reused across every event and every future source — never looked up more
 * than once per TTL window. See src/lib/enrichment/genreEnrichment.ts for
 * the lookup/aggregation logic and src/db/enrichment.ts for the Postgres
 * wiring. This table IS the evidence store a reviewer consults (join by
 * artist name against a discovery-queue item's `detectedLineup`) — no
 * separate evidence table.
 */
export const artistGenreCache = pgTable("artist_genre_cache", {
  artistNameNormalized: text("artist_name_normalized").primaryKey(),
  lookupStatus: text("lookup_status").notNull(), // "found" | "not_found" | "ambiguous"
  proposedGenre: text("proposed_genre"), // GenreSlug, null if unresolved/ambiguous
  genreConfidence: text("genre_confidence"), // ConfidenceLevel, null if no genre proposed — NEVER "high" for this source
  identityConfidence: text("identity_confidence"), // "medium" | "low", null if not_found
  discogsArtistId: integer("discogs_artist_id"),
  evidence: jsonb("evidence").notNull().default([]),
  classificationMethod: text("classification_method").notNull(),
  lookedUpAt: timestamp("looked_up_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * Per-source sync concurrency lease (replaces a session-scoped
 * pg_advisory_lock design that broke under Supavisor's connection pooling
 * — see src/db/sync.ts's acquireSyncLock/releaseSyncLock). One row per
 * source that currently has a sync in flight; expiresAt is what guarantees
 * a crashed/killed sync can never leave a permanent lock — no row is ever
 * treated as held once its expiresAt has passed, regardless of whether the
 * request that created it ever runs its release step.
 */
export const syncLocks = pgTable("sync_locks", {
  sourceId: text("source_id").primaryKey(),
  lockToken: text("lock_token").notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const sourceEventLinks = pgTable(
  "source_event_links",
  {
    eventId: text("event_id").notNull().references(() => events.id),
    sourceId: text("source_id").notNull().references(() => sources.id),
    sourceUrl: text("source_url").notNull(),
    role: text("role").notNull(), // "official" | "ticket" | "facebook" | "resident-advisor" | "other"
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.sourceId, table.role] })],
);
