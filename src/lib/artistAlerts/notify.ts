import type { NewRequestNotice, ResolvedRequest } from "@/db/artistAlerts";
import type { FollowedReviewAppearance } from "@/db/artistAppearances";
import { sendEmail } from "@/lib/email";
import { ARTIST_ALERTS_REPLY_TO, alertTiming, emailAllowed, type ArtistAlertsMode } from "./config";
import { buildAdminRequestEmail, buildAdminReviewEmail, buildRequestResultEmail } from "./emailContent";
import { manageTokenFor } from "./tokens";

/**
 * Emails around artist requests (2026-11-06). Failures are logged and never
 * undo the database change that caused them. No address is ever logged.
 */

/** One email to the site's inbox (CONTACT_RECIPIENT_EMAIL) per request that just got its first confirmed requester. */
export async function notifyAdminOfRequests(notices: NewRequestNotice[]): Promise<void> {
  if (notices.length === 0) return;
  const content = buildAdminRequestEmail({ requests: notices });
  try {
    await sendEmail({ subject: content.subject, text: content.text });
  } catch (err) {
    console.error("artist request admin notice failed:", err instanceof Error ? err.message : err);
  }
}

/** One result email to each confirmed requester; in test mode only to allowlisted addresses. */
export async function sendRequestResultEmails(result: ResolvedRequest, mode: ArtistAlertsMode): Promise<number> {
  let sent = 0;
  for (const r of result.recipients) {
    if (!emailAllowed(r.email, mode)) continue;
    const content = buildRequestResultEmail({ artistName: result.artistName, approved: result.outcome === "approved", manageToken: manageTokenFor(r.subscriberId) });
    try {
      await sendEmail({ to: r.email, subject: content.subject, text: content.text, replyTo: ARTIST_ALERTS_REPLY_TO });
      sent++;
    } catch (err) {
      console.error("artist request result email failed:", err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

/** One email to the site's inbox when followed artists' appearances become public in review — confirm within the hold, or they never alert. */
export async function notifyAdminOfFollowedReview(items: FollowedReviewAppearance[]): Promise<void> {
  if (items.length === 0) return;
  const content = buildAdminReviewEmail({ items, holdMinutes: Math.round(alertTiming().holdMs / 60_000) });
  try {
    await sendEmail({ subject: content.subject, text: content.text });
  } catch (err) {
    console.error("artist review admin notice failed:", err instanceof Error ? err.message : err);
  }
}
