import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "./client";
import { newsletterSends, newsletterSubscribers } from "./schema";
import { generateNewsletterToken } from "../lib/newsletter/tokens";
import { MAIN_GENRES, type MainGenreSlug } from "../lib/taxonomy";
import type { EventWithVenue } from "../lib/queries";
import { selectEventsForSubscriber } from "../lib/newsletter/eventSelection";
import { buildNewsletterEmail } from "../lib/newsletter/emailContent";

const VALID_MAIN_GENRES = new Set<string>(MAIN_GENRES.map((g) => g.slug));

/** Defensive allowlist filter — drops anything that isn't one of the 12 known MainGenreSlug values rather than trusting raw request input. */
export function sanitizeGenreSelection(input: unknown): MainGenreSlug[] {
  if (!Array.isArray(input)) return [];
  const result: MainGenreSlug[] = [];
  const seen = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string" || !VALID_MAIN_GENRES.has(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value as MainGenreSlug);
  }
  return result;
}

export interface NewsletterSubscriberRecord {
  id: string;
  email: string;
  genres: MainGenreSlug[];
  confirmed: boolean;
  manageToken: string;
}

/**
 * Creates a pending (unconfirmed) subscriber, or — if this email already
 * has a row — reuses it rather than creating a duplicate. Always returns a
 * confirmToken so the caller can (re)send the confirmation email, but
 * never reveals via a DIFFERENT response shape whether the email was
 * already subscribed (the API route always replies with the same generic
 * "check your email" message either way — see
 * app/api/newsletter/subscribe/route.ts — so this function's job is just
 * "make sure a usable confirm link exists", not to signal novelty).
 * Returns null only when the email is already a CONFIRMED subscriber —
 * the route treats that as "already subscribed, don't re-send a
 * confirmation email" while still replying with the same generic message.
 */
export async function requestSubscription(email: string): Promise<{ confirmToken: string } | null> {
  const existing = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.email, email)).limit(1);
  if (existing[0]) {
    return existing[0].confirmed ? null : { confirmToken: existing[0].confirmToken };
  }

  const confirmToken = generateNewsletterToken();
  const manageToken = generateNewsletterToken();
  try {
    await db.insert(newsletterSubscribers).values({
      id: randomUUID(),
      email,
      genres: [],
      confirmed: false,
      confirmToken,
      manageToken,
    });
  } catch (err) {
    // A concurrent duplicate signup for the same email (race between the
    // select above and this insert) hits the unique(email) constraint —
    // fall back to the now-existing row rather than erroring the request.
    const row = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.email, email)).limit(1);
    if (!row[0]) throw err;
    return row[0].confirmed ? null : { confirmToken: row[0].confirmToken };
  }
  return { confirmToken };
}

/** Flips a subscriber confirmed (idempotent — re-confirming an already-confirmed token just returns its existing manageToken). Returns null for an unrecognized token. */
export async function confirmSubscriberByToken(confirmToken: string): Promise<{ manageToken: string } | null> {
  const rows = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.confirmToken, confirmToken)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (!row.confirmed) {
    await db
      .update(newsletterSubscribers)
      .set({ confirmed: true, confirmedAt: new Date() })
      .where(eq(newsletterSubscribers.id, row.id));
  }
  return { manageToken: row.manageToken };
}

export async function getSubscriberByManageToken(manageToken: string): Promise<NewsletterSubscriberRecord | null> {
  const rows = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.manageToken, manageToken)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, genres: row.genres as MainGenreSlug[], confirmed: row.confirmed, manageToken: row.manageToken };
}

export async function updateSubscriberGenres(manageToken: string, genres: MainGenreSlug[]): Promise<boolean> {
  const result = await db
    .update(newsletterSubscribers)
    .set({ genres })
    .where(eq(newsletterSubscribers.manageToken, manageToken))
    .returning({ id: newsletterSubscribers.id });
  return result.length > 0;
}

/**
 * Immediate, no-login unsubscribe — a single DELETE. `newsletter_sends.
 * subscriberId` has `onDelete: "cascade"` (see schema.ts's own doc comment
 * on that FK), so this atomically removes every one of their send rows —
 * pending, in-flight, or already sent — in the same statement. There is no
 * window in which a queued-but-not-yet-sent row can survive this call and
 * later be picked up by the claim query (delivery-safety requirement 19).
 */
export async function unsubscribeByManageToken(manageToken: string): Promise<boolean> {
  const result = await db
    .delete(newsletterSubscribers)
    .where(eq(newsletterSubscribers.manageToken, manageToken))
    .returning({ id: newsletterSubscribers.id });
  return result.length > 0;
}

export async function getConfirmedSubscribers(): Promise<NewsletterSubscriberRecord[]> {
  const rows = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.confirmed, true));
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    genres: row.genres as MainGenreSlug[],
    confirmed: row.confirmed,
    manageToken: row.manageToken,
  }));
}

/**
 * Queues this week's send rows for every confirmed subscriber — one row
 * each, content snapshotted NOW and never recomputed (see
 * schema.ts's own doc comment on newsletter_sends for why: a retry must
 * always resend exactly what was originally queued, even if the
 * underlying event data changes in between). `ON CONFLICT DO NOTHING` on
 * (isoWeek, subscriberId) makes this safe to call more than once for the
 * same week (e.g. a re-triggered workflow run) — already-queued
 * subscribers are simply skipped, never re-queued with fresh (and
 * therefore different) content.
 *
 * A subscriber with zero matching events this week still gets a row —
 * status 'skipped_no_match', no payload, no Resend call ever made for it
 * — so a re-run doesn't recompute their (empty) match set every time.
 */
export async function queuePendingSendsForWeek(
  isoWeek: string,
  subscribers: NewsletterSubscriberRecord[],
  windowEvents: EventWithVenue[],
): Promise<{ queued: number; skippedNoMatch: number }> {
  let queued = 0;
  let skippedNoMatch = 0;
  for (const subscriber of subscribers) {
    const events = selectEventsForSubscriber(windowEvents, subscriber.genres);
    const idempotencyKey = `newsletter:${subscriber.id}:${isoWeek}`;
    if (events.length === 0) {
      const result = await db
        .insert(newsletterSends)
        .values({
          id: randomUUID(),
          isoWeek,
          subscriberId: subscriber.id,
          status: "skipped_no_match",
          recipientEmail: subscriber.email,
          manageToken: subscriber.manageToken,
          eventCount: 0,
          idempotencyKey,
        })
        .onConflictDoNothing({ target: [newsletterSends.isoWeek, newsletterSends.subscriberId] })
        .returning({ id: newsletterSends.id });
      if (result.length > 0) skippedNoMatch++;
      continue;
    }
    const content = buildNewsletterEmail({ genres: subscriber.genres, events, manageToken: subscriber.manageToken });
    const result = await db
      .insert(newsletterSends)
      .values({
        id: randomUUID(),
        isoWeek,
        subscriberId: subscriber.id,
        status: "pending",
        recipientEmail: subscriber.email,
        manageToken: subscriber.manageToken,
        payloadSubject: content.subject,
        payloadHtml: content.html,
        payloadText: content.text,
        eventCount: events.length,
        idempotencyKey,
      })
      .onConflictDoNothing({ target: [newsletterSends.isoWeek, newsletterSends.subscriberId] })
      .returning({ id: newsletterSends.id });
    if (result.length > 0) queued++;
  }
  return { queued, skippedNoMatch };
}

/** How long a 'sending' row can go unconfirmed before a crashed/interrupted worker's claim is considered abandoned and eligible for another worker to pick up. Deliberately short — a healthy send completes in well under a second. */
const RECLAIM_WINDOW_MS = 15 * 60 * 1000;

/**
 * Resend's idempotency-key dedup window is 24h, anchored to the row's
 * FIRST attempt (firstAttemptAt — see schema.ts). Leaves a 1h safety
 * margin: past this point, blindly reusing the same key is no longer
 * provably safe (we'd genuinely be sending a brand-new, unguarded
 * request), so instead of ever risking a silent duplicate, the row is
 * marked 'stale_unconfirmed' and excluded from all future automated
 * claims — it needs a human to check Resend's own logs for that
 * recipient/time window before being cleared manually. This should be
 * vanishingly rare: it only happens if the whole pipeline (not just one
 * attempt) is unavailable for the better part of a day.
 */
const STALE_WINDOW_MS = 23 * 60 * 60 * 1000;

/** Call once per send-job run, BEFORE claiming — moves any row that's been unconfirmed past the safety window out of the claimable set for good. */
export async function markStaleUnconfirmedSends(isoWeek: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_WINDOW_MS);
  const result = await db
    .update(newsletterSends)
    .set({ status: "stale_unconfirmed" })
    .where(
      and(
        eq(newsletterSends.isoWeek, isoWeek),
        eq(newsletterSends.status, "sending"),
        lt(newsletterSends.firstAttemptAt, cutoff),
      ),
    )
    .returning({ id: newsletterSends.id });
  return result.length;
}

export interface ClaimedSend {
  id: string;
  subscriberId: string;
  recipientEmail: string;
  manageToken: string;
  payloadSubject: string;
  payloadHtml: string;
  payloadText: string;
  idempotencyKey: string;
}

/**
 * Atomically claims up to `limit` sendable rows for this week — 'pending'
 * rows, plus 'sending' rows whose claim has gone stale (RECLAIM_WINDOW_MS)
 * suggesting the worker that claimed them crashed/was interrupted.
 *
 * `UNIQUE(isoWeek, subscriberId)` alone does NOT stop two parallel workers
 * from both reading the same not-yet-sent row and both attempting to send
 * it — that constraint only prevents a subscriber being QUEUED twice, not
 * two workers racing over the SAME already-queued row. The actual
 * concurrency guard here is `FOR UPDATE SKIP LOCKED`: Postgres gives each
 * concurrent transaction a disjoint set of rows — one worker's claim can
 * never overlap another's — which is why this is raw SQL rather than the
 * query builder (no portable way to express SKIP LOCKED through it). This
 * is the same proven idea as sync_locks' lease pattern (acquire with an
 * expiry, reclaim only once it's past that expiry), applied per-row
 * instead of per-source so a large fan-out job can resume granularly
 * instead of needing one all-or-nothing lock.
 */
export async function claimPendingSends(isoWeek: string, limit: number): Promise<ClaimedSend[]> {
  const result = await db.execute<{
    id: string;
    subscriber_id: string;
    recipient_email: string;
    manage_token: string;
    payload_subject: string;
    payload_html: string;
    payload_text: string;
    idempotency_key: string;
  }>(sql`
    UPDATE newsletter_sends
    SET status = 'sending',
        claimed_at = now(),
        first_attempt_at = COALESCE(first_attempt_at, now())
    WHERE id IN (
      SELECT id FROM newsletter_sends
      WHERE iso_week = ${isoWeek}
        AND (
          status = 'pending'
          OR (status = 'sending' AND claimed_at < now() - (${RECLAIM_WINDOW_MS} * interval '1 millisecond'))
        )
      ORDER BY id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, subscriber_id, recipient_email, manage_token, payload_subject, payload_html, payload_text, idempotency_key
  `);
  return result.rows.map((row) => ({
    id: row.id,
    subscriberId: row.subscriber_id,
    recipientEmail: row.recipient_email,
    manageToken: row.manage_token,
    payloadSubject: row.payload_subject,
    payloadHtml: row.payload_html,
    payloadText: row.payload_text,
    idempotencyKey: row.idempotency_key,
  }));
}

/**
 * Narrows (but cannot fully close) the gap between claiming a row and
 * actually calling Resend for it (unsubscribe-safety review, 2026-10-05):
 * `claimPendingSends` returns a batch of rows that the caller then sends
 * one at a time, in a loop that can take a real amount of wall-clock time
 * for a large batch. If the subscriber unsubscribes in that window, the
 * cascade delete removes their `newsletter_sends` row, but the CALLER
 * already has the claimed data sitting in memory and would otherwise send
 * it anyway, never knowing the row is gone. Calling this immediately
 * before the Resend call shrinks that window from "the rest of the batch
 * loop" down to one indexed SELECT's round-trip — the smallest window
 * technically achievable without coupling to Resend's own transaction,
 * which is impossible since it's an external HTTP service. This does NOT
 * close the window entirely: an unsubscribe that lands in the few
 * milliseconds between this check and the Resend call still can't be
 * caught — that remaining gap is a genuine, unavoidable boundary once
 * Resend has already accepted the request (see the send route's own doc
 * comment and the delivery report for why it can't be closed further).
 */
export async function isSendStillClaimable(sendId: string): Promise<boolean> {
  const rows = await db
    .select({ id: newsletterSends.id })
    .from(newsletterSends)
    .where(and(eq(newsletterSends.id, sendId), eq(newsletterSends.status, "sending")))
    .limit(1);
  return rows.length > 0;
}

export async function markSendSent(sendId: string, resendEmailId: string): Promise<void> {
  await db
    .update(newsletterSends)
    .set({ status: "sent", sentAt: new Date(), resendEmailId })
    .where(eq(newsletterSends.id, sendId));
}

/** Debug/ops helper — how many rows remain claimable for this week (used by the send route's response, not by the claim loop itself). */
export async function countRemainingSends(isoWeek: string): Promise<number> {
  const rows = await db
    .select({ id: newsletterSends.id })
    .from(newsletterSends)
    .where(and(eq(newsletterSends.isoWeek, isoWeek), inArray(newsletterSends.status, ["pending", "sending"])));
  return rows.length;
}

/**
 * Minimal retention window for RESOLVED newsletter_sends rows (GDPR storage-
 * limitation audit, 2026-10-06). Each row snapshots personal data — a
 * recipient email address, that subscriber's manageToken, and the full
 * rendered HTML/text of the email they were sent — none of which serves any
 * purpose once the send has reached a terminal state. 30 days is enough to
 * debug a delivery problem (cross-check against Resend's own dashboard/logs
 * for that window) without keeping personal data around indefinitely. Only
 * terminal statuses are eligible — 'pending'/'sending' rows are still active
 * work for the current week and are never touched here regardless of age.
 */
const SEND_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Call once per send-job run — deletes newsletter_sends rows that reached a terminal state ('sent' | 'skipped_no_match' | 'stale_unconfirmed') more than SEND_HISTORY_RETENTION_MS ago. See that constant's doc comment for why 30 days. */
export async function deleteOldNewsletterSends(): Promise<number> {
  const cutoff = new Date(Date.now() - SEND_HISTORY_RETENTION_MS);
  const result = await db
    .delete(newsletterSends)
    .where(
      and(
        inArray(newsletterSends.status, ["sent", "skipped_no_match", "stale_unconfirmed"]),
        lt(newsletterSends.queuedAt, cutoff),
      ),
    )
    .returning({ id: newsletterSends.id });
  return result.length;
}

/**
 * Minimal retention window for a signup that never completed double opt-in
 * (GDPR storage-limitation audit, 2026-10-06). An unconfirmed row's email
 * address and confirmToken serve no purpose once nobody has clicked the
 * confirmation link within a reasonable window — this is also how an unused
 * confirmToken itself gets deleted (it lives on this same row, not a
 * separate table). 30 days is ample time for a genuine subscriber to
 * confirm; getConfirmedSubscribers already excludes unconfirmed rows from
 * every send, so deleting one here never touches an active subscription.
 */
const UNCONFIRMED_SUBSCRIBER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Call once per send-job run — deletes newsletter_subscribers rows that are still unconfirmed more than UNCONFIRMED_SUBSCRIBER_RETENTION_MS after signup. Never touches a confirmed subscriber (unsubscribeByManageToken is the only path that deletes one of those). */
export async function deleteExpiredUnconfirmedSubscribers(): Promise<number> {
  const cutoff = new Date(Date.now() - UNCONFIRMED_SUBSCRIBER_RETENTION_MS);
  const result = await db
    .delete(newsletterSubscribers)
    .where(and(eq(newsletterSubscribers.confirmed, false), lt(newsletterSubscribers.createdAt, cutoff)))
    .returning({ id: newsletterSubscribers.id });
  return result.length;
}
