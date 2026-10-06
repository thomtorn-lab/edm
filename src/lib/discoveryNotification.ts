import type { ConfidenceLevel } from "./types";
import type { GenreSlug } from "./taxonomy";

/**
 * Fields available on a freshly-inserted discovery_queue row — kept even
 * though the notification itself is disabled (see below), since sync.ts and
 * the admin "Add event from URL" route still construct and pass this shape
 * unconditionally after every insert/batch.
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

/**
 * Email notifications for new Discovery Queue rows have been deliberately
 * disabled (2026-10-06 — no longer wanted). Kept as a no-op rather than
 * removed: sync.ts's per-sync batch and the admin "Add event from URL"
 * route both call this unconditionally after every insert, so a no-op here
 * is the smallest possible change and neither call site needs to change.
 * Never throws, exactly as before disabling.
 */
export async function notifyDiscoveryQueueInsert(_item: DiscoveryQueueNotificationItem): Promise<void> {
  return;
}

/**
 * Also disabled, for the same reason as notifyDiscoveryQueueInsert above.
 */
export async function notifyDiscoveryQueueInsertBatch(_items: DiscoveryQueueNotificationItem[]): Promise<void> {
  return;
}
