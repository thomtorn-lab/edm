import type { EventRecord, Venue } from "./types";
import { normalizeArtistName, resolveVenue } from "./normalize";

/**
 * Series memory for the admin review queue (coverage work, phase 2,
 * 2026-10-18): "this looks like the next night of a series we already
 * published". Final Descent is the motivating case — the KultuNaut row
 * "Final Descent: Amina Hocine (SE) + Barbara Skovmand (DK)" at Basement
 * names no genre, but "69/96: The Final Descent" at Basement and "Final
 * Descent: Nyx (UK)" at ALICE are both published techno nights.
 *
 * Like the rest of reviewPriority.ts this only RANKS and EXPLAINS: it is read
 * by the admin page and the read-only inspect script, never by ingestion,
 * sync, relevance or classification, and it never publishes, picks a genre
 * or changes a row's status.
 *
 * A match is deliberately hard to get, because an earlier publish can itself
 * be an editorial mistake and must not simply be copied forward:
 *   - the shared key must name a series: venue, room and area names
 *     ("MODULE", "Black Box", "Byhaven"), artist names, weekdays and generic
 *     words ("Halloween party", "Techno night") never count;
 *   - an earlier published event alone is not enough — it also needs
 *     supporting evidence that this row belongs to the same electronic
 *     series (see SeriesSupport);
 *   - an earlier event an admin unpublished as "irrelevant" counts against
 *     the series; one unpublished as a duplicate, cancelled, incorrect data
 *     or "other" says nothing about the genre and is left out entirely;
 *   - the same night at the same venue is the dedup check's business, not
 *     series memory, so an event within 24 hours of the row is ignored.
 */

export type SeriesHistoryEvent = Pick<
  EventRecord,
  "id" | "title" | "venueId" | "artists" | "startDatetime" | "published" | "adminUnpublishReason"
>;

/**
 * Room and area names that are not registered as venue rooms but appear as
 * the first part of many unrelated titles: Culture Box's two rooms and
 * Pumpehuset's free pop-up area. A series key equal to one of these is a
 * place, not a series.
 */
const PLACE_NAMES_OUTSIDE_REGISTRY = ["black box", "red box", "byhaven"];

/** Words that never identify a series on their own: formats, occasions, genres, weekdays, months, filler. */
const GENERIC_WORDS: ReadonlySet<string> = new Set(
  (
    "the a an and of og i på med til fra for in at on de en et den det der som by new ny nye " +
    "x vs feat ft pres presents present presenterer w with " +
    "party parties fest festival night nights nat aften klubaften club klub rave raves dj djs b2b set sets live koncert concert " +
    "edition special release tour weekend vol nr no anniversary jubilæum år year years birthday bday celebration launch " +
    "session sessions open air day days opening closing afterparty after pre warmup warm up showcase takeover " +
    "halloween christmas xmas jul julefrokost nytår nytårsaften nye easter påske sommer summer winter vinter " +
    "spring forår autumn efterår " +
    "techno house trance psytrance disco electro electronic elektronisk dance dancefloor bass drum dnb dubstep garage " +
    "hardstyle hardcore ambient minimal deep tech progressive afro industrial music musik " +
    "monday tuesday wednesday thursday friday saturday sunday mandag tirsdag onsdag torsdag fredag lørdag søndag " +
    "january february march april may june july august september october november december " +
    "januar februar marts maj juni juli oktober " +
    "free gratis entry tickets ticket billetter"
  ).split(/\s+/),
);

/** Title separators between a series name, a lineup and other parts. "&" is not one: it joins artist names. */
const SEGMENT_SPLIT_RE = /\s*(?::|\/\/|\s[-–—|+×]\s|\s[x]\s|\spres(?:ents|enterer)?\.?\s|\sw\/\s|\sfeat\.?\s|\sft\.?\s|\swith\s)\s*/i;

/** "(UK)", "(DK/SE)": the segment it ends is an artist name. */
const COUNTRY_CODE_RE = /\((?:[a-z]{2,3})(?:\s*[/,]\s*[a-z]{2,3})*\)/i;

function words(text: string): string[] {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .match(/[\p{L}0-9]+/gu) ?? []
  );
}

/** Venue names, aliases and room names from the registry, plus the known unregistered rooms/areas, as normalised phrases. */
export function placeNames(venues: Venue[]): Set<string> {
  const names = new Set<string>(PLACE_NAMES_OUTSIDE_REGISTRY);
  for (const v of venues) {
    for (const raw of [v.name, ...v.aliases, ...(v.rooms ?? []).flatMap((r) => [r.name, ...(r.aliases ?? [])])]) {
      const phrase = words(raw).join(" ");
      if (phrase) names.add(phrase);
    }
  }
  return names;
}

/**
 * The parts of a title that could name an event series, normalised. A part
 * qualifies with at least two content words, or one content word of five or
 * more letters; it is dropped when it is a place name, an artist on either
 * lineup, ends in a country code, or contains a place-name word on its own
 * ("X MODULE" splits into "X" and "MODULE", the latter a venue).
 */
export function seriesKeys(title: string, lineup: string[], places: ReadonlySet<string>): Set<string> {
  const artists = new Set(lineup.map((a) => words(normalizeArtistName(a)).join(" ")).filter(Boolean));
  const keys = new Set<string>();
  for (const segment of title.split(SEGMENT_SPLIT_RE)) {
    if (!segment || COUNTRY_CODE_RE.test(segment)) continue;
    const all = words(segment);
    const phrase = all.join(" ");
    if (!phrase || places.has(phrase) || artists.has(phrase)) continue;
    const content = all.filter((w) => !GENERIC_WORDS.has(w) && !/\d/.test(w));
    if (content.some((w) => places.has(w))) continue;
    const key = content.join(" ");
    if (places.has(key) || artists.has(key)) continue;
    if (content.length >= 2 || (content.length === 1 && content[0].length >= 5)) keys.add(key);
  }
  return keys;
}

export interface SeriesIndexEntry {
  event: SeriesHistoryEvent;
  keys: Set<string>;
  artists: Set<string>;
}

export interface SeriesIndex {
  byKey: Map<string, SeriesIndexEntry[]>;
  places: Set<string>;
  venues: Venue[];
}

/** Indexes events by series key once per page render; events with no usable key are left out. */
export function buildSeriesIndex(events: SeriesHistoryEvent[], venues: Venue[]): SeriesIndex {
  const places = placeNames(venues);
  const byKey = new Map<string, SeriesIndexEntry[]>();
  for (const event of events) {
    const keys = seriesKeys(event.title, event.artists, places);
    if (keys.size === 0) continue;
    const entry = { event, keys, artists: new Set(event.artists.map(normalizeArtistName)) };
    for (const key of keys) {
      const list = byKey.get(key);
      if (list) list.push(entry);
      else byKey.set(key, [entry]);
    }
  }
  return { byKey, places, venues };
}

/** What, besides the earlier published event, says this row belongs to the same series. */
export type SeriesSupport = "same_venue" | "shared_artist" | "repeated_series" | "own_electronic_signal";

export interface SeriesMatch {
  key: string;
  /** Earlier events in the series that are published and were never taken down by an admin. */
  published: SeriesHistoryEvent[];
  /** Earlier events in the series an admin unpublished as irrelevant: evidence against. */
  irrelevant: SeriesHistoryEvent[];
  /** Earlier events left out on purpose: unpublished as duplicate, cancelled, incorrect data, other, or by the source. */
  neutral: SeriesHistoryEvent[];
  support: SeriesSupport[];
  sameVenue: boolean;
}

export interface SeriesCandidate {
  title: string;
  lineup: string[];
  venueName: string | null;
  start: string | null;
  /** Whether the row has an electronic signal of its own (genre, DJ/club wording, an electronic venue, the source's category). */
  ownElectronicSignal: boolean;
}

const SAME_NIGHT_MS = 24 * 3_600_000;

/**
 * The strongest series match for a row, or null. Picks the key with the
 * most evidence (same venue first, then the number of published events);
 * an "irrelevant" unpublish on any matching key is always reported.
 */
export function findSeriesMatch(candidate: SeriesCandidate, index: SeriesIndex): SeriesMatch | null {
  const keys = seriesKeys(candidate.title, candidate.lineup, index.places);
  if (keys.size === 0) return null;
  const venueId = candidate.venueName ? (resolveVenue(candidate.venueName, index.venues)?.venue.id ?? null) : null;
  const startMs = candidate.start ? new Date(candidate.start).getTime() : null;
  const lineup = new Set(candidate.lineup.map(normalizeArtistName));

  let best: SeriesMatch | null = null;
  for (const key of keys) {
    const entries = (index.byKey.get(key) ?? []).filter(
      (e) => startMs === null || Math.abs(new Date(e.event.startDatetime).getTime() - startMs) >= SAME_NIGHT_MS,
    );
    if (entries.length === 0) continue;
    const published: SeriesHistoryEvent[] = [];
    const irrelevant: SeriesHistoryEvent[] = [];
    const neutral: SeriesHistoryEvent[] = [];
    for (const { event } of entries) {
      if (event.adminUnpublishReason === "irrelevant") irrelevant.push(event);
      else if (event.published && event.adminUnpublishReason === null) published.push(event);
      else neutral.push(event);
    }
    const sameVenue = venueId !== null && published.some((e) => e.venueId === venueId);
    const publishedIds = new Set(published.map((e) => e.id));
    const sharedArtist = entries.some((e) => publishedIds.has(e.event.id) && [...e.artists].some((a) => lineup.has(a)));
    const support: SeriesSupport[] = [];
    if (sameVenue) support.push("same_venue");
    if (sharedArtist) support.push("shared_artist");
    if (published.length >= 2) support.push("repeated_series");
    if (candidate.ownElectronicSignal) support.push("own_electronic_signal");
    const match: SeriesMatch = { key, published, irrelevant, neutral, support, sameVenue };
    if (!best || rank(match) > rank(best)) best = match;
  }
  return best;
}

function rank(m: SeriesMatch): number {
  return (m.irrelevant.length > 0 ? 1000 : 0) + (m.sameVenue ? 100 : 0) + m.published.length * 10 + m.support.length;
}

/**
 * How a match may count. It never counts for a row with no electronic
 * signal of its own, so series memory can raise a row already in the queue
 * but never bring one in. "strong": also the same venue. "supporting":
 * another venue, but the series was published more than once or shares an
 * artist with this row. Anything weaker is shown but not counted.
 */
export function seriesStrength(match: SeriesMatch): "strong" | "supporting" | "unsupported" | "against" {
  if (match.irrelevant.length > 0) return "against";
  const has = (s: SeriesSupport) => match.support.includes(s);
  if (match.published.length === 0 || !has("own_electronic_signal")) return "unsupported";
  if (has("same_venue")) return "strong";
  if (has("shared_artist") || has("repeated_series")) return "supporting";
  return "unsupported";
}

const SUPPORT_LABELS: Record<SeriesSupport, string> = {
  same_venue: "same venue",
  shared_artist: "shared artist",
  repeated_series: "published more than once",
  own_electronic_signal: "this listing has its own electronic signal",
};

/** Short admin-facing explanation of the match: which earlier events, and what supports it. */
export function describeSeriesMatch(match: SeriesMatch, venues: Venue[]): string {
  const venueName = (id: string) => venues.find((v) => v.id === id)?.name ?? id;
  const sample = (events: SeriesHistoryEvent[]) =>
    events
      .slice(0, 2)
      .map((e) => `“${e.title}” (${e.startDatetime.slice(0, 10)}, ${venueName(e.venueId)})`)
      .join(", ") + (events.length > 2 ? ` +${events.length - 2} more` : "");
  if (match.irrelevant.length > 0) {
    return `Series “${match.key}”: ${match.irrelevant.length} earlier event(s) unpublished as irrelevant — ${sample(match.irrelevant)}`;
  }
  const support = match.support.map((s) => SUPPORT_LABELS[s]).join(", ") || "nothing else";
  return `Series “${match.key}”: ${match.published.length} earlier published event(s) — ${sample(match.published)}; support: ${support}`;
}
