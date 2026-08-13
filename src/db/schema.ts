import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  primaryKey,
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
  description: text("description").notNull(),
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
  detectedLineup: text("detected_lineup").array().notNull().default([]),
  predictedGenre: text("predicted_genre"),
  genreConfidence: text("genre_confidence").notNull().default("low"),
  suspectedDuplicateOfEventId: text("suspected_duplicate_of_event_id").references(() => events.id),
  missingFields: text("missing_fields").array().notNull().default([]),
  overallConfidence: text("overall_confidence").notNull().default("low"),
  /** pending | published | ignored | merged — persisted so a refresh never loses admin decisions. */
  status: text("status").notNull().default("pending"),
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
