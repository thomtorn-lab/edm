import { and, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { events, eventSoundcloudLinks, soundcloudLinkBlocks, sources } from "./schema";
import { soundcloudProfileUrl } from "@/lib/adapters/cultureBoxSoundcloudLinks";
import { ADMIN_SOUNDCLOUD_SOURCE_ID } from "@/lib/soundcloudLinks";
import { SITE_URL } from "@/lib/siteUrl";

/**
 * Manual SoundCloud profile links per lineup artist, set in the event's
 * admin edit view (2026-11-16). Stored in event_soundcloud_links under
 * ADMIN_SOUNDCLOUD_SOURCE_ID: one row per (event, artist), for that event
 * only. A manual link wins over the source's link on the public page
 * (getSoundcloudLinksForLineup), and no sync ever touches it
 * (reconcileSourceSoundcloudLinks only reads and writes its own source's
 * rows, and refuses this source id outright).
 *
 * The URL goes through the same profile validation the venue links use
 * (soundcloudProfileUrl) and a blocked profile (soundcloud_link_blocks) is
 * refused — and, if blocked later, hidden like any other link.
 */

export class EventSoundcloudAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface EventSoundcloudArtistState {
  /** The lineup name exactly as stored in events.artists. */
  name: string;
  /** The admin's link for this event, or null. */
  manualUrl: string | null;
  /** A source's own link for this name on this event (shown when there is no manual one), or null. */
  automaticUrl: string | null;
  /** True when the manual link's profile is on the block list (it is not shown). */
  manualBlocked: boolean;
}

export interface EventSoundcloudAdminState {
  eventId: string;
  artists: EventSoundcloudArtistState[];
}

/** The inactive source row manual links hang off (event_soundcloud_links.source_id is a foreign key). Never synced. */
export const ADMIN_SOUNDCLOUD_SOURCE_ROW = {
  id: ADMIN_SOUNDCLOUD_SOURCE_ID,
  sourceName: "Admin — manual SoundCloud links",
  sourceType: "general-aggregator",
  baseUrl: SITE_URL,
  roles: [] as string[],
  adapter: null,
  trustLevel: "high",
  autoPublish: false,
  cancellationPolicy: "none",
  syncFrequency: "manual",
  active: false,
  integrationNote: "Holds SoundCloud links an admin set by hand on one event. No adapter, never synced.",
};

const REJECTION_MESSAGE: Record<string, string> = {
  "not-soundcloud": "That isn't a soundcloud.com link.",
  "not-a-profile": "Use the artist's profile link (https://soundcloud.com/<name>), not a track, set or other page.",
  "reserved-path": "That is a SoundCloud page, not an artist profile.",
  "venue-account": "That is the venue's own SoundCloud account, not an artist profile.",
  "label-or-organisation": "That looks like a label or organisation account, not an artist profile.",
};

async function requireLineup(eventId: string): Promise<string[]> {
  const [row] = await db.select({ artists: events.artists }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!row) throw new EventSoundcloudAdminError(`No event with id ${eventId}.`, 404);
  return row.artists;
}

function requireLineupName(lineup: string[], artistName: unknown): string {
  if (typeof artistName !== "string" || !lineup.includes(artistName)) {
    throw new EventSoundcloudAdminError("Pick an artist from this event's lineup.", 400);
  }
  return artistName;
}

export async function getEventSoundcloudAdminState(eventId: string): Promise<EventSoundcloudAdminState> {
  const lineup = await requireLineup(eventId);
  const rows = await db
    .select({ sourceId: eventSoundcloudLinks.sourceId, artistName: eventSoundcloudLinks.artistName, url: eventSoundcloudLinks.url })
    .from(eventSoundcloudLinks)
    .where(eq(eventSoundcloudLinks.eventId, eventId));
  const blocked = new Set(
    (await db.select({ url: soundcloudLinkBlocks.url }).from(soundcloudLinkBlocks)).map((b) => b.url),
  );
  const seen = new Set<string>();
  const artists: EventSoundcloudArtistState[] = [];
  for (const name of lineup) {
    if (seen.has(name)) continue;
    seen.add(name);
    const manual = rows.find((r) => r.artistName === name && r.sourceId === ADMIN_SOUNDCLOUD_SOURCE_ID) ?? null;
    const automatic = rows.find((r) => r.artistName === name && r.sourceId !== ADMIN_SOUNDCLOUD_SOURCE_ID && !blocked.has(r.url)) ?? null;
    artists.push({ name, manualUrl: manual?.url ?? null, automaticUrl: automatic?.url ?? null, manualBlocked: manual ? blocked.has(manual.url) : false });
  }
  return { eventId, artists };
}

/** Adds or replaces the manual link for one lineup artist on this event. */
export async function setManualSoundcloudLink(eventId: string, artistName: unknown, url: unknown): Promise<EventSoundcloudAdminState> {
  const lineup = await requireLineup(eventId);
  const name = requireLineupName(lineup, artistName);
  if (typeof url !== "string" || !url.trim()) throw new EventSoundcloudAdminError("Paste the artist's SoundCloud profile link.", 400);
  const shaped = soundcloudProfileUrl(url);
  if ("rejected" in shaped) throw new EventSoundcloudAdminError(REJECTION_MESSAGE[shaped.rejected] ?? "That SoundCloud link can't be used.", 400);
  const [block] = await db.select({ url: soundcloudLinkBlocks.url }).from(soundcloudLinkBlocks).where(eq(soundcloudLinkBlocks.url, shaped.url)).limit(1);
  if (block) throw new EventSoundcloudAdminError("That SoundCloud profile is on the block list and can't be linked.", 400);

  await db.insert(sources).values(ADMIN_SOUNDCLOUD_SOURCE_ROW).onConflictDoNothing();
  const now = new Date();
  await db
    .insert(eventSoundcloudLinks)
    .values({ eventId, sourceId: ADMIN_SOUNDCLOUD_SOURCE_ID, artistName: name, url: shaped.url, updatedAt: now })
    .onConflictDoUpdate({
      target: [eventSoundcloudLinks.eventId, eventSoundcloudLinks.sourceId, eventSoundcloudLinks.artistName],
      set: { url: sql`excluded.url`, updatedAt: now },
    });
  return getEventSoundcloudAdminState(eventId);
}

/** Removes the manual link for one lineup artist on this event; a source's own link (if any) shows again. */
export async function removeManualSoundcloudLink(eventId: string, artistName: unknown): Promise<EventSoundcloudAdminState> {
  await requireLineup(eventId);
  if (typeof artistName !== "string" || !artistName) throw new EventSoundcloudAdminError("Pick an artist from this event's lineup.", 400);
  await db
    .delete(eventSoundcloudLinks)
    .where(
      and(
        eq(eventSoundcloudLinks.eventId, eventId),
        eq(eventSoundcloudLinks.sourceId, ADMIN_SOUNDCLOUD_SOURCE_ID),
        eq(eventSoundcloudLinks.artistName, artistName),
      ),
    );
  return getEventSoundcloudAdminState(eventId);
}
