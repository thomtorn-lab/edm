import { cleanArtistDisplayName, isPlaceholderArtistName } from "./genreEnrichment";

/**
 * REPORT-ONLY classification of lineup entries that are probably not a
 * single artist (YouTube preview enrichment plan, 2026-10-14). Nothing in
 * production calls this: it exists so src/db/youtubePreviewRiskReport.ts
 * can list, read-only, which existing names each rule WOULD flag, before
 * anyone decides whether a rule should ever be enforced.
 *
 * Every rule is deliberately narrow and grounded in a concrete production
 * example (the 2026-10-13 backlog listed "Karrusel 2027", "IBOGA 30 years",
 * "Dengue Dengue Dengue PE – NEW DATE", "Neelix & friends", "DJs",
 * "Electro Shock Therapy @ Basement", "Xuri & John Clewort DK & Gábor Lázár
 * HU", ...). Two outcomes are kept apart on purpose:
 *
 * - "not_artist": the whole entry looks like an event title, a status tag
 *   or a generic label — a candidate for skipping the YouTube lookup.
 * - "cleanable": a real artist name with source decoration (a trailing
 *   country code, a status tail) — a candidate for cleaning the SEARCH name,
 *   never for skipping the artist.
 *
 * Protected by tests: Above & Beyond, Chase & Status, Camo & Krooked, Vini
 * Vici, 2manydjs, MCR-T, Jamie xx / JAMIE XX, !!!, Fred again.., 1991 (a real
 * drum & bass artist — the reason a bare year is never a rule) and every
 * name that currently holds an accepted YouTube match must stay "ok".
 */

export type NameVerdict = "ok" | "not_artist" | "cleanable";

export type NameRule =
  | "placeholder"
  | "event_year"
  | "anniversary"
  | "status_tag"
  | "and_friends"
  | "generic_label"
  | "venue_marker"
  | "series_number"
  | "multi_artist_list"
  | "country_code_suffix";

export interface NameClassification {
  verdict: NameVerdict;
  rules: NameRule[];
  /** The name the classification was computed on (trailing bracket annotations removed, exactly like the matcher does). */
  cleanedName: string;
}

/** An event-edition year (2020–2039) next to other words: "Karrusel 2027", "Relevance 2027 - Ten Year Anniversary". A bare year ("1991") is never flagged. */
const EVENT_YEAR = /(^|[^\p{L}\p{N}])20[23]\d([^\p{L}\p{N}]|$)/u;
const ANNIVERSARY = /\b\d+\s*(?:years?|year anniversary|års?|jahre)\b|\banniversary\b|\bjubilæum\b/iu;
const STATUS_TAG = /\b(?:new date|nyt? dato|sold out|udsolgt|cancel+ed|aflyst|postponed|udsat|rescheduled)\b/iu;
const AND_FRIENDS = /(?:&|\band\b|\bog\b)\s*(?:friends|venner)\b|\band more\b|\bmed flere\b|\bm\.\s*fl\.?/iu;
const VENUE_MARKER = /\s@\s/u;
const SERIES_NUMBER = /\bno\.\s*\d+|#\s*\d+\b/iu;
const GENERIC_LABELS = new Set([
  "dj",
  "djs",
  "dj's",
  "live",
  "guests",
  "guest",
  "special guest",
  "special guests",
  "support",
  "supports",
  "residents",
  "resident djs",
  "local djs",
  "b2b",
  "various artists",
  "va",
  "line-up",
  "lineup",
  "more tba",
  "and more",
  "+ more",
  "tba+",
]);

/** ISO 3166-1 alpha-2 codes actually seen as lineup suffixes, plus a few close neighbours. Upper-case only, and only after a mixed- or lower-case name (see countryCodeSuffix). */
const COUNTRY_CODES = new Set([
  "DK", "SE", "NO", "FI", "IS", "DE", "AT", "CH", "NL", "BE", "FR", "UK", "GB", "IE", "ES", "PT", "IT",
  "PL", "CZ", "HU", "RO", "GR", "US", "CA", "MX", "BR", "AR", "CL", "CO", "PE", "AU", "NZ", "ZA", "JP",
]);

/**
 * "Byetone DE", "Amelie Duchow DE", "Dengue Dengue Dengue PE", "La Tène FR/CH".
 * Only when the rest of the name is NOT written in capitals, so an all-caps
 * lineup entry ("JAMIE XX", "SUB FOCUS DE"?) is never touched — in an
 * all-caps line a two-letter tail cannot be told apart from part of the name.
 */
function countryCodeSuffix(name: string): boolean {
  const match = /^(.*\S)\s+([A-Z]{2}(?:\/[A-Z]{2})*)$/u.exec(name);
  if (!match) return false;
  const [, rest, codes] = match;
  if (!codes.split("/").every((c) => COUNTRY_CODES.has(c))) return false;
  const letters = rest.replace(/[^\p{L}]/gu, "");
  return letters.length > 0 && letters !== letters.toUpperCase();
}

/** Two or more " & " joins in one entry ("Xuri & John Clewort DK & Gábor Lázár HU"). A single "&" is a duo name far too often (Above & Beyond, Chase & Status) to flag. */
function multiArtistList(name: string): boolean {
  return (name.match(/\s&\s/g) ?? []).length >= 2;
}

export function classifyArtistName(raw: string): NameClassification {
  const cleanedName = cleanArtistDisplayName(raw);
  const lower = cleanedName.trim().toLowerCase().replace(/\s+/g, " ");
  const notArtist: NameRule[] = [];
  const cleanable: NameRule[] = [];

  if (isPlaceholderArtistName(cleanedName)) notArtist.push("placeholder");
  if (GENERIC_LABELS.has(lower)) notArtist.push("generic_label");
  if (EVENT_YEAR.test(cleanedName) && /\p{L}/u.test(cleanedName)) notArtist.push("event_year");
  if (ANNIVERSARY.test(cleanedName)) notArtist.push("anniversary");
  if (AND_FRIENDS.test(cleanedName)) notArtist.push("and_friends");
  if (VENUE_MARKER.test(cleanedName)) notArtist.push("venue_marker");
  if (SERIES_NUMBER.test(cleanedName)) notArtist.push("series_number");
  if (multiArtistList(cleanedName)) notArtist.push("multi_artist_list");

  // A status tail on an otherwise real name is cleanable ("Dengue Dengue
  // Dengue PE – NEW DATE"); a status tag on its own is not an artist.
  if (STATUS_TAG.test(cleanedName)) {
    const withoutStatus = cleanedName.replace(/\s*[–—-]?\s*\b(?:new date|nyt? dato|sold out|udsolgt|cancel+ed|aflyst|postponed|udsat|rescheduled)\b.*$/iu, "").trim();
    if (/\p{L}/u.test(withoutStatus)) cleanable.push("status_tag");
    else notArtist.push("status_tag");
  }
  const forSuffix = cleanedName.replace(/\s*[–—-]\s*\b(?:new date|nyt? dato)\b.*$/iu, "").trim();
  if (countryCodeSuffix(forSuffix)) cleanable.push("country_code_suffix");

  if (notArtist.length > 0) return { verdict: "not_artist", rules: [...notArtist, ...cleanable], cleanedName };
  if (cleanable.length > 0) return { verdict: "cleanable", rules: cleanable, cleanedName };
  return { verdict: "ok", rules: [], cleanedName };
}
