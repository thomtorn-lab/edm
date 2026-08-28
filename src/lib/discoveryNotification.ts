import { sendEmail } from "./email";
import { getGenre } from "./taxonomy";
import type { ConfidenceLevel } from "./types";
import type { GenreSlug } from "./taxonomy";

/**
 * Fields available on a freshly-inserted discovery_queue row, sufficient to
 * compose the notification without a second DB read.
 */
export type DiscoveryQueueNotificationItem = {
  id: string;
  probableTitle: string;
  probableStart: Date | null;
  probableVenueName: string | null;
  sourceName: string;
  sourceUrl: string;
  predictedGenre: GenreSlug | null;
  genreConfidence: ConfidenceLevel;
  overallConfidence: ConfidenceLevel;
  missingFields: string[];
};

const ADMIN_DISCOVERY_QUEUE_URL = "https://electroniccph.com/admin#discovery-queue";

function formatStart(start: Date | null): string {
  if (!start) return "Unknown";
  return start.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Copenhagen",
  });
}

function buildBody(item: DiscoveryQueueNotificationItem): string {
  const genreLabel = item.predictedGenre ? (getGenre(item.predictedGenre)?.label ?? item.predictedGenre) : "Unknown";
  const lines = [
    `Event title: ${item.probableTitle}`,
    `Date/start time: ${formatStart(item.probableStart)}`,
    `Venue name: ${item.probableVenueName ?? "Unknown"}`,
    `Source: ${item.sourceName}`,
    `Predicted genre: ${genreLabel}`,
    `Genre confidence: ${item.genreConfidence}`,
    `Overall confidence: ${item.overallConfidence}`,
    `Missing fields: ${item.missingFields.length > 0 ? item.missingFields.join(", ") : "None"}`,
    `Source URL: ${item.sourceUrl}`,
    ``,
    `Review in Admin: ${ADMIN_DISCOVERY_QUEUE_URL}`,
  ];
  return lines.join("\n");
}

/**
 * Fires exactly once per genuinely-new discovery_queue row, immediately
 * after its insert commits (see insertDiscoveryItem in db/writes.ts) — never
 * on updates to an existing pending row. Never throws: a notification
 * failure must not affect the caller, since ingestion succeeding is what
 * matters, not the email.
 */
export async function notifyDiscoveryQueueInsert(item: DiscoveryQueueNotificationItem): Promise<void> {
  const to = process.env.DISCOVERY_QUEUE_NOTIFICATION_EMAIL;
  if (!to) return;

  try {
    await sendEmail({
      subject: `Electronic CPH: New Discovery Queue event — ${item.probableTitle}`,
      text: buildBody(item),
      to,
    });
  } catch (err) {
    console.error(
      `discoveryNotification: send failed for discovery_queue row ${item.id}`,
      err instanceof Error ? err.message : err,
    );
  }
}
