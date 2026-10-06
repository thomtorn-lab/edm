/**
 * SEO <title> and meta-description builders for the event and venue detail
 * pages (SEO metadata work, 2026-10-06). Pure string logic — every value
 * comes from data the page itself already renders (title, venue, date,
 * lineup, genres, venue description/address), never anything invented.
 *
 * Titles returned here already carry the brand suffix, so callers must pass
 * them as `title: { absolute }` — the root layout's `%s — Electronic CPH`
 * template would otherwise append the brand a second time.
 */
import { getCopenhagenParts } from "./datetime";
import { formatFullDateLabel } from "./format";

export const SEO_BRAND = "Electronic CPH";
const BRAND_SUFFIX = ` | ${SEO_BRAND}`;
const CITY = "Copenhagen";

/** Titles above this are shortened — roughly what Google shows before cutting the visible title. */
export const SEO_TITLE_MAX = 70;
/** Descriptions above this are shortened — Google cuts snippets around 155-160 chars. */
export const SEO_DESCRIPTION_MAX = 160;

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** The event's display title, or its lineup when the title is blank — never an empty name. */
function eventName(input: { title: string; artists: string[] }): string {
  return clean(input.title) || input.artists.map(clean).filter(Boolean).join(", ") || "Electronic music event";
}

function mentionsCity(text: string): boolean {
  return /copenhagen|københavn/i.test(text);
}

/** "TAP1, Copenhagen" — never "Gravity Copenhagen, Copenhagen", and just "Copenhagen" when the venue name is missing. */
function venueWithCity(venueName: string): string {
  if (!venueName) return CITY;
  return mentionsCity(venueName) ? venueName : `${venueName}, ${CITY}`;
}

/** e.g. "23 Oct 2026", as the calendar date in Europe/Copenhagen. Empty string for a missing/unparseable datetime. */
export function formatSeoDate(datetime: string | null | undefined): string {
  if (!datetime) return "";
  const date = new Date(datetime);
  if (Number.isNaN(date.getTime())) return "";
  const parts = getCopenhagenParts(date);
  return `${parts.day} ${MONTH_ABBR[parts.month - 1]} ${parts.year}`;
}

// Natural break points inside an event title: series/room joins, subtitles,
// "presents"/"with" lineups and lineup lists. Each is a whole separator, so
// cutting at one never splits a word or an artist's name. " & " and " x "
// are deliberately absent — they are part of many act names (Dense & Pika,
// Above & Beyond).
const TITLE_BREAKS = [" · ", " | ", " – ", " — ", " - ", ": ", " presents ", " pres. ", " w/ ", " with ", " b2b ", " / ", ", ", " + "];

/**
 * Shortens `text` to at most `max` chars without cutting through a word or
 * name: first at the latest natural separator that fits, otherwise at the
 * last whole word, marked with an ellipsis. A separator cut reads as a
 * complete name in a title ("Fast Forward Records Label Night"), but in
 * running prose it is a half sentence — pass `markSeparatorCut` there so it
 * gets the ellipsis too. Returns `text` unchanged when it already fits.
 */
export function shortenNaturally(text: string, max: number, markSeparatorCut = false): string {
  if (text.length <= max) return text;
  if (markSeparatorCut) max -= 1;
  let best = "";
  for (const sep of TITLE_BREAKS) {
    let idx = text.toLowerCase().indexOf(sep.toLowerCase());
    while (idx > 0) {
      const head = text.slice(0, idx).trim();
      if (head.length <= max && head.length > best.length) best = head;
      idx = text.toLowerCase().indexOf(sep.toLowerCase(), idx + 1);
    }
  }
  // A separator cut that keeps at least half the room is a clean, natural
  // title ("Black Box: A · Red Box: B" -> "Black Box: A"); anything shorter
  // throws away too much, so fall back to a word cut instead.
  if (best && best.length >= max / 2) {
    const head = best.replace(/[\s,:;–—\-·|/+&]+$/u, "");
    return markSeparatorCut ? `${head}…` : head;
  }

  const words = text.split(" ");
  let out = "";
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length + (markSeparatorCut ? 0 : 1) > max) break; // room for the ellipsis
    out = next;
  }
  if (!out) return best || text.slice(0, max); // a single unbreakable word longer than max — nothing better exists
  return `${out.replace(/[\s,:;–—\-·|/+&]+$/u, "")}…`;
}

export interface EventSeoInput {
  /** The page's display title (after cleanEventTitle). */
  title: string;
  venueName: string;
  startDatetime: string;
  artists: string[];
  /** Display genre labels as shown on the page, e.g. ["Techno", "House"]. */
  genres?: string[];
  /** Whether the page itself shows the lineup under the title (shouldShowArtistPreview). */
  showArtists?: boolean;
}

/**
 * "[Event] - [Venue], Copenhagen - [23 Oct 2026] | Electronic CPH".
 * When too long the date goes first, then the brand suffix, and only then
 * is the event name shortened at a natural break — the recognizable event
 * name, venue and Copenhagen always survive. Missing pieces are left out
 * rather than rendered empty.
 */
export function buildEventSeoTitle(input: EventSeoInput): string {
  const venue = clean(input.venueName);
  const name = eventName(input);
  const place = venueWithCity(venue);
  const date = formatSeoDate(input.startDatetime);

  const full = [name, place, date].filter(Boolean).join(" - ") + BRAND_SUFFIX;
  if (full.length <= SEO_TITLE_MAX) return full;

  const withoutDate = `${name} - ${place}${BRAND_SUFFIX}`;
  if (withoutDate.length <= SEO_TITLE_MAX) return withoutDate;

  const tail = ` - ${place}`;
  return shortenNaturally(name, SEO_TITLE_MAX - tail.length) + tail;
}

/** Joins whole names, stopping before the one that would exceed `max`; "and more" marks any left out. */
function joinNamesWithin(names: string[], max: number): string {
  let out = "";
  for (let i = 0; i < names.length; i++) {
    const next = out ? `${out}, ${names[i]}` : names[i];
    const more = i < names.length - 1 ? " and more" : "";
    if (next.length + more.length > max) return out ? `${out} and more` : "";
    out = next;
  }
  return out;
}

/**
 * "Eric Prydz at TAP1, Copenhagen on Friday 23 October 2026. Lineup: A, B
 * and more. Techno · House." — event name, venue and local date always;
 * the lineup (only when the page shows it) and genres only as far as they
 * fit, never cut mid-name.
 */
export function buildEventSeoDescription(input: EventSeoInput): string {
  const venue = clean(input.venueName);
  const name = eventName(input);
  const where = venue ? ` at ${venueWithCity(venue)}` : ` in ${CITY}`;
  const date = input.startDatetime && formatSeoDate(input.startDatetime) ? ` on ${formatFullDateLabel(input.startDatetime)}` : "";
  let description = `${name}${where}${date}.`;
  if (description.length > SEO_DESCRIPTION_MAX) {
    const rest = `${where}${date}.`;
    description = shortenNaturally(name, SEO_DESCRIPTION_MAX - rest.length, true) + rest;
  }

  const artists = input.artists.map(clean).filter(Boolean);
  if (input.showArtists && artists.length > 0) {
    const room = SEO_DESCRIPTION_MAX - description.length - " Lineup: .".length;
    const lineup = joinNamesWithin(artists, room);
    if (lineup) description += ` Lineup: ${lineup}.`;
  }

  const genres = (input.genres ?? []).map(clean).filter(Boolean).join(" · ");
  if (genres && description.length + genres.length + 2 <= SEO_DESCRIPTION_MAX) description += ` ${genres}.`;

  return description;
}

export interface VenueSeoInput {
  /** The public venue label (publicVenueLabel), e.g. "MODULE" or "Jolene (Club)". */
  label: string;
  address?: string | null;
  description?: string | null;
  shortDescription?: string | null;
}

/** "Jolene (Club)" -> "Jolene": the parenthetical is a directory disambiguator, not part of the name people search for. */
function venueSearchName(label: string): string {
  return clean(label).replace(/\s*\([^)]*\)\s*$/, "") || clean(label);
}

/** "[Venue] Copenhagen - Upcoming Events | Electronic CPH" (no doubled "Copenhagen" for e.g. "Gravity Copenhagen"). */
export function buildVenueSeoTitle(input: VenueSeoInput): string {
  const name = venueSearchName(input.label);
  const place = !name ? CITY : mentionsCity(name) ? name : `${name} ${CITY}`;
  const tail = ` - Upcoming Events${BRAND_SUFFIX}`;
  const full = place + tail;
  if (full.length <= SEO_TITLE_MAX) return full;
  return `${place}${BRAND_SUFFIX}`;
}

/**
 * What the page lists, followed by the venue's own stored description, e.g.
 * "Upcoming electronic music events at MODULE, Copenhagen. Basement
 * nightclub near Copenhagen City Hall built specifically for house, techno
 * and industrial sound, with a strict no-photo policy." Uses the longest
 * overview phrasing and description that fit together; only when no stored
 * description fits whole is one shortened (at a clause or word, with an
 * ellipsis).
 * Falls back to the address, never to an empty or "undefined" field.
 */
export function buildVenueSeoDescription(input: VenueSeoInput): string {
  const label = clean(input.label);
  const place = label ? venueWithCity(label) : CITY;
  const at = label ? "at" : "in";
  const overviews = [`Upcoming electronic music events ${at} ${place}.`, `Upcoming events ${at} ${place}.`];
  const candidates = [clean(input.description), clean(input.shortDescription)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const overview of overviews) {
    const fitting = candidates.find((c) => overview.length + 1 + c.length <= SEO_DESCRIPTION_MAX);
    if (fitting) return `${overview} ${fitting}`;
  }
  if (candidates.length > 0) {
    const overview = overviews[0];
    const shortest = candidates[candidates.length - 1];
    return `${overview} ${shortenNaturally(shortest, SEO_DESCRIPTION_MAX - overview.length - 1, true)}`;
  }

  const address = clean(input.address);
  return address && overviews[0].length + address.length + 3 <= SEO_DESCRIPTION_MAX
    ? `${overviews[0].slice(0, -1)} — ${address}.`
    : overviews[0];
}
