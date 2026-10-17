import type { DiscoveryQueueItem, Source, Venue } from "./types";
import { isPastEvent } from "./datetime";
import { resolveVenue } from "./normalize";
import { hasExplicitDjOrRaveSignal } from "./adapters/deterministicGenreMapping";
import { hasNonElectronicGenreSignal, hasPopOrRnbSignal } from "./relevance";

/**
 * Review prioritisation for the admin Discovery Queue (coverage work, phase
 * 2, 2026-10-17). Production on 2026-10-16 had 930 pending rows but only 2 in
 * "Needs review": relevant events whose source text simply never names a
 * genre (TANZEN UND SPRINGEN and Dirty Trancing at MODULE, Final Descent at
 * Basement, Boiler Room, The Prodigy) sat in "Insufficient evidence" next to
 * ~180 Billetto rows that are genuinely not music events, so nobody saw them
 * until they were nearly over.
 *
 * This module only RANKS and EXPLAINS. It never changes a row's category
 * (classifyAdminQueueRow in adminQueue.ts still decides that), never touches
 * holdReason/predictedGenre/overallConfidence, and is deliberately not
 * imported by the ingestion pipeline, sync, relevance or classification
 * code: a venue or source signal here can surface a row for a human, never
 * publish it.
 */

/** Venues whose programme is primarily electronic: a strong positive signal on its own. */
const STRONG_ELECTRONIC_VENUE_IDS: ReadonlySet<string> = new Set(["v-module", "v-den-anden-side", "v-culture-box", "v-hangaren"]);

/**
 * Venues with a regular electronic programme that are still not proof on
 * their own: they raise priority but can never make a row "likely relevant"
 * without some other qualifying signal.
 */
const SUPPORTING_ELECTRONIC_VENUE_IDS: ReadonlySet<string> = new Set(["v-gravity", "v-klub-werkstatt", "v-kb3"]);

/**
 * Sources whose own listing is already filtered to an electronic category,
 * so every row they produce carries that category as weak evidence:
 * KultuNaut only fetches its "Elektronisk" and "Club/DJ" listings, and
 * Pumpehuset is filtered server-side to its "Elektronisk" genre. KultuNaut's
 * tag has known false positives (metal bands tagged "Club/DJ"), which is why
 * this is weaker than a venue or a genre and is cancelled out by any
 * non-electronic genre wording.
 */
const ELECTRONIC_CATEGORY_SOURCES: Readonly<Record<string, string>> = {
  "src-kultunaut": "KultuNaut lists it under Elektronisk / Club-DJ",
  "src-pumpehuset": "Pumpehuset tags it Elektronisk",
};

/** Club-night format words, matched on whole words only. "klubaften" is the Danish "club night". */
const CLUB_FORMAT_RE = /\b(?:boiler room|open decks?|b2b|all night long|dj[- ]sets?|club ?night|klubaften)\b/i;

export type ReviewSignalKey =
  | "genre"
  | "dj_or_club_title"
  | "dj_or_club_description"
  | "strong_venue"
  | "supporting_venue"
  | "source_category"
  | "lineup"
  | "source_quality"
  | "conflicting_genre"
  | "venue_unresolved"
  | "date_missing"
  | "starts_within_72h"
  | "starts_within_7d";

export interface ReviewSignal {
  key: ReviewSignalKey;
  /** Contribution to relevanceScore; 0 for purely informational signals. */
  points: number;
  label: string;
}

/**
 * "missing_genre_info": nothing contradicts electronic music, the source text
 * just never says which genre. "uncertain_relevance": the text itself points
 * at a non-electronic genre, so a human has to decide whether it belongs at all.
 */
export type RelevanceState = "missing_genre_info" | "uncertain_relevance";

/**
 * "likely": a content signal (genre, DJ/rave/club wording) or a primarily
 * electronic venue backs it up. "possible": only the source's own electronic
 * category says so — KultuNaut's tag cannot tell The Prodigy from a metal
 * band it also files under Club/DJ, so these are listed separately instead
 * of crowding the top of the queue. "none": nothing points at electronic music.
 */
export type ReviewTier = "likely" | "possible" | "none";

export interface ReviewPriority {
  itemId: string;
  /** Sum of the relevance signals' points: how likely the event is electronic. */
  relevanceScore: number;
  /** relevanceScore plus an urgency boost for events starting soon; the sort key. */
  priority: number;
  tier: ReviewTier;
  relevanceState: RelevanceState;
  startsWithin72h: boolean;
  hoursToStart: number | null;
  signals: ReviewSignal[];
  recommendedAction: string;
}

export type ReviewPriorityInput = Pick<
  DiscoveryQueueItem,
  "id" | "probableTitle" | "probableStart" | "probableEnd" | "probableVenueName" | "sourceId" | "detectedLineup" | "predictedGenre" | "description"
>;

export interface ReviewPriorityContext {
  venues: Venue[];
  /** Trust level per source id, from the sources table. */
  sourceTrust: ReadonlyMap<string, Source["trustLevel"]>;
  now: Date;
}

/** A row needs at least this relevance score, and one qualifying signal, to be in the "likely" tier. */
export const LIKELY_RELEVANT_MIN_SCORE = 3;
/** How many prioritised rows the admin sees before choosing "show all". */
export const REVIEW_PRIORITY_DEFAULT_VISIBLE = 15;

/** Signals that can carry a row into the "likely" tier; venue support, source category, lineup and trust only add to its score. */
const QUALIFYING_SIGNALS: ReadonlySet<ReviewSignalKey> = new Set(["genre", "dj_or_club_title", "dj_or_club_description", "strong_venue"]);

const HOUR_MS = 3_600_000;

export function scoreReviewPriority(item: ReviewPriorityInput, ctx: ReviewPriorityContext): ReviewPriority {
  const signals: ReviewSignal[] = [];
  const titleAndLineup = `${item.probableTitle} ${item.detectedLineup.join(" ")}`;
  const description = item.description ?? "";

  if (item.predictedGenre) {
    signals.push({ key: "genre", points: 3, label: `Genre found: ${item.predictedGenre}` });
  }
  if (hasExplicitDjOrRaveSignal(titleAndLineup) || CLUB_FORMAT_RE.test(titleAndLineup)) {
    signals.push({ key: "dj_or_club_title", points: 3, label: "DJ / rave / club-night wording in title or lineup" });
  } else if (hasExplicitDjOrRaveSignal(description) || CLUB_FORMAT_RE.test(description)) {
    signals.push({ key: "dj_or_club_description", points: 2, label: "DJ / rave / club-night wording in the description" });
  }

  // Mixed-programme venues (Pumpehuset, VEGA, ALICE, Poolen, Basement,
  // Pylonen) score nothing either way: never a penalty, other signals decide.
  const resolved = item.probableVenueName ? resolveVenue(item.probableVenueName, ctx.venues) : undefined;
  if (resolved && STRONG_ELECTRONIC_VENUE_IDS.has(resolved.venue.id)) {
    signals.push({ key: "strong_venue", points: 3, label: `${resolved.venue.name} is a primarily electronic venue` });
  } else if (resolved && SUPPORTING_ELECTRONIC_VENUE_IDS.has(resolved.venue.id)) {
    signals.push({ key: "supporting_venue", points: 1, label: `${resolved.venue.name} regularly programs electronic music` });
  }

  const categoryLabel = item.sourceId ? ELECTRONIC_CATEGORY_SOURCES[item.sourceId] : undefined;
  if (categoryLabel) {
    signals.push({ key: "source_category", points: 2, label: categoryLabel });
  }
  if (item.detectedLineup.length > 0) {
    signals.push({ key: "lineup", points: 1, label: `Lineup listed (${item.detectedLineup.length})` });
  }
  const trust = item.sourceId ? ctx.sourceTrust.get(item.sourceId) : undefined;
  if (trust === "high") {
    signals.push({ key: "source_quality", points: 1, label: "High-trust source" });
  } else if (trust === "low") {
    signals.push({ key: "source_quality", points: -1, label: "Low-trust source" });
  }

  // Read-only use of the same relevance helpers the pipeline uses: here they
  // only label the row as genuinely uncertain and lower its rank.
  const contradictionText = `${titleAndLineup} ${description}`;
  const conflicting =
    hasNonElectronicGenreSignal(contradictionText, item.detectedLineup) || hasPopOrRnbSignal(contradictionText, item.detectedLineup);
  if (conflicting) {
    signals.push({ key: "conflicting_genre", points: -3, label: "Text also names a non-electronic genre (pop, R&B, rock, metal, …)" });
  }

  if (item.probableVenueName && !resolved) {
    signals.push({ key: "venue_unresolved", points: 0, label: `Venue "${item.probableVenueName}" is not registered` });
  } else if (!item.probableVenueName) {
    signals.push({ key: "venue_unresolved", points: 0, label: "No venue given" });
  }

  let hoursToStart: number | null = null;
  let urgency = 0;
  if (!item.probableStart) {
    signals.push({ key: "date_missing", points: 0, label: "No start date" });
  } else {
    hoursToStart = (new Date(item.probableStart).getTime() - ctx.now.getTime()) / HOUR_MS;
    if (hoursToStart <= 72) {
      urgency = 3;
      signals.push({ key: "starts_within_72h", points: 0, label: "Starts within 72 hours" });
    } else if (hoursToStart <= 24 * 7) {
      urgency = 1;
      signals.push({ key: "starts_within_7d", points: 0, label: "Starts within 7 days" });
    }
  }

  const relevanceScore = signals.reduce((sum, s) => sum + s.points, 0);
  const hasQualifyingSignal = signals.some((s) => QUALIFYING_SIGNALS.has(s.key));
  const hasSourceCategory = signals.some((s) => s.key === "source_category");
  const tier: ReviewTier =
    relevanceScore >= LIKELY_RELEVANT_MIN_SCORE && hasQualifyingSignal
      ? "likely"
      : hasSourceCategory && !conflicting
        ? "possible"
        : "none";
  const relevanceState: RelevanceState = conflicting ? "uncertain_relevance" : "missing_genre_info";
  const startsWithin72h = hoursToStart !== null && hoursToStart <= 72;

  return {
    itemId: item.id,
    relevanceScore,
    priority: relevanceScore + urgency,
    tier,
    relevanceState,
    startsWithin72h,
    hoursToStart,
    signals,
    recommendedAction: recommendAction({ tier, relevanceScore, relevanceState, hasDate: !!item.probableStart, venueResolved: !!resolved }),
  };
}

function recommendAction(input: {
  tier: ReviewTier;
  relevanceScore: number;
  relevanceState: RelevanceState;
  hasDate: boolean;
  venueResolved: boolean;
}): string {
  if (!input.hasDate) return "Add the start date, then review";
  if (input.relevanceState === "uncertain_relevance") return "Check the source: it also names a non-electronic genre — publish or ignore";
  if (input.tier === "possible") return "Check the artist or source: only the listing category says electronic — publish or ignore";
  if (!input.venueResolved) return "Pick or create the venue, then pick a genre and publish";
  if (input.relevanceScore >= 5) return "Pick a genre and publish";
  return "Check the source, then pick a genre and publish — or ignore";
}

export interface PrioritizedReviewRow<T extends ReviewPriorityInput = DiscoveryQueueItem> {
  item: T;
  priority: ReviewPriority;
}

export interface ReviewPriorityList<T extends ReviewPriorityInput = DiscoveryQueueItem> {
  likely: PrioritizedReviewRow<T>[];
  possible: PrioritizedReviewRow<T>[];
  /** Likely or possible rows that start within 72 hours: the admin warning count. */
  urgentCount: number;
  urgentLikelyCount: number;
  urgentPossibleCount: number;
}

/**
 * Ranks the not-yet-over rows of each tier: highest priority first (the
 * 72-hour urgency boost included), then earliest start, then title so the
 * order is stable. A row with no start date is kept and says so rather than
 * being dropped. Rows in the "none" tier are left where they are.
 */
export function buildReviewPriorityList<T extends ReviewPriorityInput>(items: T[], ctx: ReviewPriorityContext): ReviewPriorityList<T> {
  const list: ReviewPriorityList<T> = { likely: [], possible: [], urgentCount: 0, urgentLikelyCount: 0, urgentPossibleCount: 0 };
  for (const item of items) {
    if (item.probableStart && isPastEvent({ startDatetime: item.probableStart, endDatetime: item.probableEnd }, ctx.now)) continue;
    const priority = scoreReviewPriority(item, ctx);
    if (priority.tier === "none") continue;
    list[priority.tier].push({ item, priority });
    if (priority.startsWithin72h) {
      list.urgentCount++;
      if (priority.tier === "likely") list.urgentLikelyCount++;
      else list.urgentPossibleCount++;
    }
  }
  list.likely.sort(comparePriority);
  list.possible.sort(comparePriority);
  return list;
}

function comparePriority<T extends ReviewPriorityInput>(a: PrioritizedReviewRow<T>, b: PrioritizedReviewRow<T>): number {
  if (b.priority.priority !== a.priority.priority) return b.priority.priority - a.priority.priority;
  const aStart = a.item.probableStart ? new Date(a.item.probableStart).getTime() : Number.POSITIVE_INFINITY;
  const bStart = b.item.probableStart ? new Date(b.item.probableStart).getTime() : Number.POSITIVE_INFINITY;
  if (aStart !== bStart) return aStart - bStart;
  return a.item.probableTitle.localeCompare(b.item.probableTitle);
}

export interface VisibleReviewRows<T extends ReviewPriorityInput = DiscoveryQueueItem> {
  likelyShown: PrioritizedReviewRow<T>[];
  likelyHidden: PrioritizedReviewRow<T>[];
  /** Possible rows shown only to fill the default view up to `limit` when there are fewer likely rows. */
  possibleShown: PrioritizedReviewRow<T>[];
  possibleHidden: PrioritizedReviewRow<T>[];
}

/**
 * The default view: up to `limit` rows, likely ones first. Free slots are
 * filled with the highest-ranked possible rows so a short likely list does
 * not leave the category-only events out of sight; the two stay separate
 * lists so the UI can show them with different certainty.
 */
export function splitVisibleReviewRows<T extends ReviewPriorityInput>(
  list: ReviewPriorityList<T>,
  limit: number = REVIEW_PRIORITY_DEFAULT_VISIBLE,
): VisibleReviewRows<T> {
  const likelyShown = list.likely.slice(0, limit);
  const free = Math.max(0, limit - likelyShown.length);
  return {
    likelyShown,
    likelyHidden: list.likely.slice(limit),
    possibleShown: list.possible.slice(0, free),
    possibleHidden: list.possible.slice(free),
  };
}

export interface NotInSourceReview<T extends ReviewPriorityInput = DiscoveryQueueItem> {
  /** Likely and possible rows, ranked exactly like the Likely relevant tab. */
  prioritized: ReviewPriorityList<T>;
  /** Everything else, by start date: nothing points at electronic music. */
  others: T[];
}

/**
 * Ranks the upcoming rows a source no longer lists with the same signals as
 * the Likely relevant tab, so the relevant ones stand out from the rest. It
 * says nothing about why a row disappeared (moved, renamed, cancelled or a
 * source glitch); that stays for a human to check.
 */
export function prioritizeNotInSource<T extends ReviewPriorityInput>(items: T[], ctx: ReviewPriorityContext): NotInSourceReview<T> {
  const prioritized = buildReviewPriorityList(items, ctx);
  const ranked = new Set<string>([...prioritized.likely, ...prioritized.possible].map((r) => r.item.id));
  const others = items
    .filter((item) => !ranked.has(item.id))
    .sort((a, b) => (a.probableStart ?? "").localeCompare(b.probableStart ?? "") || a.probableTitle.localeCompare(b.probableTitle));
  return { prioritized, others };
}

export interface PastStaleSplit<T> {
  /** The event's own date has passed (or the row is past and stale): nothing left to decide. */
  expired: T[];
  /** Still upcoming, but the source no longer lists it: possibly moved, renamed or cancelled. */
  upcomingNotInSource: T[];
}

/** Splits the Past / stale tab for display only; every row stays in that tab. */
export function splitPastStale<T extends Pick<DiscoveryQueueItem, "probableStart" | "probableEnd">>(items: T[], now: Date): PastStaleSplit<T> {
  const split: PastStaleSplit<T> = { expired: [], upcomingNotInSource: [] };
  for (const item of items) {
    const upcoming = item.probableStart != null && !isPastEvent({ startDatetime: item.probableStart, endDatetime: item.probableEnd }, now);
    (upcoming ? split.upcomingNotInSource : split.expired).push(item);
  }
  return split;
}
