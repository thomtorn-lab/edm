import type { SourceAdapter, RawCandidateEvent } from "./types";

/**
 * Reference adapter for first-party venue/promoter feeds — the only source
 * category cleared for automated ingestion today (spec sections 31, 59).
 * Each venue's own structured events payload is mapped straight into
 * RawCandidateEvent with no site-specific logic leaking outside this file.
 *
 * `fetchRaw` is injected so this adapter is testable without a network call
 * and so a future real HTTP fetch can be swapped in without touching the
 * pipeline or any other adapter.
 */
export interface FirstPartyFeedItem {
  id: string;
  title: string;
  description?: string;
  lineup?: string[];
  starts_at: string;
  ends_at?: string;
  venue: string;
  event_url?: string;
  ticket_url?: string;
  image?: string;
  price_from?: number;
  genre?: string;
}

export function createFirstPartyAdapter(
  sourceId: string,
  sourceUrl: string,
  fetchRaw: () => Promise<FirstPartyFeedItem[]>,
): SourceAdapter {
  return {
    sourceId,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      const items = await fetchRaw();
      const results: RawCandidateEvent[] = [];
      for (const item of items) {
        // A malformed single record must never take down the whole sync.
        try {
          results.push({
            sourceId,
            sourceUrl,
            title: item.title,
            description: item.description ?? null,
            artists: item.lineup ?? [],
            startDatetime: item.starts_at,
            endDatetime: item.ends_at ?? null,
            venueName: item.venue,
            officialEventUrl: item.event_url ?? sourceUrl,
            ticketUrl: item.ticket_url ?? null,
            facebookUrl: null,
            residentAdvisorUrl: null,
            imageUrl: item.image ?? null,
            priceFrom: item.price_from ?? null,
            genreHint: null,
            genreConfidenceHint: null,
            soldOutHint: null,
            cancelledHint: null,
          });
        } catch {
          continue;
        }
      }
      return results;
    },
  };
}
