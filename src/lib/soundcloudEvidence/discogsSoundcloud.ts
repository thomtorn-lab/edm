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

/**
 * Whether a performer's cached Discogs row (or its absence) still needs a
 * Discogs -> SoundCloud lookup: no row, an expired row, or a fresh "found"
 * row not yet assessed for SoundCloud. A fresh row already assessed (any
 * verdict), or cached as not found / ambiguous, needs nothing — so no
 * artist is ever searched twice within the Discogs cache's own TTL. A
 * profile once assessed "verifiable" is never re-assessed, even after the
 * row expires: a later sync must not replace a verified link with a
 * weaker verdict from a transient failure (a block removes a wrong one).
 */
export function needsDiscogsSoundcloudLookup(row: { lookupStatus: string; evidence: unknown; expiresAt: Date } | undefined, now: Date): boolean {
  if (row && readDiscogsSoundcloud(row.evidence)?.verdict === "verifiable") return false;
  if (!row || row.expiresAt.getTime() <= now.getTime()) return true;
  return row.lookupStatus === "found" && !readDiscogsSoundcloud(row.evidence);
}

/**
 * The evidence to store when the Discogs integration re-looks an artist up
 * (its genre cache expired, e.g. during a later source sync): the new
 * evidence, plus the earlier SoundCloud assessment when the re-lookup
 * resolved to the same Discogs artist and carries none of its own. Without
 * this a routine genre refresh would silently drop a verified SoundCloud
 * profile from every event page. A different (or no) Discogs artist drops
 * it: the old verification no longer describes this identity.
 */
export function keepDiscogsSoundcloud(
  previous: { discogsArtistId: number | null; evidence: unknown } | undefined,
  next: { discogsArtistId: number | null; evidence: unknown },
): unknown {
  if (!previous || previous.discogsArtistId === null || previous.discogsArtistId !== next.discogsArtistId) return next.evidence;
  if (readDiscogsSoundcloud(next.evidence)) return next.evidence;
  const earlier = readDiscogsSoundcloud(previous.evidence);
  return earlier ? withDiscogsSoundcloud(next.evidence, earlier) : next.evidence;
}
