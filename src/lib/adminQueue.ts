import type { AdminUnpublishReason, DiscoveryQueueItem, EventRecord, Source, Venue } from "./types";
import { classifyVenueBlock, isDiscoveryRowCurrent } from "./sync";
import { isPastEvent } from "./datetime";

/**
 * Admin Discovery Queue cleanup/actionable views, 2026-09-06. The single
 * source of truth for which of the 5 pending-row tabs a given
 * discovery_queue row belongs to — never re-derived ad hoc in a component,
 * so the same row can never appear to disagree with itself across tabs (see
 * the module's own precedence note below).
 *
 * NEEDS_REVIEW is the only tab meant to be a genuine day-to-day work queue:
 * a human can make a real publish/reject/venue-resolution call on every row
 * in it right now, with the evidence already gathered. The other four exist
 * so nothing is ever deleted or hidden outright — they're just not where an
 * admin should have to look by default.
 */
export type AdminQueueCategory = "needs_review" | "venue_blocked" | "insufficient" | "rejected" | "past_stale";

export const ADMIN_QUEUE_CATEGORY_LABELS: Record<AdminQueueCategory, string> = {
  needs_review: "Needs review",
  venue_blocked: "Venue blocked",
  insufficient: "Insufficient evidence",
  rejected: "Rejected / non-relevant",
  past_stale: "Past / stale",
};

export interface AdminQueueClassifiable {
  overallConfidence: DiscoveryQueueItem["overallConfidence"];
  holdReason: DiscoveryQueueItem["holdReason"];
  venueResolvedDecision: DiscoveryQueueItem["venueResolvedDecision"];
  missingFields: DiscoveryQueueItem["missingFields"];
  probableStart: DiscoveryQueueItem["probableStart"];
  probableEnd: DiscoveryQueueItem["probableEnd"];
  lastSeenAt: DiscoveryQueueItem["lastSeenAt"];
}

/**
 * Precedence (documented, not incidental — Section 11 of the admin
 * Discovery Queue cleanup brief): PAST/STALE -> VENUE_BLOCKED -> REJECTED ->
 * INSUFFICIENT -> NEEDS_REVIEW. ADMIN_UNPUBLISHED and PUBLISHED aren't
 * decided here at all — they're a different table (events.adminUnpublishReason)
 * and a different discoveryQueue status (published/merged) respectively, so
 * they can never contend with a pending row for a category the way these
 * five do.
 *
 * Reuses classifyVenueBlock (the exact same freshness/past/counterfactual
 * combination the venue-blocks diagnostic already uses) for the first two
 * tiers rather than re-deriving them: its "stale"/"current_but_past"
 * buckets are this function's PAST_STALE, and its "active" bucket — venue
 * unresolved AND that's the ONLY thing blocking an otherwise-actionable
 * row — is exactly VENUE_BLOCKED. Its "other_blockers" bucket (venue
 * resolved fine, or venue unresolved but something else ALSO blocks) is
 * where a real multi-blocker row lands, resolved below by the REAL
 * (non-counterfactual) holdReason rather than presented as pure
 * venue-blocked — see discoveryQueue.holdReason's own doc comment for why
 * that field exists at all.
 */
export function classifyAdminQueueRow(
  item: AdminQueueClassifiable,
  ctx: { lastCompleteSyncAt: string | null; now: Date },
): AdminQueueCategory {
  const lastSeenAt = item.lastSeenAt ? new Date(item.lastSeenAt) : null;
  const lastCompleteSyncAt = ctx.lastCompleteSyncAt ? new Date(ctx.lastCompleteSyncAt) : null;
  const isCurrent = isDiscoveryRowCurrent(lastSeenAt, lastCompleteSyncAt);
  const isPast = item.probableStart
    ? isPastEvent({ startDatetime: item.probableStart, endDatetime: item.probableEnd }, ctx.now)
    : null;

  const bucket = classifyVenueBlock({ isCurrent, isPast, venueResolvedDecision: item.venueResolvedDecision });
  if (bucket === "stale" || bucket === "current_but_past") return "past_stale";
  if (bucket === "active") return "venue_blocked";

  // bucket === "other_blockers" from here: either venue is already resolved
  // (the common case for most rows) or it's unresolved alongside another
  // real blocker — either way, the REAL holdReason decides the category.
  if (item.holdReason === "negative_relevance") return "rejected";
  if (item.holdReason === "incomplete_data" || item.holdReason === "low_confidence" || item.holdReason === "no_genre_evidence") {
    return "insufficient";
  }
  // Legacy fallback: a row inserted/last classified before discoveryQueue's
  // holdReason column existed carries holdReason=null forever until its next
  // sync self-heals it (deliberately never backfilled — see the column's own
  // doc comment). overallConfidence's own "low" tier already means "the
  // pipeline decision was hold" (see buildDiscoveryQueueClassificationPatch),
  // so treat that combination as insufficient rather than letting an
  // unclassified legacy row default into the actionable queue.
  if (item.holdReason === null && item.overallConfidence === "low") return "insufficient";

  return "needs_review";
}

export type AdminQueueGroups = Record<AdminQueueCategory, DiscoveryQueueItem[]>;

const CONFIDENCE_RANK: Record<DiscoveryQueueItem["overallConfidence"], number> = { high: 3, medium: 2, low: 1 };

function time(iso: string | null): number | null {
  return iso ? new Date(iso).getTime() : null;
}

/**
 * Default sorting (Section 6 of the admin Discovery Queue cleanup brief):
 * NEEDS_REVIEW and VENUE_BLOCKED both prioritize actionable upcoming
 * events — soonest date first (a row with no resolved date sinks to the
 * bottom rather than sorting first), then stronger overall confidence,
 * then freshest evidence as a final tiebreak. Never touches which category
 * a row belongs to — only the order within one already-classified array.
 */
function compareUpcomingFirst(a: DiscoveryQueueItem, b: DiscoveryQueueItem): number {
  const aStart = time(a.probableStart);
  const bStart = time(b.probableStart);
  if (aStart !== bStart) {
    if (aStart === null) return 1;
    if (bStart === null) return -1;
    return aStart - bStart;
  }
  const confDiff = CONFIDENCE_RANK[b.overallConfidence] - CONFIDENCE_RANK[a.overallConfidence];
  if (confDiff !== 0) return confDiff;
  return (time(b.lastSeenAt) ?? 0) - (time(a.lastSeenAt) ?? 0);
}

/** INSUFFICIENT / REJECTED: newest/current evidence first (Section 6) — freshest lastSeenAt first. */
function compareFreshestFirst(a: DiscoveryQueueItem, b: DiscoveryQueueItem): number {
  return (time(b.lastSeenAt) ?? 0) - (time(a.lastSeenAt) ?? 0);
}

/** PAST/STALE: most recently relevant first (Section 6) — most recent probable event date first, falling back to freshness. */
function compareMostRecentlyRelevantFirst(a: DiscoveryQueueItem, b: DiscoveryQueueItem): number {
  const aRef = time(a.probableStart) ?? time(a.lastSeenAt) ?? 0;
  const bRef = time(b.probableStart) ?? time(b.lastSeenAt) ?? 0;
  return bRef - aRef;
}

const GROUP_SORT: Record<AdminQueueCategory, (a: DiscoveryQueueItem, b: DiscoveryQueueItem) => number> = {
  needs_review: compareUpcomingFirst,
  venue_blocked: compareUpcomingFirst,
  insufficient: compareFreshestFirst,
  rejected: compareFreshestFirst,
  past_stale: compareMostRecentlyRelevantFirst,
};

/**
 * Buckets every "pending" discoveryQueue row into its tab via
 * classifyAdminQueueRow — the one place that loop happens, so a component
 * only ever renders a group, never re-derives one. `sourceLastCompleteSync`
 * maps a source's id to its own lastCompleteSyncAt (Source.lastCompleteSyncAt),
 * looked up per row from its sourceId; a row with no sourceId (never
 * observed on a real candidate, but the column is nullable) reads as no
 * freshness signal at all, same as an unknown source would. Each group is
 * sorted per GROUP_SORT above (admin Discovery Queue cleanup, Section 6)
 * before being returned — sorting never affects which category a row lands
 * in, only its position within that category's array.
 */
export function groupAdminQueueRows(
  items: DiscoveryQueueItem[],
  sourceLastCompleteSync: Map<string, string | null>,
  now: Date,
): AdminQueueGroups {
  const groups: AdminQueueGroups = {
    needs_review: [],
    venue_blocked: [],
    insufficient: [],
    rejected: [],
    past_stale: [],
  };
  for (const item of items) {
    const lastCompleteSyncAt = item.sourceId ? (sourceLastCompleteSync.get(item.sourceId) ?? null) : null;
    const category = classifyAdminQueueRow(item, { lastCompleteSyncAt, now });
    groups[category].push(item);
  }
  for (const category of Object.keys(groups) as AdminQueueCategory[]) {
    groups[category].sort(GROUP_SORT[category]);
  }
  return groups;
}

/** One row of the PUBLISHED tab (Section 8): the discoveryQueue candidate that led here, plus whichever canonical event it resolved to (best-effort for "published" rows — see resolvePublishedCanonicalEventId below). */
export interface PublishedQueueRow {
  item: DiscoveryQueueItem;
  canonicalEventId: string | null;
  canonicalTitle: string | null;
  canonicalVenueName: string | null;
}

/**
 * "merged" rows persist a direct FK (suspectedDuplicateOfEventId is always
 * set by mergeDiscoveryItem — see src/db/writes.ts). "published" rows don't
 * (publishDiscoveryItem never wrote one back), so the best-effort match
 * reuses the exact two fields publishDiscoveryItem copies verbatim onto the
 * new event: canonicalSourceId (from the row's sourceId) and
 * officialEventUrl (from the row's sourceUrl). Never a new query — matches
 * against whatever event list the caller already fetched.
 */
export function resolvePublishedCanonicalEventId(item: DiscoveryQueueItem, events: EventRecord[]): string | null {
  if (item.status === "merged") return item.suspectedDuplicateOfEventId;
  if (item.status === "published") {
    const match = events.find((e) => e.canonicalSourceId === item.sourceId && e.officialEventUrl === item.sourceUrl);
    return match?.id ?? null;
  }
  return null;
}

/**
 * Resolves every "published"/"merged" discoveryQueue row to the PUBLISHED
 * tab's display shape in one pass, reusing resolvePublishedCanonicalEventId
 * above for the id and looking up that event's own current title/venue —
 * so e.g. a since-renamed or re-venued event shows its current state, not
 * what the candidate looked like at publish time. Falls back to the
 * candidate's own probable fields when no canonical event can be resolved
 * (never happened in practice as of this writing, but publishDiscoveryItem's
 * best-effort match is exactly that — best-effort).
 *
 * Excludes any row whose resolved canonical event currently carries the
 * admin-unpublish override (real Production case found during the admin
 * Discovery Queue cleanup live audit, 2026-09-07: Jasho Club // Poolen
 * Outside's originating discoveryQueue row is still status "published",
 * so without this filter it would show in BOTH this tab and UNPUBLISHED BY
 * ADMIN at once — contradicting Section 13's "each row belongs to exactly
 * one primary bucket" rule and its precedence, where UNPUBLISHED BY ADMIN
 * outranks PUBLISHED). The discoveryQueue row's own status is never
 * rewritten by an admin unpublish/republish (adminUnpublishEvent only ever
 * touches the events table) — this filter is the presentation-layer fix,
 * not a data migration.
 */
export function buildPublishedQueueRows(
  items: DiscoveryQueueItem[],
  events: EventRecord[],
  venuesById: Map<string, Venue>,
): PublishedQueueRow[] {
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const rows: PublishedQueueRow[] = [];
  for (const item of items) {
    const canonicalEventId = resolvePublishedCanonicalEventId(item, events);
    const canonicalEvent = canonicalEventId ? eventsById.get(canonicalEventId) : undefined;
    if (canonicalEvent?.adminUnpublishReason != null) continue;
    rows.push({
      item,
      canonicalEventId: canonicalEventId ?? null,
      canonicalTitle: canonicalEvent?.title ?? null,
      canonicalVenueName: canonicalEvent ? (venuesById.get(canonicalEvent.venueId)?.name ?? null) : null,
    });
  }
  return rows;
}

/** One row of the UNPUBLISHED BY ADMIN tab (Section 9). */
export interface AdminUnpublishedRow {
  eventId: string;
  title: string;
  reason: AdminUnpublishReason;
  /** Optional free-text detail an admin left alongside the reason — admin-UI-only, never public. */
  note: string | null;
  unpublishedAt: string | null;
  venueName: string;
  sourceName: string | null;
}

/**
 * Every canonical event currently carrying the persistent admin-unpublish
 * override (events.adminUnpublishReason — see its own doc comment; distinct
 * from the generic manualOverride/overriddenFields mechanism and from an
 * ordinary rejected/ignored discoveryQueue candidate, which never reaches
 * this list at all). Derived from whatever event list the caller already
 * fetched — no new query.
 */
export function deriveAdminUnpublishedRows(
  events: EventRecord[],
  venuesById: Map<string, Venue>,
  sourcesById: Map<string, Source>,
): AdminUnpublishedRow[] {
  return events
    .filter((e): e is EventRecord & { adminUnpublishReason: AdminUnpublishReason } => e.adminUnpublishReason != null)
    .map((e) => ({
      eventId: e.id,
      title: e.title,
      reason: e.adminUnpublishReason,
      note: e.adminUnpublishNote,
      unpublishedAt: e.adminUnpublishedAt,
      venueName: venuesById.get(e.venueId)?.name ?? "Unknown venue",
      sourceName: e.canonicalSourceId ? (sourcesById.get(e.canonicalSourceId)?.sourceName ?? null) : null,
    }))
    // Most recent admin action first (Section 6).
    .sort((a, b) => (b.unpublishedAt ? new Date(b.unpublishedAt).getTime() : 0) - (a.unpublishedAt ? new Date(a.unpublishedAt).getTime() : 0));
}
