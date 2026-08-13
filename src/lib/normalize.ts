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
 * Strips trailing parenthetical qualifiers (e.g. "(DK)") and normalizes
 * case/whitespace so "DJ NAME", "Dj Name" and "DJ NAME (DK)" resolve to the
 * same performer, without merging genuinely different artists.
 */
export function normalizeArtistName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function artistNamesMatch(a: string, b: string): boolean {
  return normalizeArtistName(a) === normalizeArtistName(b);
}

export function dedupeArtistList(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const name of names) {
    const key = normalizeArtistName(name);
    if (!seen.has(key)) seen.set(key, name.trim());
  }
  return Array.from(seen.values());
}
