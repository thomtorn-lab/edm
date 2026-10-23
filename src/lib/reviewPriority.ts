import type { DiscoveryQueueItem, Source, Venue } from "./types";
import { isPastEvent } from "./datetime";
import { resolveVenue } from "./normalize";
import { hasExplicitDjOrRaveSignal } from "./adapters/deterministicGenreMapping";
import { hasNonElectronicGenreSignal, hasPopOrRnbSignal } from "./relevance";
import { assessDuplicate, type DuplicateCandidate } from "./dedup";
import { describeSeriesMatch, findSeriesMatch, seriesStrength, type SeriesIndex, type SeriesMatch } from "./seriesMemory";

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
  | "source_category_not_counted"
  | "lineup"
  | "source_quality"
  | "conflicting_genre"
  | "series_same_venue"
  | "series_other_venue"
  | "series_not_counted"
  | "series_irrelevant"
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
  /** The series memory match behind any series_* signal, for display. */
  seriesMatch: SeriesMatch | null;
  recommendedAction: string;
}

export type ReviewPriorityInput = Pick<
  DiscoveryQueueItem,
  "id" | "probableTitle" | "probableStart" | "probableEnd" | "probableVenueName" | "sourceId" | "detectedLineup" | "predictedGenre" | "description"
> &
  /** Only used to recognise the same event listed by two sources (see groupReviewList); absent means "unknown". */
  Partial<Pick<DiscoveryQueueItem, "probableSubVenue" | "probableOfficialEventUrl" | "probableTicketUrl" | "probableResidentAdvisorUrl">>;

export interface ReviewPriorityContext {
  venues: Venue[];
  /** Trust level per source id, from the sources table. */
  sourceTrust: ReadonlyMap<string, Source["trustLevel"]>;
  now: Date;
  /**
   * False for rows the source no longer lists: its electronic category was a
   * property of its listing, which no longer confirms it. The category then
   * adds nothing (it never counts against the row either). Defaults to true.
   */
  sourceStillLists?: boolean;
  /** Earlier events indexed by series name (see seriesMemory.ts). Absent means no series memory. */
  seriesIndex?: SeriesIndex;
}

/** A row needs at least this relevance score, and one qualifying signal, to be in the "likely" tier. */
export const LIKELY_RELEVANT_MIN_SCORE = 3;
/** How many prioritised rows the admin sees before choosing "show all". */
export const REVIEW_PRIORITY_DEFAULT_VISIBLE = 15;

/** Signals that can carry a row into the "likely" tier; venue support, source category, lineup and trust only add to its score. */
const QUALIFYING_SIGNALS: ReadonlySet<ReviewSignalKey> = new Set([
  "genre",
  "dj_or_club_title",
  "dj_or_club_description",
  "strong_venue",
  "series_same_venue",
]);

/** The row's own electronic evidence; series memory only counts for a row that has some. */
const OWN_ELECTRONIC_SIGNALS: ReadonlySet<ReviewSignalKey> = new Set([
  "genre",
  "dj_or_club_title",
  "dj_or_club_description",
  "strong_venue",
  "supporting_venue",
  "source_category",
]);

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
  if (categoryLabel && ctx.sourceStillLists === false) {
    signals.push({ key: "source_category_not_counted", points: 0, label: `Source category not counted: the source no longer lists it (${categoryLabel})` });
  } else if (categoryLabel) {
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

  // Series memory: a ranking hint only. An earlier publish could itself have
  // been a mistake, so it is never copied onto a row whose own text
  // contradicts it, and never counts without the row's own signal.
  const seriesMatch = ctx.seriesIndex
    ? findSeriesMatch(
        {
          title: item.probableTitle,
          lineup: item.detectedLineup,
          venueName: item.probableVenueName,
          start: item.probableStart,
          ownElectronicSignal: signals.some((sig) => OWN_ELECTRONIC_SIGNALS.has(sig.key)),
        },
        ctx.seriesIndex,
      )
    : null;
  if (seriesMatch) {
    const strength = seriesStrength(seriesMatch);
    const why = describeSeriesMatch(seriesMatch, ctx.venues);
    if (strength === "against") {
      signals.push({ key: "series_irrelevant", points: -1, label: why });
    } else if (conflicting && strength !== "unsupported") {
      signals.push({ key: "series_not_counted", points: 0, label: `${why} — not counted: this listing names a non-electronic genre` });
    } else if (strength === "strong") {
      signals.push({ key: "series_same_venue", points: 2, label: why });
    } else if (strength === "supporting") {
      signals.push({ key: "series_other_venue", points: 1, label: why });
    } else if (seriesMatch.published.length > 0) {
      signals.push({ key: "series_not_counted", points: 0, label: `${why} — not counted without more evidence` });
    }
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
    seriesMatch,
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

/**
 * One event as shown in the review queue: the best-ranked row first, then
 * any other source's row for the same event. Grouping is display-only:
 * every row keeps its own id, actions and Discovery Queue state.
 */
export interface ReviewGroup<T extends ReviewPriorityInput = DiscoveryQueueItem> {
  primary: PrioritizedReviewRow<T>;
  others: PrioritizedReviewRow<T>[];
}

export interface GroupedReviewList<T extends ReviewPriorityInput = DiscoveryQueueItem> {
  likely: ReviewGroup<T>[];
  possible: ReviewGroup<T>[];
  /** Events (groups) starting within 72 hours, total and per tier. */
  urgentCount: number;
  urgentLikelyCount: number;
  urgentPossibleCount: number;
}

/** Two listings of the same event cannot start further apart than this. */
const SAME_EVENT_MAX_START_GAP_MS = 2 * 3_600_000;

function toDuplicateCandidate(item: ReviewPriorityInput, venues: Venue[]): DuplicateCandidate | null {
  if (!item.probableStart) return null;
  const resolved = item.probableVenueName ? resolveVenue(item.probableVenueName, venues) : undefined;
  return {
    title: item.probableTitle,
    artists: item.detectedLineup,
    venueId: resolved?.venue.id ?? null,
    subVenue: item.probableSubVenue ?? resolved?.subVenue ?? null,
    startDatetime: item.probableStart,
    sourceId: item.sourceId,
    officialEventUrl: item.probableOfficialEventUrl ?? null,
    ticketUrl: item.probableTicketUrl ?? null,
    residentAdvisorUrl: item.probableResidentAdvisorUrl ?? null,
  };
}

/**
 * True only when two pending rows are, with high certainty, the same event
 * reported by two different sources: the shared dedup rules (assessDuplicate)
 * must say "high" — they already require the same night and veto different
 * rooms — both rows need a start time within two hours of each other and a
 * resolved venue, and the sources must differ (one source listing two rows
 * the same night may be two shows, e.g. an early and a late one).
 */
export function isSameEventFromAnotherSource(a: ReviewPriorityInput, b: ReviewPriorityInput, venues: Venue[]): boolean {
  if (!a.sourceId || !b.sourceId || a.sourceId === b.sourceId) return false;
  const ca = toDuplicateCandidate(a, venues);
  const cb = toDuplicateCandidate(b, venues);
  if (!ca || !cb || !ca.venueId || !cb.venueId) return false;
  if (Math.abs(new Date(ca.startDatetime).getTime() - new Date(cb.startDatetime).getTime()) > SAME_EVENT_MAX_START_GAP_MS) return false;
  return assessDuplicate(ca, cb).confidence === "high";
}

/**
 * Folds rows that are the same event from different sources into one group,
 * so an event takes one place in the queue however many sources list it.
 * Groups keep the order of their best-ranked row; a likely row pulls its
 * possible duplicates into its own group. Nothing is merged in the database.
 */
export function groupReviewList<T extends ReviewPriorityInput>(list: ReviewPriorityList<T>, venues: Venue[]): GroupedReviewList<T> {
  const ranked = [...list.likely, ...list.possible];
  const groups: ReviewGroup<T>[] = [];
  for (const row of ranked) {
    const group = groups.find(
      (g) =>
        [g.primary, ...g.others].every((member) => member.item.sourceId !== row.item.sourceId) &&
        isSameEventFromAnotherSource(g.primary.item, row.item, venues),
    );
    if (group) group.others.push(row);
    else groups.push({ primary: row, others: [] });
  }
  const likely = groups.filter((g) => g.primary.priority.tier === "likely");
  const possible = groups.filter((g) => g.primary.priority.tier === "possible");
  const urgent = (gs: ReviewGroup<T>[]) => gs.filter((g) => [g.primary, ...g.others].some((r) => r.priority.startsWithin72h)).length;
  const urgentLikelyCount = urgent(likely);
  const urgentPossibleCount = urgent(possible);
  return { likely, possible, urgentCount: urgentLikelyCount + urgentPossibleCount, urgentLikelyCount, urgentPossibleCount };
}

export interface VisibleReview<X> {
  likelyShown: X[];
  likelyHidden: X[];
  /** Possible entries shown only to fill the default view up to `limit` when there are fewer likely ones. */
  possibleShown: X[];
  possibleHidden: X[];
}

/**
 * The default view: up to `limit` entries (rows or grouped events), likely
 * ones first. Free slots are filled with the highest-ranked possible entries
 * so a short likely list does not leave the category-only events out of
 * sight; the two stay separate lists so the UI can show them with different
 * certainty.
 */
export function splitVisibleReviewRows<X>(list: { likely: X[]; possible: X[] }, limit: number = REVIEW_PRIORITY_DEFAULT_VISIBLE): VisibleReview<X> {
  const likelyShown = list.likely.slice(0, limit);
  const free = Math.max(0, limit - likelyShown.length);
  return {
    likelyShown,
    likelyHidden: list.likely.slice(limit),
    possibleShown: list.possible.slice(0, free),
    possibleHidden: list.possible.slice(free),
  };
}

export type PossibleBucketKey = "next_7_days" | "next_30_days" | "later" | "no_date";

export interface PossibleBucket<T extends ReviewPriorityInput = DiscoveryQueueItem> {
  key: PossibleBucketKey;
  label: string;
  groups: ReviewGroup<T>[];
}

export interface PossibleDisplay<T extends ReviewPriorityInput = DiscoveryQueueItem> {
  /** Starting within 72 hours: the same rule the banner's warning uses, so shown in full. */
  urgent: ReviewGroup<T>[];
  /** Everything else, by start, as compact rows. Empty buckets are left out. */
  buckets: PossibleBucket<T>[];
}

const POSSIBLE_BUCKETS: { key: PossibleBucketKey; label: string; maxHours: number }[] = [
  { key: "next_7_days", label: "Next 7 days", maxHours: 24 * 7 },
  { key: "next_30_days", label: "8–30 days", maxHours: 24 * 30 },
  { key: "later", label: "Later", maxHours: Number.POSITIVE_INFINITY },
];

/**
 * Lays the possible events out for the Likely relevant tab: every event
 * exactly once, either in full (starts within 72 hours, in ranked order) or
 * as a compact row in a time bucket, by start date.
 */
export function splitPossibleForDisplay<T extends ReviewPriorityInput>(groups: ReviewGroup<T>[]): PossibleDisplay<T> {
  const urgent: ReviewGroup<T>[] = [];
  const buckets: PossibleBucket<T>[] = [
    ...POSSIBLE_BUCKETS.map((b) => ({ key: b.key, label: b.label, groups: [] as ReviewGroup<T>[] })),
    { key: "no_date", label: "No date", groups: [] },
  ];
  for (const group of groups) {
    if ([group.primary, ...group.others].some((r) => r.priority.startsWithin72h)) {
      urgent.push(group);
      continue;
    }
    const hours = group.primary.priority.hoursToStart;
    const index = hours === null ? POSSIBLE_BUCKETS.length : POSSIBLE_BUCKETS.findIndex((b) => hours <= b.maxHours);
    buckets[index].groups.push(group);
  }
  // Within a time bucket the reviewer scans by date; the ranked order only
  // breaks ties (Array.prototype.sort is stable).
  const start = (g: ReviewGroup<T>) => (g.primary.item.probableStart ? new Date(g.primary.item.probableStart).getTime() : Number.POSITIVE_INFINITY);
  for (const bucket of buckets) bucket.groups.sort((a, b) => start(a) - start(b));
  return { urgent, buckets: buckets.filter((b) => b.groups.length > 0) };
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
  const prioritized = buildReviewPriorityList(items, { ...ctx, sourceStillLists: false });
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
