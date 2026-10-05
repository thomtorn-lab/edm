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
  isSendStillClaimable,
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
 *
 * Unsubscribe-safety boundary (unsubscribe-safety review, 2026-10-05):
 * isSendStillClaimable is checked immediately before every Resend call, so
 * an unsubscribe that cascades a row away is caught right up until the
 * instant the external request is made. What this cannot catch — and
 * nothing in this codebase can, since Resend is an external HTTP service
 * with no transactional coupling to our database — is an unsubscribe that
 * lands in the few milliseconds between that check and Resend accepting
 * the request. Once Resend has accepted it, the email is out of our
 * control entirely; Resend has no "cancel an already-accepted transactional
 * send" API. This is a genuine, structural boundary, not a bug to fix.
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
  let skippedUnsubscribed = 0;
  let batches = 0;
  for (;;) {
    if (batches++ >= MAX_BATCHES) break;
    const claimed = await claimPendingSends(isoWeek, CLAIM_BATCH_SIZE);
    if (claimed.length === 0) break;
    for (const row of claimed) {
      // Unsubscribe-safety (2026-10-05): a batch can take real wall-clock
      // time to work through, so re-check right before the external call
      // that an unsubscribe hasn't cascaded this row away since it was
      // claimed. Shrinks the unsafe window to one indexed SELECT — see
      // isSendStillClaimable's own doc comment for why it can't close
      // entirely.
      if (!(await isSendStillClaimable(row.id))) {
        skippedUnsubscribed++;
        continue;
      }
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
    skippedUnsubscribed,
  });
}
