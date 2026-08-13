import type { DiscoveryQueueItem } from "../types";

/**
 * Sample review-queue items (spec section 35) — medium/low confidence
 * imports awaiting a human decision. In production these are produced by
 * runIngestionPipeline() whenever the decision is "review_queue".
 */
export const DISCOVERY_QUEUE: DiscoveryQueueItem[] = [
  {
    id: "dq-001",
    probableTitle: "Late Notice: Warehouse Session",
    probableStart: "2026-08-28T23:00:00+02:00",
    probableVenueName: "Refshaleøen (unconfirmed hall)",
    sourceName: "AllEvents — Raves Copenhagen",
    sourceUrl: "https://allevents.in/copenhagen/raves",
    detectedLineup: ["SILT", "OONA BRANDT"],
    predictedGenre: "hard-techno",
    genreConfidence: "medium",
    suspectedDuplicateOfEventId: null,
    missingFields: ["venue (unresolved against registry)", "official source url"],
    overallConfidence: "medium",
  },
  {
    id: "dq-002",
    probableTitle: "Box Standard — Extended",
    probableStart: "2026-08-14T23:00:00+02:00",
    probableVenueName: "Culture Box",
    sourceName: "Facebook — Techno Events Copenhagen",
    sourceUrl: "https://www.facebook.com/groups/technoeventscopenhagen/",
    detectedLineup: ["NAILS", "TEODORA LUX", "MRK."],
    predictedGenre: "techno",
    genreConfidence: "high",
    suspectedDuplicateOfEventId: "e-002",
    missingFields: [],
    overallConfidence: "medium",
  },
  {
    id: "dq-003",
    probableTitle: "Friday Basement Thing",
    probableStart: "2026-09-11T22:00:00+02:00",
    probableVenueName: "unknown Vesterbro address",
    sourceName: "Facebook — Denmark Electronic Parties",
    sourceUrl: "https://www.facebook.com/groups/7906566894/",
    detectedLineup: [],
    predictedGenre: null,
    genreConfidence: "low",
    suspectedDuplicateOfEventId: null,
    missingFields: ["venue", "genre evidence", "official source url"],
    overallConfidence: "low",
  },
];
