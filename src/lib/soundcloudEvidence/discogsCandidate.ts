import { artistIdentityKey } from "../artistIdentity/lineupIdentity";
import { soundcloudProfileUrl } from "../adapters/cultureBoxSoundcloudLinks";

/**
 * Discogs -> SoundCloud candidate assessment (dry run, 2026-11-06). Pure.
 * Decides what one artist's Discogs identity and listed profile URLs would
 * support, under the strict conditions proposed for automatic linking:
 * exactly one Discogs artist with the exact name and confirmed electronic
 * releases (identity "medium"), exactly one SoundCloud profile URL on that
 * Discogs page, and SoundCloud's own display name for it matching the
 * lineup name's identity key. Anything short of that is "uncertain" (review
 * at most) or "missing". Nothing here stores or links anything.
 */

export type DiscogsSoundcloudVerdict = "verifiable" | "uncertain" | "missing";

export interface DiscogsSoundcloudAssessment {
  verdict: DiscogsSoundcloudVerdict;
  reason: string;
  profileUrl: string | null;
}

export function soundcloudProfilesFromUrls(urls: readonly string[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    const p = soundcloudProfileUrl(u);
    if ("url" in p) out.add(p.url);
  }
  return [...out];
}

export function assessDiscogsSoundcloud(input: {
  name: string;
  lookupStatus: "found" | "not_found" | "ambiguous";
  identityConfidence: "medium" | "low" | null;
  discogsUrls: readonly string[] | null;
  /** SoundCloud's display name (oEmbed author_name) for the single profile; null if not checked or unavailable. */
  soundcloudDisplayName: string | null;
}): DiscogsSoundcloudAssessment {
  if (input.lookupStatus === "not_found") return { verdict: "missing", reason: "no Discogs artist with this exact name", profileUrl: null };
  if (input.lookupStatus === "ambiguous") return { verdict: "uncertain", reason: "several Discogs artists share the name", profileUrl: null };
  const profiles = soundcloudProfilesFromUrls(input.discogsUrls ?? []);
  if (profiles.length === 0) return { verdict: "missing", reason: "Discogs lists no SoundCloud profile", profileUrl: null };
  if (profiles.length > 1) return { verdict: "uncertain", reason: `Discogs lists ${profiles.length} SoundCloud profiles`, profileUrl: null };
  const profileUrl = profiles[0];
  if (input.identityConfidence !== "medium") {
    return { verdict: "uncertain", reason: "Discogs identity is low (short name or no confirmed electronic releases)", profileUrl };
  }
  if (input.soundcloudDisplayName === null) return { verdict: "uncertain", reason: "SoundCloud profile could not be confirmed", profileUrl };
  if (artistIdentityKey(input.soundcloudDisplayName) !== artistIdentityKey(input.name)) {
    return { verdict: "uncertain", reason: `SoundCloud name "${input.soundcloudDisplayName}" differs`, profileUrl };
  }
  return { verdict: "verifiable", reason: "unique Discogs identity, one SoundCloud profile, matching SoundCloud name", profileUrl };
}
