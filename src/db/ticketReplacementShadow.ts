/**
 * Read-only ticket-replacement SHADOW report (thomtorn-lab/edm#145,
 * 2026-10-18). Runs by hand through inspect-source's
 * `ticket-replacement-shadow` mode, inside that tool's existing read-only
 * transaction (withReadOnlyTx, BEGIN READ ONLY).
 *
 * What it does, per run, for ONE source:
 *   1. SELECTs every stored event and this source's own source_event_links
 *      (the same rows src/db/sync.ts loads). Nothing else is queried and
 *      nothing is written: no event, no link, no discovery row, no
 *      event_change_log note.
 *   2. Fetches the source's current candidates once with its own adapter
 *      (the same live fetch adapter-dry-run does). Every fetch to a Resident
 *      Advisor host during the run is refused (withResidentAdvisorFetchGuard).
 *   3. Runs the pure ingestion pipeline (no Discogs enrichment) and
 *      findSyncMatch to find the event a real sync would match, then asks
 *      src/lib/ticketReplacementShadow.ts what the PROPOSED rule would do with
 *      the ticket link. The active sync rule is not changed or consulted.
 */
import { runIngestionPipeline, type ExistingEventForDedup } from "@/lib/adapters/pipeline";
import type { RawCandidateEvent, SourceAdapter } from "@/lib/adapters/types";
import { isTrustedElectronicSource } from "@/lib/data/sources";
import { findSyncMatch } from "@/lib/sync";
import {
  decideTicketReplacementShadow,
  summarizeShadowDecisions,
  type ShadowCandidate,
  type ShadowDecision,
  type ShadowEvent,
  type ShadowSummary,
} from "@/lib/ticketReplacementShadow";
import type { Venue } from "@/lib/types";
import type { QueryClient } from "./auditEventsWindow";

export const TICKET_SHADOW_EVENTS_SQL = `SELECT id, title, artists, venue_id, sub_venue, start_datetime, end_datetime, canonical_source_id,
  official_event_url, ticket_url, resident_advisor_url, overridden_fields, published, admin_unpublish_reason
  FROM events`;
export const TICKET_SHADOW_LINKS_SQL = "SELECT event_id, source_url FROM source_event_links WHERE source_id = $1";

/** Printed with every report so a reader never over-reads it. */
export const TICKET_SHADOW_LIMITATIONS = [
  "Shadow only: nothing was written, and the active sync rule for ticket links is unchanged.",
  "The stored link's origin is not recorded (no ticket_url_source_id column yet), so it is treated as unknown: only an official source with venue authority can ever be a would_replace.",
  "Only candidates a real sync would match to an existing event (linked, or high-confidence duplicate) are assessed; unmatched candidates cannot replace anything.",
  "Past events are skipped.",
  "One live fetch of the source's own pages; no Resident Advisor request is made (refused if attempted) and no Discogs lookup is made.",
  "Outcomes are proposals for manual QA labeling, not ground truth. Zero false positives in a small labeled sample is not sufficient evidence for activation.",
] as const;

export interface TicketShadowLabelTemplateEntry {
  decision_id: string;
  outcome: "would_replace" | "withheld";
  withheld_reason: string | null;
  event_id: string;
  stored_ticket_url: string | null;
  incoming_ticket_url: string | null;
  verdict: null;
  note: string;
}

export interface TicketShadowReport {
  meta: {
    sourceId: string;
    generatedAt: string;
    readOnly: true;
    candidatesFetched: number;
    lastFetchWasComplete: boolean;
    candidatesWithoutSyncMatch: number;
    candidatesMatchedToPastEvents: number;
    residentAdvisorRequestsRefused: number;
    limitations: readonly string[];
  };
  summary: ShadowSummary;
  decisions: ShadowDecision[];
  labelTemplate: TicketShadowLabelTemplateEntry[];
}

/** Resident Advisor hosts, including subdomains and the legacy domain. */
export function isResidentAdvisorHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ["ra.co", "residentadvisor.net"].some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Runs `fn` with globalThis.fetch replaced by a wrapper that refuses every
 * request to a Resident Advisor host (and counts it), then restores it.
 */
export async function withResidentAdvisorFetchGuard<T>(fn: () => Promise<T>): Promise<{ result: T; refused: number }> {
  const original = globalThis.fetch;
  let refused = 0;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (isResidentAdvisorHost(url)) {
      refused++;
      return Promise.reject(new Error(`ticket-replacement-shadow refuses Resident Advisor requests: ${url}`));
    }
    return original(input, init);
  }) as typeof fetch;
  try {
    return { result: await fn(), refused };
  } finally {
    globalThis.fetch = original;
  }
}

function iso(value: unknown): string {
  return new Date(value as string).toISOString();
}

export async function runTicketReplacementShadow(
  client: QueryClient,
  opts: { sourceId: string; venues: Venue[]; createAdapter: () => SourceAdapter; now?: Date },
): Promise<TicketShadowReport> {
  const now = opts.now ?? new Date();
  const eventRows = (await client.query(TICKET_SHADOW_EVENTS_SQL)).rows as Record<string, unknown>[];
  const linkRows = (await client.query(TICKET_SHADOW_LINKS_SQL, [opts.sourceId])).rows as Record<string, unknown>[];

  const allEvents: ShadowEvent[] = eventRows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    artists: (r.artists as string[] | null) ?? [],
    venueId: r.venue_id as string | null,
    subVenue: (r.sub_venue as string | null) ?? null,
    startDatetime: iso(r.start_datetime),
    ticketUrl: r.ticket_url as string | null,
    officialEventUrl: r.official_event_url as string | null,
    residentAdvisorUrl: r.resident_advisor_url as string | null,
    overriddenFields: (r.overridden_fields as string[] | null) ?? [],
    published: r.published === true,
  }));
  const byId = new Map(allEvents.map((e) => [e.id, e]));
  const endById = new Map(eventRows.map((r) => [r.id as string, r.end_datetime ? iso(r.end_datetime) : null]));
  const existingEvents: ExistingEventForDedup[] = eventRows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    artists: (r.artists as string[] | null) ?? [],
    venueId: r.venue_id as string | null,
    subVenue: (r.sub_venue as string | null) ?? null,
    startDatetime: iso(r.start_datetime),
    sourceId: r.canonical_source_id as string | null,
    officialEventUrl: r.official_event_url as string | null,
    ticketUrl: r.ticket_url as string | null,
    residentAdvisorUrl: r.resident_advisor_url as string | null,
    adminUnpublished: r.admin_unpublish_reason != null,
  }));
  const linkedByUrl = new Map(linkRows.map((l) => [l.source_url as string, l.event_id as string]));

  const { result: fetched, refused } = await withResidentAdvisorFetchGuard(async () => {
    const adapter = opts.createAdapter();
    const candidates: RawCandidateEvent[] = await adapter.fetchCandidates();
    return { candidates, complete: adapter.lastFetchWasComplete?.() ?? true };
  });

  const trustedElectronicSource = isTrustedElectronicSource(opts.sourceId);
  const decisions: ShadowDecision[] = [];
  let unmatched = 0;
  let past = 0;
  for (const raw of fetched.candidates) {
    const result = runIngestionPipeline(raw, { venues: opts.venues, existingEvents, trustedElectronicSource });
    const linkedEventId = raw.officialEventUrl ? (linkedByUrl.get(raw.officialEventUrl) ?? null) : null;
    const match = findSyncMatch(linkedEventId, result.duplicateOfEventId, result.duplicateConfidence);
    const event = match ? byId.get(match.eventId) : undefined;
    if (!event) {
      unmatched++;
      continue;
    }
    const end = endById.get(event.id) ?? new Date(new Date(event.startDatetime).getTime() + 6 * 3_600_000).toISOString();
    if (new Date(end).getTime() <= now.getTime()) {
      past++;
      continue;
    }
    const candidate: ShadowCandidate = {
      sourceId: raw.sourceId,
      title: raw.title,
      artists: result.normalizedArtists,
      venueId: result.resolvedVenueId,
      subVenue: result.resolvedSubVenue,
      startDatetime: raw.startDatetime ?? null,
      ticketUrl: raw.ticketUrl ?? null,
      officialEventUrl: raw.officialEventUrl ?? null,
      residentAdvisorUrl: raw.residentAdvisorUrl ?? null,
    };
    const decision = decideTicketReplacementShadow(candidate, event, { linkedEventId, allEvents });
    decision.explanation.unshift(`sync match: ${match!.kind} -> ${event.id}`);
    decisions.push(decision);
  }
  decisions.sort((a, b) => a.decisionId.localeCompare(b.decisionId));

  return {
    meta: {
      sourceId: opts.sourceId,
      generatedAt: now.toISOString(),
      readOnly: true,
      candidatesFetched: fetched.candidates.length,
      lastFetchWasComplete: fetched.complete,
      candidatesWithoutSyncMatch: unmatched,
      candidatesMatchedToPastEvents: past,
      residentAdvisorRequestsRefused: refused,
      limitations: TICKET_SHADOW_LIMITATIONS,
    },
    summary: summarizeShadowDecisions(decisions),
    decisions,
    labelTemplate: decisions
      .filter((d): d is ShadowDecision & { outcome: "would_replace" | "withheld" } => d.outcome === "would_replace" || d.outcome === "withheld")
      .map((d) => ({
        decision_id: d.decisionId,
        outcome: d.outcome,
        withheld_reason: d.withheldReason,
        event_id: d.eventId,
        stored_ticket_url: d.storedTicketUrl,
        incoming_ticket_url: d.incomingTicketUrl,
        verdict: null,
        note: "",
      })),
  };
}
