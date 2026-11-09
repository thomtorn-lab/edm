import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "./client";
import { alertFollows, artists, eventArtists, events, eventSoundcloudLinks, soundcloudLinkBlocks, venues } from "./schema";
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
  /** Appearances of followed artists that just became public in review (see onFollowedReview). */
  followedReview?: number;
  skipped?: "locked";
}

/** A followed artist's appearance that just became public but needs an admin before it can alert. */
export interface FollowedReviewAppearance {
  eventId: string;
  eventTitle: string;
  displayName: string;
  reason: string | null;
}

/**
 * One transaction: the reads, the decision and the writes. A transaction-
 * scoped advisory lock makes concurrent runs skip instead of racing (two
 * runs could otherwise create the same new artist twice); it is released
 * with the transaction and writes no row anywhere, so a run touches only
 * artists and event_artists (and, after a verification, alert_follows).
 */
export async function reconcileArtistAppearances(
  now: Date = new Date(),
  opts: { onFollowedReview?: (items: FollowedReviewAppearance[]) => Promise<void> } = {},
): Promise<ReconcileSummary> {
  const followedReview: FollowedReviewAppearance[] = [];
  const summary = await db.transaction(async (tx) => {
    const lock = await tx.execute<{ ok: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext('artist-alerts-reconcile')) AS ok`);
    if (!lock.rows[0]?.ok) return { events: 0, newArtists: 0, verifiedArtists: 0, upserts: 0, byConfidence: {}, skipped: "locked" as const };
    return reconcileInTransaction(tx, now, opts.onFollowedReview ? followedReview : null);
  });
  // After commit, and only once per appearance: visible_since is written once, by the run that first sees it.
  if (opts.onFollowedReview && followedReview.length > 0) await opts.onFollowedReview(followedReview);
  return summary;
}

async function reconcileInTransaction(tx: Tx, now: Date, followedReview: FollowedReviewAppearance[] | null): Promise<ReconcileSummary> {
  const publicEvents = await tx.select({ id: events.id, title: events.title, artists: events.artists }).from(events).where(publicUpcomingEventCondition(now));
  const artistRows = await tx.select().from(artists);
  const appearanceRows = await tx.select().from(eventArtists);
  const linkRows = await tx.select({ eventId: eventSoundcloudLinks.eventId, artistName: eventSoundcloudLinks.artistName, url: eventSoundcloudLinks.url }).from(eventSoundcloudLinks);
  const blockRows = await tx.select({ url: soundcloudLinkBlocks.url }).from(soundcloudLinkBlocks);
  const venueRows = await tx.select({ name: venues.name, aliases: venues.aliases, rooms: venues.rooms }).from(venues);
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

  {
    if (result.newArtists.length > 0) {
      await tx.insert(artists).values(result.newArtists.map((a) => ({ ...a, createdAt: now, updatedAt: now }))).onConflictDoNothing();
    }
    if (result.verifiedArtistIds.length > 0) {
      await tx.update(artists).set({ status: "verified", updatedAt: now }).where(inArray(artists.id, result.verifiedArtistIds));
      // A requested artist just verified: confirmed follows count from now, so nothing already listed is mailed.
      await tx
        .update(alertFollows)
        .set({ activeSince: now })
        .where(and(inArray(alertFollows.artistId, result.verifiedArtistIds), sql`${alertFollows.activeSince} IS NOT NULL`));
    }
    for (const u of result.upserts) await upsertAppearance(tx, u, now);
  }

  const byConfidence: Record<string, number> = {};
  for (const u of result.upserts) if (!u.removedAt) byConfidence[u.confidence] = (byConfidence[u.confidence] ?? 0) + 1;
  const summary: ReconcileSummary = { events: publicEvents.length, newArtists: result.newArtists.length, verifiedArtists: result.verifiedArtistIds.length, upserts: result.upserts.length, byConfidence };

  if (followedReview) {
    // Newly public appearances in review whose artist someone follows: the
    // admin has the safety hold to confirm them, so tell them now (2026-11-06,
    // the Ayla event: a short name stays in review until confirmed).
    const seen = new Set(appearanceRows.filter((a) => a.visibleSince).map((a) => `${a.eventId}|${a.nameKey}`));
    const fresh = result.upserts.filter((u) => u.confidence === "review" && !u.removedAt && u.artistId && u.visibleSince && !seen.has(`${u.eventId}|${u.nameKey}`));
    const artistIds = [...new Set(fresh.map((u) => u.artistId!))];
    const followed = artistIds.length
      ? new Set(
          (
            await tx
              .selectDistinct({ artistId: alertFollows.artistId })
              .from(alertFollows)
              .where(and(inArray(alertFollows.artistId, artistIds), sql`${alertFollows.activeSince} IS NOT NULL`))
          ).map((r) => r.artistId),
        )
      : new Set<string>();
    const titles = new Map(publicEvents.map((e) => [e.id, e.title]));
    for (const u of fresh) {
      if (followed.has(u.artistId!)) followedReview.push({ eventId: u.eventId, eventTitle: titles.get(u.eventId) ?? u.eventId, displayName: u.displayName, reason: u.reason });
    }
    summary.followedReview = followedReview.length;
  }
  return summary;
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

export interface FollowableArtist {
  id: string;
  displayName: string;
  disambiguation: string | null;
  upcomingEvents: number;
}

/**
 * Everyone who can be followed: identities seen as performers (not
 * excluded or rejected), plus verified ones. Requested artists are not
 * listed publicly; only their requester sees them, on the manage page.
 * `upcomingEvents` counts the distinct public upcoming events the artist is
 * billed on as the site shows them — including appearances still in review
 * and those of identities merged into this one — not only the alertable ones.
 */
export async function listFollowableArtists(now: Date = new Date()): Promise<FollowableArtist[]> {
  const rows = await db.execute<{ id: string; display_name: string; disambiguation: string | null; upcoming: number }>(sql`
    SELECT a.id, a.display_name, a.disambiguation,
      COUNT(DISTINCT ea.event_id) FILTER (
        WHERE ea.confidence IN ('high', 'confirmed', 'review') AND ea.removed_at IS NULL
          AND e.published = true AND e.cancelled = false AND e.admin_unpublish_reason IS NULL AND e.source_cancelled_at IS NULL
          AND COALESCE(e.end_datetime, e.start_datetime + interval '1 day') > ${now}
      )::int AS upcoming
    FROM artists a
    LEFT JOIN artists m ON m.id = a.id OR m.merged_into_id = a.id
    LEFT JOIN event_artists ea ON ea.artist_id = m.id
    LEFT JOIN events e ON e.id = ea.event_id
    WHERE a.merged_into_id IS NULL AND a.status IN ('auto', 'verified')
    GROUP BY a.id
    HAVING a.status = 'verified' OR bool_or(ea.confidence IN ('high', 'confirmed', 'review'))
    ORDER BY a.display_name
  `);
  return rows.rows.map((r) => ({ id: r.id, displayName: r.display_name, disambiguation: r.disambiguation, upcomingEvents: Number(r.upcoming) }));
}
