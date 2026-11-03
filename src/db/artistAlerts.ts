import { randomUUID } from "node:crypto";
import { and, count, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "./client";
import { acquireSyncLock, releaseSyncLock } from "./sync";
import { alertDeliveries, alertEmails, alertFollows, alertSubscribers, artists, events, venues } from "./schema";
import { publicUpcomingEventCondition, reconcileArtistAppearances, type ReconcileSummary } from "./artistAppearances";
import { artistIdentityKey } from "../lib/artistIdentity/lineupIdentity";
import { cleanArtistDisplayName } from "../lib/enrichment/genreEnrichment";
import { ARTIST_ALERTS_CONSENT_VERSION, LIMITS, alertTiming, emailAllowed, type AlertTiming, type ArtistAlertsMode } from "../lib/artistAlerts/config";
import { generateToken, hashToken, manageTokenFor } from "../lib/artistAlerts/tokens";
import { buildAlertEmail, normalizeProfileUrl, unsubscribeUrl, type AlertEmailEvent } from "../lib/artistAlerts/emailContent";
import { planEmail } from "../lib/artistAlerts/planning";
import type { SendListEmailInput } from "../lib/email";
import type { SendNewsletterEmailResult } from "../lib/email";

/**
 * Artist Alerts persistence (2026-11-02): double opt-in, follows, artist
 * requests, delivery planning and sending. Kept apart from the newsletter.
 */

const FOLLOWABLE = ["auto", "verified"] as const;

export interface ArtistRequestInput {
  name: string;
  profileUrl?: string | null;
}

export interface SignupResult {
  /** Present when a confirmation email should be sent now. */
  confirmToken?: string;
  artistNames: string[];
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Resolves a requested name: an existing followable or requested artist with the same key, else a new "requested" one. */
async function resolveRequestedArtist(req: ArtistRequestInput, now: Date): Promise<{ id: string; displayName: string; requested: boolean } | null> {
  const displayName = cleanArtistDisplayName(req.name).slice(0, 80);
  const key = artistIdentityKey(displayName);
  if (key.length < 2) return null;
  const existing = await db
    .select({ id: artists.id, displayName: artists.displayName, status: artists.status })
    .from(artists)
    .where(and(eq(artists.nameKey, key), isNull(artists.mergedIntoId), inArray(artists.status, ["auto", "verified", "requested"])));
  const followable = existing.filter((a) => a.status !== "requested");
  if (followable.length === 1) return { id: followable[0].id, displayName: followable[0].displayName, requested: false };
  const requested = existing.find((a) => a.status === "requested");
  if (requested && followable.length === 0) return { id: requested.id, displayName: requested.displayName, requested: true };
  const id = `art_${randomUUID()}`;
  await db.insert(artists).values({ id, displayName, nameKey: key, status: "requested", profileUrl: normalizeProfileUrl(req.profileUrl), createdAt: now, updatedAt: now });
  return { id, displayName, requested: true };
}

async function addFollows(subscriberId: string, artistIds: string[], requests: ArtistRequestInput[], activeSince: Date | null, now: Date): Promise<string[]> {
  const [{ value: current }] = await db.select({ value: count() }).from(alertFollows).where(eq(alertFollows.subscriberId, subscriberId));
  let room = LIMITS.maxFollowsPerSubscriber - current;
  const names: string[] = [];
  const valid = artistIds.length
    ? await db
        .select({ id: artists.id, displayName: artists.displayName })
        .from(artists)
        .where(and(inArray(artists.id, artistIds.slice(0, LIMITS.maxFollowsPerSubscriber)), isNull(artists.mergedIntoId), inArray(artists.status, [...FOLLOWABLE])))
    : [];
  const toFollow: { id: string; displayName: string }[] = [...valid];
  let requestedCount = (
    await db
      .select({ value: count() })
      .from(alertFollows)
      .innerJoin(artists, eq(artists.id, alertFollows.artistId))
      .where(and(eq(alertFollows.subscriberId, subscriberId), eq(artists.status, "requested")))
  )[0].value;
  for (const req of requests.slice(0, LIMITS.maxPendingRequestsPerSubscriber)) {
    const resolved = await resolveRequestedArtist(req, now);
    if (!resolved) continue;
    if (resolved.requested) {
      if (requestedCount >= LIMITS.maxPendingRequestsPerSubscriber) continue;
      requestedCount++;
    }
    toFollow.push(resolved);
  }
  for (const a of toFollow) {
    if (room <= 0) break;
    const inserted = await db
      .insert(alertFollows)
      .values({ subscriberId, artistId: a.id, activeSince, createdAt: now })
      .onConflictDoNothing()
      .returning({ artistId: alertFollows.artistId });
    if (inserted.length > 0) room--;
    names.push(a.displayName);
  }
  return names;
}

/**
 * Public signup. Always answered with the same generic response by the
 * route, whatever happens here. New and existing addresses alike get a
 * confirmation email; nothing becomes active until it is confirmed, so
 * nobody can add artists to someone else's alerts without their inbox.
 * Returns no confirmToken when a rate limit applies.
 */
export async function requestArtistAlerts(
  input: { email: string; artistIds: string[]; requests: ArtistRequestInput[] },
  now: Date = new Date(),
): Promise<SignupResult> {
  const email = normalizeEmail(input.email);
  let [sub] = await db.select().from(alertSubscribers).where(eq(alertSubscribers.email, email)).limit(1);
  if (!sub) {
    const id = `sub_${randomUUID()}`;
    await db.insert(alertSubscribers).values({ id, email, status: "pending", manageTokenHash: hashToken(manageTokenFor(id)), createdAt: now }).onConflictDoNothing();
    [sub] = await db.select().from(alertSubscribers).where(eq(alertSubscribers.email, email)).limit(1);
  }
  const artistNames = await addFollows(sub.id, input.artistIds, input.requests, null, now);

  const windowStart = new Date(now.getTime() - 86_400_000);
  const sentToday = sub.lastConfirmEmailAt && sub.lastConfirmEmailAt > windowStart ? sub.confirmEmailsSent : 0;
  if (sentToday >= LIMITS.maxConfirmEmailsPerAddressPerDay) return { artistNames };
  const [{ value: lastHour }] = await db
    .select({ value: count() })
    .from(alertSubscribers)
    .where(gt(alertSubscribers.lastConfirmEmailAt, new Date(now.getTime() - 3_600_000)));
  if (lastHour >= LIMITS.maxConfirmEmailsPerHourGlobal) return { artistNames };

  const confirmToken = generateToken();
  await db
    .update(alertSubscribers)
    .set({ confirmTokenHash: hashToken(confirmToken), confirmEmailsSent: sentToday + 1, lastConfirmEmailAt: now })
    .where(eq(alertSubscribers.id, sub.id));
  return { confirmToken, artistNames };
}

/** Double opt-in (POST from the confirm page only). Activates every follow still waiting. Idempotent. */
export async function confirmArtistAlerts(confirmToken: string, now: Date = new Date()): Promise<{ manageToken: string } | null> {
  const [sub] = await db.select().from(alertSubscribers).where(eq(alertSubscribers.confirmTokenHash, hashToken(confirmToken))).limit(1);
  if (!sub) return null;
  await db.transaction(async (tx) => {
    if (sub.status !== "confirmed") {
      await tx.update(alertSubscribers).set({ status: "confirmed", confirmedAt: now, consentVersion: ARTIST_ALERTS_CONSENT_VERSION }).where(eq(alertSubscribers.id, sub.id));
    }
    await tx.update(alertFollows).set({ activeSince: now }).where(and(eq(alertFollows.subscriberId, sub.id), isNull(alertFollows.activeSince)));
  });
  return { manageToken: manageTokenFor(sub.id) };
}

async function subscriberByManageToken(manageToken: string) {
  const [sub] = await db.select().from(alertSubscribers).where(eq(alertSubscribers.manageTokenHash, hashToken(manageToken))).limit(1);
  return sub ?? null;
}

export interface ManageView {
  email: string;
  confirmed: boolean;
  follows: { artistId: string; displayName: string; state: "active" | "awaiting_confirmation" | "awaiting_verification" | "not_found" }[];
}

export async function getManageView(manageToken: string): Promise<ManageView | null> {
  const sub = await subscriberByManageToken(manageToken);
  if (!sub) return null;
  const rows = await db
    .select({ artistId: artists.id, displayName: artists.displayName, status: artists.status, activeSince: alertFollows.activeSince })
    .from(alertFollows)
    .innerJoin(artists, eq(artists.id, alertFollows.artistId))
    .where(eq(alertFollows.subscriberId, sub.id))
    .orderBy(artists.displayName);
  return {
    email: sub.email,
    confirmed: sub.status === "confirmed",
    follows: rows.map((r) => ({
      artistId: r.artistId,
      displayName: r.displayName,
      state: r.status === "rejected" ? "not_found" : r.status === "requested" ? "awaiting_verification" : r.activeSince ? "active" : "awaiting_confirmation",
    })),
  };
}

/** Manage page: the link itself proves inbox ownership, so changes take effect at once. */
export async function updateFollowsByManageToken(
  manageToken: string,
  change: { add: string[]; remove: string[]; requests: ArtistRequestInput[] },
  now: Date = new Date(),
): Promise<boolean> {
  const sub = await subscriberByManageToken(manageToken);
  if (!sub || sub.status !== "confirmed") return false;
  if (change.remove.length) {
    await db.delete(alertFollows).where(and(eq(alertFollows.subscriberId, sub.id), inArray(alertFollows.artistId, change.remove)));
  }
  await addFollows(sub.id, change.add, change.requests, now, now);
  return true;
}

/** Immediate erasure: follows, deliveries and emails cascade with the row. */
export async function unsubscribeArtistAlerts(manageToken: string): Promise<boolean> {
  const rows = await db.delete(alertSubscribers).where(eq(alertSubscribers.manageTokenHash, hashToken(manageToken))).returning({ id: alertSubscribers.id });
  return rows.length > 0;
}

/** Admin: resolve a requested artist. Follows start counting from now, so no historical alerts. */
export async function resolveRequestedArtist_admin(artistId: string, action: { verify: true } | { linkTo: string } | { reject: true }, now: Date = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(artists).where(and(eq(artists.id, artistId), eq(artists.status, "requested"))).limit(1);
    if (!a) return false;
    if ("verify" in action) {
      await tx.update(artists).set({ status: "verified", updatedAt: now }).where(eq(artists.id, artistId));
      // Confirmed follows start counting from now; unconfirmed ones stay unconfirmed.
      await tx.update(alertFollows).set({ activeSince: now }).where(and(eq(alertFollows.artistId, artistId), sql`${alertFollows.activeSince} IS NOT NULL`));
    } else if ("linkTo" in action) {
      const [target] = await tx.select().from(artists).where(and(eq(artists.id, action.linkTo), inArray(artists.status, [...FOLLOWABLE]))).limit(1);
      if (!target) return false;
      const followers = await tx.select().from(alertFollows).where(eq(alertFollows.artistId, artistId));
      for (const f of followers) {
        await tx
          .insert(alertFollows)
          .values({ subscriberId: f.subscriberId, artistId: target.id, activeSince: f.activeSince ? now : null, createdAt: now })
          .onConflictDoNothing();
      }
      await tx.delete(alertFollows).where(eq(alertFollows.artistId, artistId));
      await tx.update(artists).set({ mergedIntoId: target.id, status: "rejected", updatedAt: now }).where(eq(artists.id, artistId));
    } else {
      await tx.update(artists).set({ status: "rejected", updatedAt: now }).where(eq(artists.id, artistId));
    }
    return true;
  });
}

export async function listRequestedArtists() {
  return db
    .select({ id: artists.id, displayName: artists.displayName, profileUrl: artists.profileUrl, createdAt: artists.createdAt, followers: count(alertFollows.subscriberId) })
    .from(artists)
    .leftJoin(alertFollows, eq(alertFollows.artistId, artists.id))
    .where(eq(artists.status, "requested"))
    .groupBy(artists.id)
    .orderBy(artists.createdAt);
}

// ---------------------------------------------------------------------------
// The scheduled run: reconcile -> plan deliveries -> send -> retention
// ---------------------------------------------------------------------------

/**
 * Creates one pending delivery per (subscriber, event) for every followed
 * appearance that became publicly visible after the follow started, was
 * confirmed within the safety hold, and whose hold has passed. The primary
 * key makes this a no-op for anything already delivered or dropped.
 */
export async function planDeliveries(now: Date, timing: AlertTiming): Promise<number> {
  const holdSeconds = Math.round(timing.holdMs / 1000);
  const minLead = new Date(now.getTime() + timing.minLeadMs);
  const result = await db.execute(sql`
    INSERT INTO alert_deliveries (subscriber_id, event_id, artist_id, status, created_at)
    SELECT DISTINCT ON (f.subscriber_id, ea.event_id) f.subscriber_id, ea.event_id, ea.artist_id, 'pending', ${now}
    FROM event_artists ea
    JOIN artists a ON a.id = ea.artist_id AND a.status IN ('auto', 'verified') AND a.merged_into_id IS NULL
    JOIN alert_follows f ON f.artist_id = ea.artist_id AND f.active_since IS NOT NULL
    JOIN alert_subscribers s ON s.id = f.subscriber_id AND s.status = 'confirmed'
    JOIN events e ON e.id = ea.event_id
    WHERE ea.confidence IN ('high', 'confirmed')
      AND ea.removed_at IS NULL
      AND ea.visible_since IS NOT NULL
      AND ea.confirmed_at IS NOT NULL
      AND ea.visible_since >= f.active_since
      AND ea.confirmed_at <= ea.visible_since + make_interval(secs => ${holdSeconds})
      AND ea.visible_since + make_interval(secs => ${holdSeconds}) <= ${now}
      AND e.published = true AND e.cancelled = false AND e.admin_unpublish_reason IS NULL AND e.source_cancelled_at IS NULL
      AND e.start_datetime > ${minLead}
    ORDER BY f.subscriber_id, ea.event_id, ea.visible_since
    ON CONFLICT (subscriber_id, event_id) DO NOTHING
  `);
  return result.rowCount ?? 0;
}

export type Sender = (input: SendListEmailInput) => Promise<SendNewsletterEmailResult>;

const STALE_WINDOW_MS = 23 * 3_600_000;

async function sendEmailRow(row: typeof alertEmails.$inferSelect, send: Sender, now: Date): Promise<"sent" | "ambiguous" | "gone"> {
  // Unsubscribe-safety: the cascade may have removed the row since it was read.
  const [still] = await db.select({ id: alertEmails.id }).from(alertEmails).where(and(eq(alertEmails.id, row.id), eq(alertEmails.status, "pending"))).limit(1);
  if (!still) return "gone";
  if (!row.firstAttemptAt) await db.update(alertEmails).set({ firstAttemptAt: now }).where(eq(alertEmails.id, row.id));
  const result = await send({
    to: row.recipientEmail,
    subject: row.subject,
    html: row.html,
    text: row.textBody,
    idempotencyKey: row.idempotencyKey,
    listUnsubscribeUrl: unsubscribeUrl(manageTokenFor(row.subscriberId)),
  });
  if (result.status === "sent") {
    await db.update(alertEmails).set({ status: "sent", sentAt: now, resendEmailId: result.resendEmailId }).where(eq(alertEmails.id, row.id));
    return "sent";
  }
  return "ambiguous";
}

export interface SendSummary {
  retried: number;
  emailsSent: number;
  ambiguous: number;
  deliveriesEmailed: number;
  deliveriesDropped: number;
  staleUnconfirmed: number;
}

export async function sendPendingAlerts(now: Date, timing: AlertTiming, mode: ArtistAlertsMode, send: Sender): Promise<SendSummary> {
  const summary: SendSummary = { retried: 0, emailsSent: 0, ambiguous: 0, deliveriesEmailed: 0, deliveriesDropped: 0, staleUnconfirmed: 0 };

  // 1. Retry emails that were built but not confirmed sent, within Resend's idempotency window.
  const stale = await db
    .update(alertEmails)
    .set({ status: "stale_unconfirmed" })
    .where(and(eq(alertEmails.status, "pending"), lt(alertEmails.firstAttemptAt, new Date(now.getTime() - STALE_WINDOW_MS))))
    .returning({ id: alertEmails.id });
  summary.staleUnconfirmed = stale.length;
  for (const row of await db.select().from(alertEmails).where(eq(alertEmails.status, "pending"))) {
    if (!emailAllowed(row.recipientEmail, mode)) continue;
    summary.retried++;
    const r = await sendEmailRow(row, send, now);
    if (r === "sent") summary.emailsSent++;
    else if (r === "ambiguous") summary.ambiguous++;
  }

  // 2. Compose at most one new email per subscriber from their pending deliveries.
  const pending = await db
    .select({
      subscriberId: alertDeliveries.subscriberId,
      eventId: alertDeliveries.eventId,
      artistId: alertDeliveries.artistId,
      createdAt: alertDeliveries.createdAt,
      email: alertSubscribers.email,
      title: events.title,
      slug: events.slug,
      startDatetime: events.startDatetime,
      venueName: venues.name,
      eventPublic: sql<boolean>`(${publicUpcomingEventCondition(now)})`,
      artistName: artists.displayName,
      appearanceAlertable: sql<boolean>`EXISTS (SELECT 1 FROM event_artists ea WHERE ea.event_id = ${alertDeliveries.eventId} AND ea.artist_id = ${alertDeliveries.artistId} AND ea.removed_at IS NULL AND ea.confidence IN ('high', 'confirmed'))`,
    })
    .from(alertDeliveries)
    .innerJoin(alertSubscribers, eq(alertSubscribers.id, alertDeliveries.subscriberId))
    .innerJoin(events, eq(events.id, alertDeliveries.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(artists, eq(artists.id, alertDeliveries.artistId))
    .where(eq(alertDeliveries.status, "pending"));

  const bySubscriber = new Map<string, typeof pending>();
  for (const p of pending) {
    if (!bySubscriber.has(p.subscriberId)) bySubscriber.set(p.subscriberId, []);
    bySubscriber.get(p.subscriberId)!.push(p);
  }

  for (const [subscriberId, rows] of bySubscriber) {
    const recipient = rows[0].email;
    if (!emailAllowed(recipient, mode)) continue;
    const [{ value: recentEmails }] = await db
      .select({ value: count() })
      .from(alertEmails)
      .where(and(eq(alertEmails.subscriberId, subscriberId), gt(alertEmails.createdAt, new Date(now.getTime() - 86_400_000))));
    const plan = planEmail(rows, recentEmails, now, timing);

    if (plan.drop.length) {
      await db
        .update(alertDeliveries)
        .set({ status: "dropped" })
        .where(and(eq(alertDeliveries.subscriberId, subscriberId), inArray(alertDeliveries.eventId, plan.drop), eq(alertDeliveries.status, "pending")));
      summary.deliveriesDropped += plan.drop.length;
    }
    if (plan.send.length === 0) continue;

    const chosen = plan.send.map((id) => rows.find((r) => r.eventId === id)!);
    const content = buildAlertEmail({
      events: chosen.map<AlertEmailEvent>((r) => ({ artistName: r.artistName, title: r.title, slug: r.slug, startDatetime: r.startDatetime, venueName: r.venueName })),
      manageToken: manageTokenFor(subscriberId),
    });
    const emailId = `aem_${randomUUID()}`;
    const created = await db.transaction(async (tx) => {
      const claimed = await tx
        .update(alertDeliveries)
        .set({ status: "emailed", emailId })
        .where(and(eq(alertDeliveries.subscriberId, subscriberId), inArray(alertDeliveries.eventId, plan.send), eq(alertDeliveries.status, "pending")))
        .returning({ eventId: alertDeliveries.eventId });
      if (claimed.length !== plan.send.length) {
        tx.rollback();
      }
      await tx.insert(alertEmails).values({
        id: emailId,
        subscriberId,
        status: "pending",
        recipientEmail: recipient,
        subject: content.subject,
        html: content.html,
        textBody: content.text,
        idempotencyKey: `artist-alert:${emailId}`,
        createdAt: now,
      });
      return true;
    }).catch(() => false);
    if (!created) continue;
    summary.deliveriesEmailed += plan.send.length;
    const [row] = await db.select().from(alertEmails).where(eq(alertEmails.id, emailId)).limit(1);
    const r = await sendEmailRow(row, send, now);
    if (r === "sent") summary.emailsSent++;
    else if (r === "ambiguous") summary.ambiguous++;
  }
  return summary;
}

/** Storage limitation: unconfirmed signups and unconfirmed follows after 7 days, delivery history after 30. */
export async function sweepArtistAlertsRetention(now: Date = new Date()): Promise<{ subscribers: number; follows: number; deliveries: number; emails: number }> {
  const unconfirmedBefore = new Date(now.getTime() - LIMITS.unconfirmedRetentionMs);
  const historyBefore = new Date(now.getTime() - LIMITS.historyRetentionMs);
  const subscribers = await db
    .delete(alertSubscribers)
    .where(and(eq(alertSubscribers.status, "pending"), lt(alertSubscribers.createdAt, unconfirmedBefore)))
    .returning({ id: alertSubscribers.id });
  const follows = await db
    .delete(alertFollows)
    .where(and(isNull(alertFollows.activeSince), lt(alertFollows.createdAt, unconfirmedBefore)))
    .returning({ id: alertFollows.subscriberId });
  const deliveries = await db
    .delete(alertDeliveries)
    .where(
      and(
        lt(alertDeliveries.createdAt, historyBefore),
        sql`NOT EXISTS (SELECT 1 FROM events e WHERE e.id = ${alertDeliveries.eventId} AND e.start_datetime > ${now})`,
      ),
    )
    .returning({ id: alertDeliveries.eventId });
  const emails = await db
    .delete(alertEmails)
    .where(and(lt(alertEmails.createdAt, historyBefore), or(eq(alertEmails.status, "sent"), eq(alertEmails.status, "stale_unconfirmed"))))
    .returning({ id: alertEmails.id });
  return { subscribers: subscribers.length, follows: follows.length, deliveries: deliveries.length, emails: emails.length };
}

export interface RunSummary {
  mode: ArtistAlertsMode;
  skipped?: "off" | "locked";
  reconcile?: ReconcileSummary;
  deliveriesPlanned?: number;
  send?: SendSummary;
  retention?: Awaited<ReturnType<typeof sweepArtistAlertsRetention>>;
}

/** The whole scheduled run, under one lease so overlapping triggers never double-send. Counts only — never an email address. */
export async function runArtistAlerts(mode: ArtistAlertsMode, send: Sender, now: Date = new Date()): Promise<RunSummary> {
  if (mode === "off") return { mode, skipped: "off" };
  // observe: lineup reconciliation only — it writes nothing but artists and
  // event_artists, holds no lease row, and touches no subscriber table.
  if (mode === "observe") return { mode, reconcile: await reconcileArtistAppearances(now) };
  const lock = await acquireSyncLock("artist-alerts");
  if (!lock) return { mode, skipped: "locked" };
  try {
    const reconcile = await reconcileArtistAppearances(now);
    const summary: RunSummary = { mode, reconcile, retention: await sweepArtistAlertsRetention(now) };
    if (mode === "test" || mode === "live") {
      const timing = alertTiming();
      summary.deliveriesPlanned = await planDeliveries(now, timing);
      summary.send = await sendPendingAlerts(now, timing, mode, send);
    }
    return summary;
  } finally {
    await releaseSyncLock("artist-alerts", lock);
  }
}
