import { and, eq, notInArray } from "drizzle-orm";
import { db } from "./client";
import { eventAdminSoundcloudLinks } from "./schema";
import { findEvent } from "./eventYoutubeOverrides";
import { planAdminSoundcloudLinks } from "@/lib/adminSoundcloudLinks";

/**
 * Admin-UI side of manual artist SoundCloud links (2026-11-15), called from
 * /api/admin/events/[id]/soundcloud. Writes event_admin_soundcloud_links for
 * one event only, and only when an admin presses Save in the SoundCloud
 * panel — the generic event edit form never reaches here, and no sync reads
 * or writes this table. Rules live in src/lib/adminSoundcloudLinks.ts.
 */

export interface EventSoundcloudAdminState {
  eventId: string;
  /** The event's lineup, in order — one input per name in the admin panel. */
  lineup: string[];
  /** Saved admin links by exact lineup name (only names still in the lineup). */
  links: Record<string, string>;
}

export class EventSoundcloudAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "EventSoundcloudAdminError";
  }
}

async function requireEvent(eventId: string) {
  const event = await findEvent({ id: eventId });
  if (!event) throw new EventSoundcloudAdminError(`No event with id ${eventId}.`, 404);
  return event;
}

export async function getEventSoundcloudAdminState(eventId: string): Promise<EventSoundcloudAdminState> {
  const event = await requireEvent(eventId);
  const rows = await db
    .select({ artistName: eventAdminSoundcloudLinks.artistName, url: eventAdminSoundcloudLinks.url })
    .from(eventAdminSoundcloudLinks)
    .where(eq(eventAdminSoundcloudLinks.eventId, event.id));
  const lineup = new Set(event.artists);
  return {
    eventId: event.id,
    lineup: event.artists,
    links: Object.fromEntries(rows.filter((r) => lineup.has(r.artistName)).map((r) => [r.artistName, r.url])),
  };
}

/**
 * Replaces this event's admin links with the submitted set (validated first —
 * an invalid entry saves nothing). Names not submitted, or submitted with an
 * empty URL, lose their admin link. Upsert before delete, so a failure part-way
 * can only leave an old link in place, never drop a new one.
 */
export async function setEventSoundcloudLinks(eventId: string, input: unknown): Promise<EventSoundcloudAdminState> {
  const event = await requireEvent(eventId);
  const plan = planAdminSoundcloudLinks(event.artists, input);
  if (!plan.ok) throw new EventSoundcloudAdminError(plan.error, 400);

  const now = new Date();
  for (const link of plan.links) {
    await db
      .insert(eventAdminSoundcloudLinks)
      .values({ eventId: event.id, artistName: link.artistName, url: link.url, updatedAt: now })
      .onConflictDoUpdate({
        target: [eventAdminSoundcloudLinks.eventId, eventAdminSoundcloudLinks.artistName],
        set: { url: link.url, updatedAt: now },
      });
  }
  const kept = plan.links.map((l) => l.artistName);
  await db
    .delete(eventAdminSoundcloudLinks)
    .where(
      kept.length > 0
        ? and(eq(eventAdminSoundcloudLinks.eventId, event.id), notInArray(eventAdminSoundcloudLinks.artistName, kept))
        : eq(eventAdminSoundcloudLinks.eventId, event.id),
    );
  return getEventSoundcloudAdminState(event.id);
}

