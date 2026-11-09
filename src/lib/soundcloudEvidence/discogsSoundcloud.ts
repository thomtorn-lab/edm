import { artistIdentityKey, classifyAppearance, splitLineupEntry } from "../artistIdentity/lineupIdentity";
import { cleanArtistDisplayName, normalizeArtistName } from "../enrichment/genreEnrichment";
import type { DiscogsSoundcloudAssessment } from "./discogsCandidate";

/**
 * Discogs as a supplementary source of SoundCloud profiles (2026-11-07).
 * Pure helpers; the I/O lives in src/db/discogsSoundcloud.ts (lookups,
 * during the existing sync) and src/lib/queries.ts (display).
 *
 * Storage: the Discogs integration's own per-artist cache,
 * artist_genre_cache.evidence (free-form Discogs evidence, "the evidence
 * store a reviewer consults"), under the key `soundcloud`. Nothing is
 * written to Artist Alerts' tables; its identity rules decide, unchanged,
 * which appearances may show a profile at all.
 *
 * Lookups use the identity key (Artist Alerts' artistIdentityKey), so a
 * documented country suffix ("Moor Mother US", "Byetone DE") doesn't block
 * an exact Discogs match.
 */

export interface DiscogsSoundcloudEvidence extends DiscogsSoundcloudAssessment {
  soundcloudName: string | null;
  checkedAt: string;
}

/** The name sent to Discogs for one performer: its identity key. */
export function discogsLookupName(performer: string): string {
  return artistIdentityKey(performer);
}

/** The artist_genre_cache key for a performer's lookup (the Discogs integration's own normalization of the lookup name). */
export function discogsCacheKey(performer: string): string {
  return normalizeArtistName(cleanArtistDisplayName(discogsLookupName(performer)));
}

export function readDiscogsSoundcloud(evidence: unknown): DiscogsSoundcloudEvidence | null {
  if (!evidence || typeof evidence !== "object") return null;
  const sc = (evidence as Record<string, unknown>).soundcloud;
  if (!sc || typeof sc !== "object") return null;
  const v = sc as Record<string, unknown>;
  if (v.verdict !== "verifiable" && v.verdict !== "uncertain" && v.verdict !== "missing") return null;
  return {
    verdict: v.verdict,
    reason: typeof v.reason === "string" ? v.reason : "",
    profileUrl: typeof v.profileUrl === "string" ? v.profileUrl : null,
    soundcloudName: typeof v.soundcloudName === "string" ? v.soundcloudName : null,
    checkedAt: typeof v.checkedAt === "string" ? v.checkedAt : "",
  };
}

/** Existing evidence with the SoundCloud assessment added (everything else kept as it was). */
export function withDiscogsSoundcloud(evidence: unknown, sc: DiscogsSoundcloudEvidence): Record<string, unknown> {
  const base = evidence && typeof evidence === "object" && !Array.isArray(evidence) ? (evidence as Record<string, unknown>) : {};
  return { ...base, soundcloud: sc };
}

/** The profile a cached Discogs lookup verifies, or null: found, medium identity, and assessed "verifiable". */
export function verifiedDiscogsProfile(row: { lookupStatus: string; identityConfidence: string | null; evidence: unknown }): string | null {
  if (row.lookupStatus !== "found" || row.identityConfidence !== "medium") return null;
  const sc = readDiscogsSoundcloud(row.evidence);
  return sc?.verdict === "verifiable" ? sc.profileUrl : null;
}

/**
 * Performers worth a Discogs lookup after a sync: single performers (B2B
 * sides count; "&"/"x" entries never) that the shared identity rules
 * classify high on their own (a distinctive name), and that have no
 * SoundCloud link from this run. Title-copy, short, event-word and multi-act
 * names are skipped: the identity rules would not show a profile for them,
 * so a lookup has no expected gain. Distinct, in first-seen order.
 */
export function discogsLookupCandidates(events: readonly { title: string; artists: readonly string[] }[], linkedNames: ReadonlySet<string>): string[] {
  const out = new Map<string, string>();
  for (const e of events) {
    for (const entry of e.artists) {
      if (linkedNames.has(entry)) continue;
      for (const part of splitLineupEntry(entry)) {
        const c = classifyAppearance({ entry, part, eventTitle: e.title, lineupSize: e.artists.length, hasSourceHandle: false, venueKeys: new Set() });
        if (c.confidence !== "high" || c.bucket !== "distinct") continue;
        const key = discogsCacheKey(part.name);
        if (key && !out.has(key)) out.set(key, part.name);
      }
    }
  }
  return [...out.values()];
}
