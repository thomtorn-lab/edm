import { NextRequest, NextResponse } from "next/server";
import { getPublishedEventsWithVenue } from "@/lib/queries";
import { getIsoWeek } from "@/lib/newsletter/isoWeek";
import { selectUpcomingEventsForNewsletter } from "@/lib/newsletter/eventSelection";
import { buildUnsubscribeUrl } from "@/lib/newsletter/emailContent";
import { isNewsletterEnabled } from "@/lib/newsletter/featureFlag";
import { sendNewsletterEmail } from "@/lib/email";
import {
  claimPendingSends,
  getConfirmedSubscribers,
  markSendSent,
  markStaleUnconfirmedSends,
  queuePendingSendsForWeek,
} from "@/db/newsletter";

/** Per-claim batch size — well inside Resend's 10 req/sec rate limit even sent one at a time with no pacing, at any subscriber count this non-commercial, single-city site will realistically reach. */
const CLAIM_BATCH_SIZE = 25;
/** Hard ceiling on claim iterations per invocation — a safety bound, not a realistic expectation (guards against an unforeseen bug turning this into an infinite loop, never meant to be hit in normal operation). */
const MAX_BATCHES = 400;

/**
 * Weekly send entry point (newsletter MVP, 2026-10-05). Authenticated the
 * same way every existing sync endpoint already is (x-sync-token header
 * against SYNC_TRIGGER_TOKEN) — reuses the existing shared secret rather
 * than minting a new one, and reuses the exact same GitHub Actions
 * scheduled-trigger pattern (see send-newsletter.yml).
 *
 * Idempotent and safely re-invokable any number of times within the same
 * Europe/Copenhagen calendar week: queuePendingSendsForWeek only ever
 * inserts a row once per (subscriber, isoWeek) — a re-run after an
 * interruption, or a second DST-adjusted cron firing the same week (see
 * send-newsletter.yml), simply finds most rows already queued/claimed/sent
 * and continues from wherever the previous run left off.
 *
 * Gated on isNewsletterEnabled() as a second, independent safety layer on
 * top of send-newsletter.yml not (yet) carrying a `schedule` trigger —
 * even a manual or accidental workflow_dispatch can't actually send real
 * email while the feature flag is off.
 */
export async function POST(request: NextRequest) {
  const token = process.env.SYNC_TRIGGER_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "SYNC_TRIGGER_TOKEN is not configured." }, { status: 500 });
  }
  if (request.headers.get("x-sync-token") !== token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isNewsletterEnabled()) {
    return NextResponse.json({ error: "Newsletter sending is not yet enabled." }, { status: 503 });
  }

  const now = new Date();
  const isoWeek = getIsoWeek(now);

  const staleCount = await markStaleUnconfirmedSends(isoWeek);

  const [subscribers, publishedEvents] = await Promise.all([getConfirmedSubscribers(), getPublishedEventsWithVenue()]);
  const windowEvents = selectUpcomingEventsForNewsletter(publishedEvents, now);
  const { queued, skippedNoMatch } = await queuePendingSendsForWeek(isoWeek, subscribers, windowEvents);

  let sent = 0;
  let ambiguous = 0;
  let batches = 0;
  for (;;) {
    if (batches++ >= MAX_BATCHES) break;
    const claimed = await claimPendingSends(isoWeek, CLAIM_BATCH_SIZE);
    if (claimed.length === 0) break;
    for (const row of claimed) {
      const result = await sendNewsletterEmail({
        to: row.recipientEmail,
        subject: row.payloadSubject,
        html: row.payloadHtml,
        text: row.payloadText,
        idempotencyKey: row.idempotencyKey,
        listUnsubscribeUrl: buildUnsubscribeUrl(row.manageToken),
      });
      if (result.status === "sent") {
        await markSendSent(row.id, result.resendEmailId);
        sent++;
      } else {
        // Never marked failed — left claimed/unconfirmed for the next
        // invocation to retry with the same idempotencyKey (see
        // sendNewsletterEmail's own doc comment on why every non-success
        // outcome is treated identically here).
        ambiguous++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    isoWeek,
    subscribers: subscribers.length,
    queued,
    skippedNoMatch,
    staleUnconfirmedReclaimed: staleCount,
    sent,
    ambiguous,
  });
}
