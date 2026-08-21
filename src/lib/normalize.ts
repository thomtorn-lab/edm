import type { Venue } from "./types";

/**
 * Venue and artist normalization (spec sections 37-38). Keeps matching
 * conservative: venues resolve through a curated alias list rather than
 * fuzzy string distance (short venue names collide too easily), while
 * artists only collapse obvious formatting noise, never near-miss spellings.
 */

export function normalizeVenueName(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveVenue(rawName: string, venues: Venue[]): Venue | undefined {
  const target = normalizeVenueName(rawName);
  return venues.find((v) => {
    if (normalizeVenueName(v.name) === target) return true;
    return v.aliases.some((alias) => normalizeVenueName(alias) === target);
  });
}

/**
 * Strips URL noise out of a raw artist/lineup entry (Electronic CPH
 * data-quality work package, Workstream D): a source's own markup routinely
 * carries an artist's SoundCloud/Instagram/Spotify link appended right next
 * to their name (e.g. "Kromagon: soundcloud.com/aragon -", or the same with
 * an explicit "https://" scheme) — that raw URL must never leak into the
 * stored artist name. Matches both schemed URLs and bare "domain.tld/path"
 * tokens (a bare link commonly loses its "https://" prefix when lifted from
 * an anchor's visible text rather than its href), but only ever removes an
 * actual URL-shaped substring — never touches an artist's real punctuation,
 * initials or aliases (e.g. "R.O.O.T." has no trailing path, so it never
 * matches). Only the URL substring is removed; real surrounding text is kept.
 */
/**
 * Collapses a "<label>: - <duplicate of the end of label>" residue shape
 * left behind when a URL sat between two mentions of the same label text
 * (real evidence: Hangaren's "Fagins Reject – Wild Things Records: <a
 * href=soundcloud.com/...>soundcloud.com/...</a> - Wild things Records" —
 * the source repeats the label on both sides of the artist's own link).
 * Only fires when the text after the dangling "-" is, case-insensitively, a
 * trailing duplicate of the text before the colon — a genuinely distinct
 * alias or affiliation after a real "-" (never a duplicate) is left
 * untouched, so this never eats legitimate punctuation.
 */
function collapseDuplicatedLabelResidue(text: string): string {
  const match = text.match(/^(.*?):\s*-\s*(.+)$/);
  if (!match) return text;
  const [, before, after] = match;
  const beforeNorm = before.toLowerCase().replace(/\s+/g, " ").trim();
  const afterNorm = after.toLowerCase().replace(/\s+/g, " ").trim();
  if (afterNorm.length > 0 && beforeNorm.endsWith(afterNorm)) {
    return before.trim();
  }
  return text;
}

function stripUrlNoise(text: string): string {
  const withoutUrls = text
    // Invisible Unicode formatting characters (zero-width space/joiner/non-
    // joiner, BOM) — real source markup routinely places one of these
    // between two adjacent links with no visible separator (observed live:
    // Hangaren's "Arcanum Collective: POSSESSED" lineup joins two artists'
    // SoundCloud links with a bare zero-width joiner); stripped unconditionally
    // since none of them are ever legitimate, visible artist-name content.
    .replace(/[​-‏⁠﻿]/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b(?:www\.)?[a-z0-9-]+\.(?:com|dk|net|org|io|co|uk|fm|ly)\/\S*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return collapseDuplicatedLabelResidue(withoutUrls)
    .replace(/^[\s:;,|–—-]+|[\s:;,|–—-]+$/g, "")
    .trim();
}

/**
 * Strips trailing parenthetical qualifiers (e.g. "(DK)") and normalizes
 * case/whitespace so "DJ NAME", "Dj Name" and "DJ NAME (DK)" resolve to the
 * same performer, without merging genuinely different artists.
 */
export function normalizeArtistName(name: string): string {
  return stripUrlNoise(name)
    .normalize("NFKD")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function artistNamesMatch(a: string, b: string): boolean {
  return normalizeArtistName(a) === normalizeArtistName(b);
}

/**
 * Cleans and deduplicates a raw artist/lineup list — the single funnel every
 * adapter's `artists` array passes through (src/lib/adapters/pipeline.ts),
 * so URL-noise stripping (see stripUrlNoise) applies uniformly regardless of
 * source. A name that turns out to be nothing but a URL (no real display
 * text) is dropped entirely rather than stored as an empty string.
 */
export function dedupeArtistList(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const name of names) {
    const cleaned = stripUrlNoise(name);
    if (!cleaned) continue;
    const key = normalizeArtistName(cleaned);
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, cleaned);
  }
  return Array.from(seen.values());
}
