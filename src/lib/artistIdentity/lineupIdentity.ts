import { normalizeArtistName } from "../normalize";
import { cleanArtistDisplayName, isShortGenericArtistName } from "../enrichment/genreEnrichment";
import { classifyArtistName, type NameClassification } from "../enrichment/artistNameClassification";

/**
 * Lineup identity rules for Artist Alerts (Phase A, report-only, 2026-10-24).
 * Pure functions: nothing in the app calls these yet. src/db/
 * artistIdentityAudit.ts applies them, read-only, to Production lineups so
 * the rules can be reviewed (approval point G1) before any table or job
 * depends on them.
 *
 * Two questions are kept apart on purpose:
 * - which artist a lineup name refers to (`artistIdentityKey`), and
 * - how sure we are that THIS appearance belongs to that artist
 *   (`classifyAppearance`). Only "high" appearances could ever trigger an
 *   alert; everything else needs an admin or is excluded.
 */

/** Always split: these join individually billed performers, never a duo name. */
const STRONG_SEPARATOR = /\s+(?:b2b|b3b|b4b|back\s*to\s*back)\s+/iu;

/**
 * Never split automatically: "&", "x", "+", "vs", "and"/"og", "w/" and commas
 * also occur inside established names (Chase & Status, Above & Beyond).
 * An entry containing one is reported for review instead.
 */
const WEAK_SEPARATOR = /\s(?:&|\+|x|vs\.?|and|og|w\/)\s|,\s/iu;

/**
 * Words and shapes that mark an event title, series or label rather than a
 * performer ("Protoned Christmas Rave", "ALICE TUNES IN: …", "Fagins Reject –
 * Wild Things Records"). Grounded in the 2026-10-24 local fixture analysis.
 * Deliberately excludes "club" and "live" (real act names use both).
 */
const EVENT_MARKER =
  /:\s|\s[–—-]\s|\bpres\.?\s|\bpresents\b|\bby\s|\bin copenhagen\b|\b(?:fest|festival|rave|party|christmas|halloween|edition|tour|night|showcase|concert|records|recordings|collective|soundsystem|tunes in|celebration|ekstra)\b/iu;

export type AppearanceBucket =
  /** The shared non-artist classification says this is not a performer. */
  | "not_artist"
  /** The name is a venue's own name, alias or room. */
  | "venue_name"
  /** The source's own SoundCloud link names this artist. */
  | "handle"
  /** The event title stored as the artist, plus an event word. */
  | "title_copy_marker"
  /** An event word, series or label shape. */
  | "event_marker"
  /** Contains "&", "x", "+", "," … — possibly several acts. */
  | "weak_split"
  /** Four letters or fewer: collides across unrelated people too often. */
  | "short_generic"
  /** The event title stored as the only artist, no event word. Decision pending at G1. */
  | "title_copy"
  /** A distinctive name with no warning sign. */
  | "distinct";

export type AppearanceConfidence = "high" | "review" | "excluded" | "pending_decision";

export const BUCKET_CONFIDENCE: Record<AppearanceBucket, AppearanceConfidence> = {
  not_artist: "excluded",
  venue_name: "excluded",
  handle: "high",
  title_copy_marker: "review",
  event_marker: "review",
  weak_split: "review",
  short_generic: "review",
  title_copy: "pending_decision",
  distinct: "high",
};

export interface LineupPart {
  /** The performer name as billed, after splitting off B2B partners. */
  name: string;
  /** True when this part came from splitting an "X b2b Y" entry. */
  fromB2bSplit: boolean;
}

/** Splits only on B2B-style separators; everything else stays whole. */
export function splitLineupEntry(entry: string): LineupPart[] {
  if (!STRONG_SEPARATOR.test(entry)) return [{ name: entry.trim(), fromB2bSplit: false }];
  return entry
    .split(STRONG_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((name) => ({ name, fromB2bSplit: true }));
}

export function hasStrongSeparator(entry: string): boolean {
  return STRONG_SEPARATOR.test(entry);
}

export function hasWeakSeparator(name: string): boolean {
  return WEAK_SEPARATOR.test(name);
}

export function hasEventMarker(name: string): boolean {
  return EVENT_MARKER.test(name);
}

/**
 * The key two lineup names must share to be considered the same artist.
 * Unlike normalizeArtistName alone, it also drops trailing "[label]"
 * brackets ("Damian Lazarus [Crosstown Rebels]"), every trailing bracket
 * group, and — only when the shared classification calls them cleanable —
 * a trailing country code ("Mike Sheridan DK") or status tail ("– NEW DATE").
 */
export function artistIdentityKey(name: string, classification: NameClassification = classifyArtistName(name)): string {
  let cleaned = cleanArtistDisplayName(name);
  if (classification.rules.includes("status_tag") && classification.verdict === "cleanable") {
    cleaned = cleaned.replace(/\s*[–—-]?\s*\b(?:new date|nyt? dato|sold out|udsolgt|cancel+ed|aflyst|postponed|udsat|rescheduled)\b.*$/iu, "").trim();
  }
  if (classification.rules.includes("country_code_suffix")) {
    cleaned = cleaned.replace(/\s+[A-Z]{2}(?:\/[A-Z]{2})*$/u, "").trim();
  }
  return normalizeArtistName(cleaned);
}

export interface AppearanceInput {
  /** The full lineup entry as stored in events.artists. */
  entry: string;
  /** One performer from that entry (see splitLineupEntry). */
  part: LineupPart;
  eventTitle: string;
  /** Number of entries in the event's lineup. */
  lineupSize: number;
  /** The source linked this exact name (or its key) to a SoundCloud profile on this event. */
  hasSourceHandle: boolean;
  /** Identity keys of every venue name, alias and room. */
  venueKeys: ReadonlySet<string>;
}

export interface AppearanceClassification {
  key: string;
  bucket: AppearanceBucket;
  confidence: AppearanceConfidence;
  /** The event title is stored as this artist (single-entry lineup, same key). */
  titleCopy: boolean;
  classification: NameClassification;
}

export function classifyAppearance(input: AppearanceInput): AppearanceClassification {
  const { part } = input;
  const classification = classifyArtistName(part.name);
  const key = artistIdentityKey(part.name, classification);
  const cleaned = cleanArtistDisplayName(part.name);
  const titleCopy =
    input.lineupSize === 1 && !part.fromB2bSplit && artistIdentityKey(input.eventTitle) === artistIdentityKey(input.entry);

  let bucket: AppearanceBucket;
  if (classification.verdict === "not_artist" || key.length === 0) bucket = "not_artist";
  else if (input.venueKeys.has(key)) bucket = "venue_name";
  else if (input.hasSourceHandle) bucket = "handle";
  else if (titleCopy && hasEventMarker(cleaned)) bucket = "title_copy_marker";
  else if (hasEventMarker(cleaned)) bucket = "event_marker";
  else if (hasWeakSeparator(cleaned)) bucket = "weak_split";
  else if (isShortGenericArtistName(cleaned)) bucket = "short_generic";
  else if (titleCopy) bucket = "title_copy";
  else bucket = "distinct";

  return { key, bucket, confidence: BUCKET_CONFIDENCE[bucket], titleCopy, classification };
}

/** Parts of a weak-separator entry ("Kevin de Vries & Massano" -> ["Kevin de Vries", "Massano"]), for checking whether each is already known on its own. */
export function weakSeparatorParts(name: string): string[] {
  return cleanArtistDisplayName(name)
    .split(/\s(?:&|\+|x|vs\.?|and|og|w\/)\s|,\s/iu)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
