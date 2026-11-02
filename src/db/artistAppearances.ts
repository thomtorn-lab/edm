import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "./client";
import { artists, eventArtists, events, eventSoundcloudLinks, soundcloudLinkBlocks, venues } from "./schema";
import { artistIdentityKey } from "../lib/artistIdentity/lineupIdentity";
import { reconcileAppearances, type ReconcileAppearance, type ReconcileArtist, type Confidence } from "../lib/artistIdentity/reconcile";

/**
 * Postgres wiring for the appearance reconciler (src/lib/artistIdentity/
 * reconcile.ts). Reads the publicly listed upcoming events and the stored
 * identity state, and writes only artists / event_artists. Idempotent: a
 * second run with unchanged data writes the same values again.
 */

/** Publicly listed and not yet over — the same definition as the alert send check. */
export function publicUpcomingEventCondition(now: Date) {
  return and(
    eq(events.published, true),
    eq(events.cancelled, false),
    isNull(events.adminUnpublishReason),
    isNull(events.sourceCancelledAt),
    sql`COALESCE(${events.endDatetime}, ${events.startDatetime} + interval '1 day') > ${now}`,
  );
}

function venueKeys(rows: { name: string; aliases: string[]; rooms: unknown }[]): Set<string> {
  const keys = new Set<string>();
  const add = (n: unknown) => {
    if (typeof n === "string" && n.trim()) keys.add(artistIdentityKey(n));
  };
  for (const v of rows) {
    add(v.name);
    for (const a of v.aliases ?? []) add(a);
    if (Array.isArray(v.rooms)) for (const r of v.rooms as { name?: unknown; aliases?: unknown }[]) {
      add(r?.name);
      if (Array.isArray(r?.aliases)) for (const a of r.aliases) add(a);
    }
  }
  return keys;
}

export interface ReconcileSummary {
  events: number;
  newArtists: number;
  verifiedArtists: number;
  upserts: number;
  byConfidence: Record<string, number>;
}

export async function reconcileArtistAppearances(now: Date = new Date()): Promise<ReconcileSummary> {
  const [publicEvents, artistRows, appearanceRows, linkRows, blockRows, venueRows] = await Promise.all([
    db.select({ id: events.id, title: events.title, artists: events.artists }).from(events).where(publicUpcomingEventCondition(now)),
    db.select().from(artists),
    db.select().from(eventArtists),
    db.select({ eventId: eventSoundcloudLinks.eventId, artistName: eventSoundcloudLinks.artistName, url: eventSoundcloudLinks.url }).from(eventSoundcloudLinks),
    db.select({ url: soundcloudLinkBlocks.url }).from(soundcloudLinkBlocks),
    db.select({ name: venues.name, aliases: venues.aliases, rooms: venues.rooms }).from(venues),
  ]);
  const blocked = new Set(blockRows.map((b) => b.url));

  const result = reconcileAppearances({
    events: publicEvents,
    artists: artistRows.map((a) => ({ ...a, status: a.status as ReconcileArtist["status"] })),
    appearances: appearanceRows.map((a) => ({ ...a, confidence: a.confidence as Confidence })),
    soundcloudLinks: linkRows.filter((l) => !blocked.has(l.url)),
    venueKeys: venueKeys(venueRows),
    now,
    newArtistId: () => `art_${randomUUID()}`,
  });

  await db.transaction(async (tx) => {
    if (result.newArtists.length > 0) {
      await tx.insert(artists).values(result.newArtists.map((a) => ({ ...a, createdAt: now, updatedAt: now }))).onConflictDoNothing();
    }
    if (result.verifiedArtistIds.length > 0) {
      await tx.update(artists).set({ status: "verified", updatedAt: now }).where(inArray(artists.id, result.verifiedArtistIds));
    }
    for (const u of result.upserts) await upsertAppearance(tx, u, now);
  });

  const byConfidence: Record<string, number> = {};
  for (const u of result.upserts) if (!u.removedAt) byConfidence[u.confidence] = (byConfidence[u.confidence] ?? 0) + 1;
  return { events: publicEvents.length, newArtists: result.newArtists.length, verifiedArtists: result.verifiedArtistIds.length, upserts: result.upserts.length, byConfidence };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function upsertAppearance(tx: Tx, u: ReconcileAppearance, now: Date) {
  const values = {
    eventId: u.eventId,
    nameKey: u.nameKey,
    artistId: u.artistId,
    lineupEntry: u.lineupEntry,
    displayName: u.displayName,
    confidence: u.confidence,
    reason: u.reason,
    visibleSince: u.visibleSince,
    confirmedAt: u.confirmedAt,
    removedAt: u.removedAt,
    updatedAt: now,
  };
  await tx
    .insert(eventArtists)
    .values({ ...values, createdAt: now })
    .onConflictDoUpdate({
      target: [eventArtists.eventId, eventArtists.nameKey],
      // visibleSince/confirmedAt are first-write-wins even against a stale read.
      set: {
        ...values,
        visibleSince: sql`COALESCE(${eventArtists.visibleSince}, excluded.visible_since)`,
        confirmedAt: sql`COALESCE(${eventArtists.confirmedAt}, excluded.confirmed_at)`,
      },
      // An admin decision is never overwritten — including one made after this
      // run read the table. The reconciler carries admin decisions through
      // unchanged, so for those rows only removedAt/display fields move.
      setWhere: sql`${notInArray(eventArtists.confidence, ["confirmed", "rejected"])} OR excluded.confidence = ${eventArtists.confidence}`,
    });
}

/** Admin: confirm or reject one appearance (the review queue). Confirming sets confirmedAt now; the alert engine still only alerts if that is within the safety hold after visibility. */
export async function decideAppearance(eventId: string, nameKey: string, decision: "confirmed" | "rejected", artistId?: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(eventArtists)
    .set({
      confidence: decision,
      reason: `admin ${decision}`,
      updatedAt: now,
      ...(artistId ? { artistId } : {}),
      ...(decision === "confirmed" ? { confirmedAt: sql`COALESCE(${eventArtists.confirmedAt}, ${now})` } : {}),
    })
    .where(and(eq(eventArtists.eventId, eventId), eq(eventArtists.nameKey, nameKey)))
    .returning({ eventId: eventArtists.eventId });
  return rows.length > 0;
}

/** Appearances waiting for an admin, on events still upcoming. */
export async function listReviewAppearances(now: Date = new Date()) {
  return db
    .select({
      eventId: eventArtists.eventId,
      nameKey: eventArtists.nameKey,
      displayName: eventArtists.displayName,
      lineupEntry: eventArtists.lineupEntry,
      reason: eventArtists.reason,
      artistId: eventArtists.artistId,
      eventTitle: events.title,
      eventSlug: events.slug,
      startDatetime: events.startDatetime,
    })
    .from(eventArtists)
    .innerJoin(events, eq(events.id, eventArtists.eventId))
    .where(and(eq(eventArtists.confidence, "review"), isNull(eventArtists.removedAt), gt(events.startDatetime, now)))
    .orderBy(events.startDatetime);
}
