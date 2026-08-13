import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { discoveryQueue, events, sources, venues } from "@/db/schema";
import {
  discoveryRowToRecord,
  eventRowToRecord,
  sourceRowToRecord,
  venueRowToRecord,
} from "@/db/mappers";
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
