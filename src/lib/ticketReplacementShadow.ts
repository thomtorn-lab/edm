/**
 * Ticket-replacement SHADOW decisions (thomtorn-lab/edm#145, 2026-10-18).
 *
 * Answers one question without changing anything: if a source's current
 * candidate carries a ticket link that differs from the one already stored
 * on the event the sync would match it to, would the proposed rule replace
 * the stored link, and why or why not? Pure functions only. The read-only
 * report (src/db/ticketReplacementShadow.ts) feeds them; no sync, write or
 * publish path imports this module.
 *
 * Identity is checked independently of the ticket link itself:
 *   - Any URL equal (normalized) to the stored or the incoming ticket link is
 *     removed from the identity evidence on both sides, including an RA
 *     event URL that IS the ticket link. A shared ticket page is never
 *     evidence that two listings are the same event.
 *   - A shared official event page or RA event page (an "anchor") is never
 *     enough on its own either: it can cover several shows. It only counts
 *     together with independent content evidence (lineup or title).
 *   - Date, time, venue, room, lineup, title and uniqueness are each checked
 *     on their own and reported as pass / fail / unknown.
 * Anything short of "strong" is withheld with a concrete reason.
 */
import { artistOverlap, normalizeUrl, titleSimilarity } from "./dedup";
import { dateKeyToString, nightlifeDateKey } from "./datetime";
import { getSourceById } from "./data/sources";
import { sourceHasVenueAuthority } from "./data/officialSourceVenues";

/** A stored event, as the read-only report loads it. */
export interface ShadowEvent {
  id: string;
  title: string;
  artists: string[];
  venueId: string | null;
  subVenue: string | null;
  startDatetime: string;
  ticketUrl: string | null;
  officialEventUrl: string | null;
  residentAdvisorUrl: string | null;
  overriddenFields: string[];
  published: boolean;
}

/** A source's current candidate, after the pipeline resolved venue/room/artists. */
export interface ShadowCandidate {
  sourceId: string;
  title: string;
  artists: string[];
  venueId: string | null;
  subVenue: string | null;
  startDatetime: string | null;
  ticketUrl: string | null;
  officialEventUrl: string | null;
  residentAdvisorUrl: string | null;
}

export interface ShadowContext {
  /** The event this source's own recorded link (source_event_links) points to for this candidate, if any. */
  linkedEventId: string | null;
  /** Every stored event (for shared-ticket-page and competing-match checks). */
  allEvents: ShadowEvent[];
}

export type CheckResult = "pass" | "fail" | "unknown";

export interface IdentityChecks {
  venueAuthority: CheckResult;
  date: CheckResult;
  time: CheckResult;
  venue: CheckResult;
  room: CheckResult;
  lineup: CheckResult;
  title: CheckResult;
  anchor: CheckResult;
  unique: CheckResult;
}

export type IdentityLevel = "strong" | "weak" | "none";

export interface IdentityAssessment {
  level: IdentityLevel;
  checks: IdentityChecks;
  /** Which non-ticket anchors were found: "linked", "official_event_url", "ra_event_url", or a cross-field share such as "candidate_ra=event_official". */
  anchors: string[];
  /** Shared URLs discarded because the URL is a ticket link on either side, e.g. "candidate_ra=event_ticket". */
  discardedTicketAnchors: string[];
  /** Ids of other events that match at least as well (competing matches). */
  competingEventIds: string[];
  artistOverlap: number;
  titleSimilarity: number;
}

export type ShadowOutcome = "no_change" | "fill" | "confirm" | "would_replace" | "withheld";

export type WithheldReason =
  | "override"
  | "not_official_source"
  | "no_venue_authority"
  | "different_night"
  | "moved_event"
  | "shared_ticket_page"
  | "stored_ticket_shared"
  | "multiple_shows_same_evening"
  | "room_conflict"
  | "venue_mismatch"
  | "lineup_conflict"
  | "ambiguous_match"
  | "ticket_url_only_identity"
  | "insufficient_identity";

export interface ShadowDecision {
  decisionId: string;
  sourceId: string;
  eventId: string;
  eventTitle: string;
  candidateTitle: string;
  venueId: string | null;
  night: string;
  storedTicketUrl: string | null;
  incomingTicketUrl: string | null;
  outcome: ShadowOutcome;
  withheldReason: WithheldReason | null;
  identity: IdentityAssessment | null;
  /** Human-readable steps, in the order they were decided. */
  explanation: string[];
}

/** Two shows at the same venue more than this far apart are different performances. */
export const SAME_SHOW_MAX_START_DIFF_MINUTES = 60;
const STRONG_ARTIST_OVERLAP = 0.5;
const STRONG_TITLE_SIMILARITY = 0.4;

function nightOf(iso: string): string {
  return dateKeyToString(nightlifeDateKey(new Date(iso)));
}

function norm(url: string | null | undefined): string | null {
  return normalizeUrl(url ?? null);
}

/** Stable, readable id so a QA label always points at the same decision across runs. */
export function shadowDecisionId(sourceId: string, eventId: string, incomingTicketUrl: string | null): string {
  const text = `${sourceId}|${eventId}|${norm(incomingTicketUrl) ?? ""}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${sourceId}:${eventId}:${hash.toString(16).padStart(8, "0")}`;
}

function contentChecks(candidate: { title: string; artists: string[] }, event: { title: string; artists: string[] }) {
  const overlap = artistOverlap(candidate.artists, event.artists);
  const similarity = titleSimilarity(candidate.title, event.title);
  const lineup: CheckResult =
    overlap >= STRONG_ARTIST_OVERLAP ? "pass" : candidate.artists.length > 0 && event.artists.length > 0 && overlap === 0 ? "fail" : "unknown";
  const title: CheckResult = similarity >= STRONG_TITLE_SIMILARITY ? "pass" : "unknown";
  return { overlap, similarity, lineup, title };
}

function roomCheck(a: string | null, b: string | null): CheckResult {
  if (a && b) return a.trim().toLowerCase() === b.trim().toLowerCase() ? "pass" : "fail";
  return "unknown";
}

function timeCheck(a: string | null, b: string): CheckResult {
  if (!a) return "unknown";
  const diff = Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60_000;
  return diff <= SAME_SHOW_MAX_START_DIFF_MINUTES ? "pass" : "fail";
}

/**
 * Identity of `candidate` with `event`, checked without the ticket link.
 * strong = venue authority, same night, same venue, no time/room/lineup
 * conflict, no equally good competing event, content evidence (lineup or
 * title), and either a non-ticket anchor or BOTH lineup and title.
 */
export function assessTicketReplacementIdentity(
  candidate: ShadowCandidate,
  event: ShadowEvent,
  ctx: ShadowContext,
): IdentityAssessment {
  const ticketUrls = new Set([norm(candidate.ticketUrl), norm(event.ticketUrl)].filter((u): u is string => u !== null));
  const anchors: string[] = [];
  const discardedTicketAnchors: string[] = [];
  if (ctx.linkedEventId === event.id) anchors.push("linked");
  // Every URL either side carries, compared field-to-field in any
  // combination (the same way dedup's sharedUniqueUrl does), so a match that
  // rested on e.g. the candidate's RA page being the event's ticket link is
  // seen and discarded rather than silently ignored.
  const fields = (x: { officialEventUrl: string | null; residentAdvisorUrl: string | null; ticketUrl: string | null }) =>
    [
      ["official", x.officialEventUrl],
      ["ra", x.residentAdvisorUrl],
      ["ticket", x.ticketUrl],
    ] as const;
  for (const [fa, a] of fields(candidate)) {
    for (const [fb, b] of fields(event)) {
      const na = norm(a);
      if (!na || na !== norm(b)) continue;
      const name = fa === fb ? `${fa === "ra" ? "ra_event" : fa === "official" ? "official_event" : "ticket"}_url` : `candidate_${fa}=event_${fb}`;
      if (ticketUrls.has(na)) discardedTicketAnchors.push(name);
      else if (fa !== "ticket" && fb !== "ticket") anchors.push(name);
    }
  }

  const { overlap, similarity, lineup, title } = contentChecks(candidate, event);
  const sameVenue = candidate.venueId !== null && candidate.venueId === event.venueId;
  const sameNight = candidate.startDatetime !== null && nightOf(candidate.startDatetime) === nightOf(event.startDatetime);

  // Competing matches: another stored, non-identical event at the same venue
  // and night, not ruled out by room/time, whose content evidence is at least
  // as good as this event's.
  const ownScore = (lineup === "pass" ? 2 : 0) + (title === "pass" ? 1 : 0);
  const competingEventIds = ctx.allEvents
    .filter((other) => other.id !== event.id && other.venueId === event.venueId && nightOf(other.startDatetime) === nightOf(event.startDatetime))
    .filter((other) => roomCheck(candidate.subVenue, other.subVenue) !== "fail" && timeCheck(candidate.startDatetime, other.startDatetime) !== "fail")
    .filter((other) => {
      const c = contentChecks(candidate, other);
      const score = (c.lineup === "pass" ? 2 : 0) + (c.title === "pass" ? 1 : 0);
      return score > 0 && score >= ownScore;
    })
    .map((other) => other.id);

  const checks: IdentityChecks = {
    venueAuthority: sourceHasVenueAuthority(candidate.sourceId, event.venueId) ? "pass" : "fail",
    date: candidate.startDatetime === null ? "unknown" : sameNight ? "pass" : "fail",
    time: timeCheck(candidate.startDatetime, event.startDatetime),
    venue: candidate.venueId === null ? "unknown" : sameVenue ? "pass" : "fail",
    room: roomCheck(candidate.subVenue, event.subVenue),
    lineup,
    title,
    anchor: anchors.length > 0 ? "pass" : "unknown",
    unique: competingEventIds.length === 0 ? "pass" : "fail",
  };

  const noHardFail =
    checks.time !== "fail" && checks.room !== "fail" && checks.lineup !== "fail" && checks.unique === "pass";
  const content = checks.lineup === "pass" || checks.title === "pass";
  const identity = checks.anchor === "pass" || (checks.lineup === "pass" && checks.title === "pass");
  const level: IdentityLevel =
    checks.venueAuthority === "pass" && checks.date === "pass" && checks.venue === "pass" && noHardFail && content && identity
      ? "strong"
      : checks.date === "pass" && checks.venue === "pass"
        ? "weak"
        : "none";

  return { level, checks, anchors, discardedTicketAnchors, competingEventIds, artistOverlap: overlap, titleSimilarity: similarity };
}

/** Other stored events (not `eventId`) whose ticket link is `url`, normalized. */
function eventsSharingTicket(url: string | null, eventId: string, all: ShadowEvent[]): ShadowEvent[] {
  const n = norm(url);
  if (!n) return [];
  return all.filter((e) => e.id !== eventId && norm(e.ticketUrl) === n);
}

/**
 * The shadow decision for one candidate against the event the sync would
 * match it to. Never writes; `outcome` is what the proposed rule WOULD do.
 * Existing behaviour is untouched: "fill" (empty field) and "confirm" (same
 * link) are reported for completeness only.
 */
export function decideTicketReplacementShadow(candidate: ShadowCandidate, event: ShadowEvent, ctx: ShadowContext): ShadowDecision {
  const base = {
    decisionId: shadowDecisionId(candidate.sourceId, event.id, candidate.ticketUrl),
    sourceId: candidate.sourceId,
    eventId: event.id,
    eventTitle: event.title,
    candidateTitle: candidate.title,
    venueId: event.venueId,
    night: nightOf(event.startDatetime),
    storedTicketUrl: event.ticketUrl,
    incomingTicketUrl: candidate.ticketUrl,
  };
  const explanation: string[] = [];
  const done = (outcome: ShadowOutcome, withheldReason: WithheldReason | null, identity: IdentityAssessment | null): ShadowDecision => ({
    ...base,
    outcome,
    withheldReason,
    identity,
    explanation,
  });

  if (!candidate.ticketUrl) {
    explanation.push("candidate has no ticket link; a missing link never clears a stored one");
    return done("no_change", null, null);
  }
  if (norm(candidate.ticketUrl) === norm(event.ticketUrl)) {
    explanation.push("same ticket link as stored (normalized); nothing to replace");
    return done("confirm", null, null);
  }
  if (!event.ticketUrl) {
    explanation.push("event has no ticket link; today's rule fills an empty field (reported only, not part of this change)");
    return done("fill", null, null);
  }
  explanation.push(`stored ticket link differs from the candidate's: ${event.ticketUrl} -> ${candidate.ticketUrl}`);

  if (event.overriddenFields.includes("ticketUrl")) {
    explanation.push("ticketUrl was set or cleared by an admin (overriddenFields); never replaced");
    return done("withheld", "override", null);
  }
  const sourceType = getSourceById(candidate.sourceId)?.sourceType;
  if (sourceType !== "official-venue" && sourceType !== "official-promoter") {
    explanation.push(`source type ${sourceType ?? "unknown"} is not official; with unknown origin only an official source may replace`);
    return done("withheld", "not_official_source", null);
  }

  const identity = assessTicketReplacementIdentity(candidate, event, ctx);
  const c = identity.checks;
  explanation.push(
    `identity checks: ${Object.entries(c)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}; anchors=[${identity.anchors.join(", ")}]; artistOverlap=${identity.artistOverlap.toFixed(2)}; titleSimilarity=${identity.titleSimilarity.toFixed(2)}`,
  );
  if (identity.discardedTicketAnchors.length > 0) {
    explanation.push(`discarded as identity evidence because the URL is a ticket link: ${identity.discardedTicketAnchors.join(", ")}`);
  }

  if (c.venueAuthority === "fail") {
    explanation.push(`${candidate.sourceId} has no authority over venue ${event.venueId ?? "(none)"}`);
    return done("withheld", "no_venue_authority", identity);
  }
  if (c.date === "fail") {
    const moved = c.venue !== "fail" && (c.lineup === "pass" || c.title === "pass" || c.anchor === "pass");
    explanation.push(
      moved
        ? "candidate is on a different night but otherwise looks like the same show: a moved event; the date change is handled elsewhere, the ticket link is never replaced on that basis"
        : "candidate is on a different night",
    );
    return done("withheld", moved ? "moved_event" : "different_night", identity);
  }
  const sharingIncoming = eventsSharingTicket(candidate.ticketUrl, event.id, ctx.allEvents);
  if (sharingIncoming.length > 0) {
    explanation.push(`the incoming ticket link is already used by other events: ${sharingIncoming.map((e) => e.id).join(", ")} (shared ticket page)`);
    return done("withheld", "shared_ticket_page", identity);
  }
  const sharingStored = eventsSharingTicket(event.ticketUrl, event.id, ctx.allEvents);
  if (sharingStored.length > 0) {
    explanation.push(`the stored ticket link is shared with other events: ${sharingStored.map((e) => e.id).join(", ")}; needs an editor`);
    return done("withheld", "stored_ticket_shared", identity);
  }
  if (c.venue !== "pass") {
    explanation.push("candidate venue does not resolve to the event's venue");
    return done("withheld", "venue_mismatch", identity);
  }
  if (c.time === "fail") {
    explanation.push(`start times differ by more than ${SAME_SHOW_MAX_START_DIFF_MINUTES} minutes: likely another show the same evening`);
    return done("withheld", "multiple_shows_same_evening", identity);
  }
  if (c.room === "fail") {
    explanation.push("different known rooms at the same venue");
    return done("withheld", "room_conflict", identity);
  }
  if (c.lineup === "fail") {
    explanation.push("both lineups are known and share no artist");
    return done("withheld", "lineup_conflict", identity);
  }
  if (c.unique === "fail") {
    explanation.push(`other events match at least as well: ${identity.competingEventIds.join(", ")}`);
    return done("withheld", "ambiguous_match", identity);
  }
  if (identity.level !== "strong") {
    const ticketOnly = identity.anchors.length === 0 && identity.discardedTicketAnchors.length > 0;
    explanation.push(
      ticketOnly
        ? "the only shared URL is a ticket link, which is never identity evidence"
        : "identity not strong: needs lineup or title evidence plus either a non-ticket anchor or both lineup and title",
    );
    return done("withheld", ticketOnly ? "ticket_url_only_identity" : "insufficient_identity", identity);
  }
  explanation.push("strong identity: the proposed rule WOULD replace the stored ticket link (shadow only, nothing written)");
  return done("would_replace", null, identity);
}

export interface ShadowSummary {
  total: number;
  byOutcome: Record<ShadowOutcome, number>;
  byWithheldReason: Partial<Record<WithheldReason, number>>;
}

export function summarizeShadowDecisions(decisions: ShadowDecision[]): ShadowSummary {
  const byOutcome: Record<ShadowOutcome, number> = { no_change: 0, fill: 0, confirm: 0, would_replace: 0, withheld: 0 };
  const byWithheldReason: Partial<Record<WithheldReason, number>> = {};
  for (const d of decisions) {
    byOutcome[d.outcome]++;
    if (d.withheldReason) byWithheldReason[d.withheldReason] = (byWithheldReason[d.withheldReason] ?? 0) + 1;
  }
  return { total: decisions.length, byOutcome, byWithheldReason };
}
