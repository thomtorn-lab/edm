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

// Matches the SITE_URL convention already used in app/sitemap.ts and
// app/robots.ts (a hardcoded canonical Production hostname, not an env var —
// there is no Preview/staging admin this should ever point at).
const ADMIN_DISCOVERY_QUEUE_URL = "https://electroniccph.com/admin#discovery-queue";

function formatStart(start: Date): string {
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

// sendEmail only ever sends the Resend `text` field (never `html` — see
// email.ts), so this body is plain text: no markup can be rendered by the
// recipient's client from any of these interpolated values, and no
// escaping is needed. If an HTML variant is ever added here, every
// dynamic value below must be HTML-escaped before interpolation.
function buildBody(item: DiscoveryQueueNotificationItem): string {
  const lines = [`Event title: ${item.probableTitle}`];

  if (item.probableStart) lines.push(`Date/start time: ${formatStart(item.probableStart)}`);
  if (item.probableVenueName) lines.push(`Venue name: ${item.probableVenueName}`);

  lines.push(`Source: ${item.sourceName}`);

  if (item.predictedGenre) {
    lines.push(`Predicted genre: ${getGenre(item.predictedGenre)?.label ?? item.predictedGenre}`);
  }

  lines.push(`Genre confidence: ${item.genreConfidence}`);
  lines.push(`Overall confidence: ${item.overallConfidence}`);

  if (item.missingFields.length > 0) lines.push(`Missing fields: ${item.missingFields.join(", ")}`);

  lines.push(`Source URL: ${item.sourceUrl}`);
  lines.push("");
  lines.push(`Review in Admin: ${ADMIN_DISCOVERY_QUEUE_URL}`);

  return lines.join("\n");
}

/**
 * Sends the notification for exactly one genuinely-new discovery_queue row.
 * Never throws — a notification failure must never affect the caller,
 * whether that's a single admin insert or one worker in a batch (see
 * notifyDiscoveryQueueInsertBatch below).
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

// Caps how many Resend requests run at once for a single sync's batch, so a
// source's first sync (which can create many new rows at once) can't fire
// dozens of simultaneous outbound HTTP requests or trip Resend's rate limit.
const NOTIFY_BATCH_CONCURRENCY = 5;

/**
 * Sends one notification per item, after all of a sync's DB writes have
 * already completed — never interleaved with the per-candidate insert loop,
 * so N new pending rows never become N sequential email round-trips on the
 * ingestion hot path. Concurrency is bounded (not fire-and-forget): the
 * whole batch is awaited by the caller, so a run's HTTP invocation cannot
 * terminate before every attempt has resolved. A single item's failure
 * never affects the others (notifyDiscoveryQueueInsert never throws).
 */
export async function notifyDiscoveryQueueInsertBatch(items: DiscoveryQueueNotificationItem[]): Promise<void> {
  if (items.length === 0) return;

  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await notifyDiscoveryQueueInsert(item);
    }
  }

  const workerCount = Math.min(NOTIFY_BATCH_CONCURRENCY, items.length);
  await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));
}
