import type { ArtistSoundcloudLink } from "./types";

/**
 * Which of Culture Box's own lineup links count as an artist's SoundCloud
 * profile (2026-10-13). Culture Box's /events/ listing links most lineup
 * names to SoundCloud; that venue-provided, night-specific link is the
 * evidence — no SoundCloud lookup, no name search, no matching across
 * events. This module only decides which links are clearly an artist
 * profile and drops everything else:
 *
 *   - not soundcloud.com (incl. on.soundcloud.com short links, whose target
 *     can't be seen without a request)
 *   - not exactly one path segment: tracks, sets and the venue's own podcast
 *     episodes (cultureboxcopenhagen/culture-box-podcast-141) are not profiles
 *   - SoundCloud's own reserved paths (discover, search, …)
 *   - the venue's own account
 *   - handles that read as a label/organisation (modulhertz-rec, ibogarecords)
 *   - a real conflict across the whole listing: one name linked to two
 *     different acceptable profiles, or one profile linked to two different
 *     names — both sides are dropped on every night. A rejected track/podcast
 *     link never counts towards a conflict (Rós: a podcast episode on one
 *     night and her profile on another keeps the profile).
 *
 * A handle that doesn't resemble the stage name (lucaf for Luca Abayan,
 * candela-antuna for Anexa) is accepted: the venue's own link is the
 * evidence, and real-name handles are common.
 */

export type SoundcloudLinkRejection =
  | "not-soundcloud"
  | "not-a-profile"
  | "reserved-path"
  | "venue-account"
  | "label-or-organisation"
  | "conflicting-profiles"
  | "shared-profile";

const SOUNDCLOUD_HOSTS = new Set(["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"]);

/** Top-level soundcloud.com paths that are SoundCloud pages, never a user. */
const RESERVED_PATHS = new Set([
  "charts",
  "discover",
  "feed",
  "imprint",
  "jobs",
  "messages",
  "mobile",
  "notifications",
  "pages",
  "people",
  "popular",
  "search",
  "settings",
  "signin",
  "stations",
  "stream",
  "tags",
  "terms-of-use",
  "upload",
  "you",
]);

const VENUE_ACCOUNTS = new Set(["cultureboxcopenhagen", "culturebox", "culture-box"]);

/** Handle words that mark a label/organisation account rather than an artist. Matched against the handle only. */
const ORGANISATION_HANDLE = /records?|recordings|(?:^|[-_])rec(?:$|[-_])|label|agency|booking|podcast|radio/;

const HANDLE = /^[a-z0-9_-]+$/;

/** Normalized profile URL for an acceptable-looking SoundCloud profile link, or the reason it isn't one (before cross-listing conflict checks). */
export function soundcloudProfileUrl(href: string): { url: string } | { rejected: SoundcloudLinkRejection } {
  let parsed: URL;
  try {
    parsed = new URL(href.trim());
  } catch {
    return { rejected: "not-soundcloud" };
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !SOUNDCLOUD_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { rejected: "not-soundcloud" };
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return { rejected: "not-a-profile" };
  const handle = segments[0].toLowerCase();
  if (!HANDLE.test(handle)) return { rejected: "not-a-profile" };
  if (RESERVED_PATHS.has(handle)) return { rejected: "reserved-path" };
  if (VENUE_ACCOUNTS.has(handle)) return { rejected: "venue-account" };
  if (ORGANISATION_HANDLE.test(handle)) return { rejected: "label-or-organisation" };
  return { url: `https://soundcloud.com/${handle}` };
}

export interface LineupLinkObservation {
  /** Which candidate (night) on the listing this link belongs to. */
  candidateIndex: number;
  /** Lineup display name exactly as the listing's anchor text gives it. */
  name: string;
  href: string;
}

export type ClassifiedLineupLink = LineupLinkObservation &
  ({ status: "accepted"; url: string } | { status: "rejected"; reason: SoundcloudLinkRejection });

/** Groups names that differ only by case/spacing, so "RÓS" and "Rós" are one identity for conflict checks. */
function identityKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Classifies every lineup link on one listing page, including the cross-night conflict checks. */
export function classifyLineupLinks(observations: LineupLinkObservation[]): ClassifiedLineupLink[] {
  const shaped = observations.map((o) => ({ o, shape: soundcloudProfileUrl(o.href) }));

  const urlsByName = new Map<string, Set<string>>();
  const namesByUrl = new Map<string, Set<string>>();
  for (const { o, shape } of shaped) {
    if (!("url" in shape)) continue;
    const key = identityKey(o.name);
    if (!urlsByName.has(key)) urlsByName.set(key, new Set());
    urlsByName.get(key)!.add(shape.url);
    if (!namesByUrl.has(shape.url)) namesByUrl.set(shape.url, new Set());
    namesByUrl.get(shape.url)!.add(key);
  }

  return shaped.map(({ o, shape }): ClassifiedLineupLink => {
    if (!("url" in shape)) return { ...o, status: "rejected", reason: shape.rejected };
    if (urlsByName.get(identityKey(o.name))!.size > 1) return { ...o, status: "rejected", reason: "conflicting-profiles" };
    if (namesByUrl.get(shape.url)!.size > 1) return { ...o, status: "rejected", reason: "shared-profile" };
    return { ...o, status: "accepted", url: shape.url };
  });
}

/** Accepted links per candidate index, one per name, in listing order. Every candidate index in `candidateCount` gets an entry (possibly empty). */
export function acceptedLinksByCandidate(classified: ClassifiedLineupLink[], candidateCount: number): ArtistSoundcloudLink[][] {
  const out: ArtistSoundcloudLink[][] = Array.from({ length: candidateCount }, () => []);
  for (const link of classified) {
    if (link.status !== "accepted") continue;
    const list = out[link.candidateIndex];
    if (list.some((l) => l.name === link.name)) continue;
    list.push({ name: link.name, url: link.url });
  }
  return out;
}
