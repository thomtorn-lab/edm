import { copenhagenWallClockToUtc, type DateKey } from "../datetime";
import type { RawCandidateEvent, SourceAdapter } from "./types";

/**
 * Real first-party adapter for Hangaren (src-hangaren in src/lib/data/sources.ts).
 *
 * Hangaren has no JSON/ICS feed permitted for automated fetching — its
 * robots.txt explicitly disallows `?format=json` and `?format=ical` for all
 * crawlers (including AI crawlers, named individually). It does NOT disallow
 * the plain `/events` HTML page, which Squarespace server-renders with full
 * event content and machine-readable `<time datetime="…">` tags plus a
 * Google Calendar link carrying exact UTC start/end instants — no headless
 * browser or JS execution required. This adapter fetches that page and
 * parses it; see hangarenAdapter.test.ts for the evaluation notes and a
 * real, unmodified recorded response.
 */

export const HANGAREN_SOURCE_ID = "src-hangaren";
export const HANGAREN_BASE_URL = "https://www.hangaren.dk";
export const HANGAREN_EVENTS_URL = `${HANGAREN_BASE_URL}/events`;
const HANGAREN_VENUE_NAME = "Hangaren";

// ---- HTML text extraction helpers ----

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (full, name) => NAMED_ENTITIES[name] ?? full);
}

/** Renders a Squarespace HTML fragment to plain text the way a browser would display it. */
function htmlToText(html: string): string {
  const withoutStyleScript = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  const withBreaks = withoutStyleScript
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");
  const decoded = decodeHtmlEntities(stripped);
  return decoded
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

const LINEUP_START = /LINE[- ]?UP:?\s*$/i;
const LINEUP_STOP = /^(TICKETS?|ENTRANCE|INFO|WARDROBE|LOCKERS?|THIS IS HOW WE PARTY|VJ LINE[- ]?UP|PLEASE READ|SUNDAY PSY|H[AÅ]NGAREN)\b/i;

/**
 * Best-effort lineup extraction from the event's own description text (not
 * a title guess). Handles the several Unicode "styled" heading variants
 * Hangaren uses ("𝗟𝗜𝗡𝗘-𝗨𝗉:", "𝐋𝐈𝐍𝐄-𝐔𝐏:", "Line-Up") uniformly via NFKD
 * normalization, which decomposes Mathematical Alphanumeric Symbols back to
 * plain Latin letters. Operates on the already-line-split, NFKD-normalized
 * block text (see `blockLines`).
 */
function extractLineup(lines: string[]): { artists: string[]; lineupStartIdx: number } {
  // Match against an NFKD view (decomposes styled Unicode headings back to
  // plain Latin letters) but keep returning the ORIGINAL line text — NFKD
  // also decomposes ordinary precomposed accented letters (e.g. "ë"), which
  // must not leak into stored artist names/venue-facing text.
  const normLines = lines.map((l) => l.normalize("NFKD"));
  const startIdx = normLines.findIndex((l) => LINEUP_START.test(l));
  if (startIdx === -1) return { artists: [], lineupStartIdx: -1 };
  const artists: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (LINEUP_STOP.test(normLines[i])) break;
    const line = lines[i];
    if (/^https?:\/\//i.test(line)) continue;
    if (/^[-–—‍]+$/.test(line)) continue;
    const cleaned = line.replace(/\s*[-–—:]\s*$/, "").trim();
    if (cleaned) artists.push(cleaned);
  }
  return { artists, lineupStartIdx: startIdx };
}

/** First RA (Resident Advisor) or Billetto ticket link found in the block, in that priority order. */
function extractTicketUrl(blockHtml: string): { ticketUrl: string | null; residentAdvisorUrl: string | null } {
  const ra = blockHtml.match(/href="(https:\/\/ra\.co\/events\/\d+[^"]*)"/i);
  if (ra) return { ticketUrl: ra[1], residentAdvisorUrl: ra[1] };
  const billetto = blockHtml.match(/href="(https:\/\/billetto\.[^"]+)"/i);
  if (billetto) return { ticketUrl: billetto[1], residentAdvisorUrl: null };
  return { ticketUrl: null, residentAdvisorUrl: null };
}

interface ExtractedDates {
  startDatetime: string | null;
  endDatetime: string | null;
}

/**
 * Prefers the Google Calendar export link's `dates=START/END` param — Squarespace
 * has already computed the exact UTC instant there (`YYYYMMDDTHHMMSSZ`),
 * which sidesteps any DST/AM-PM parsing risk entirely. Falls back to
 * combining the semantic `<time datetime="YYYY-MM-DD">` date tags with the
 * adjacent localized time text if that link is ever missing.
 */
function extractDates(blockHtml: string): ExtractedDates {
  const gcal = blockHtml.match(/dates=(\d{8}T\d{6})Z\/(\d{8}T\d{6})Z/);
  if (gcal) {
    return {
      startDatetime: parseGoogleCalUtc(gcal[1]).toISOString(),
      endDatetime: parseGoogleCalUtc(gcal[2]).toISOString(),
    };
  }

  const timePairs = [...blockHtml.matchAll(/<time class="event-date" datetime="(\d{4}-\d{2}-\d{2})">[^<]*<\/time>\s*(?:<span class="eventlist-meta-time">\s*)?<time class="event-time-localized" datetime="\d{4}-\d{2}-\d{2}">([^<]*)<\/time>/g)];
  if (timePairs.length === 0) return { startDatetime: null, endDatetime: null };

  const toIso = (m: RegExpMatchArray) => {
    const [, isoDate, timeText] = m;
    const parsed = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(timeText);
    if (!parsed) return null;
    let hour = Number(parsed[1]) % 12;
    if (/PM/i.test(parsed[3])) hour += 12;
    const [y, mo, d] = isoDate.split("-").map(Number);
    const key: DateKey = { year: y, month: mo, day: d };
    return copenhagenWallClockToUtc(key, hour, Number(parsed[2])).toISOString();
  };

  return {
    startDatetime: toIso(timePairs[0]),
    endDatetime: timePairs.length > 1 ? toIso(timePairs[timePairs.length - 1]) : null,
  };
}

function parseGoogleCalUtc(compact: string): Date {
  // YYYYMMDDTHHMMSS -> Date.UTC(...)
  const y = Number(compact.slice(0, 4));
  const mo = Number(compact.slice(4, 6));
  const d = Number(compact.slice(6, 8));
  const h = Number(compact.slice(9, 11));
  const mi = Number(compact.slice(11, 13));
  const s = Number(compact.slice(13, 15));
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

export function parseHangarenEventsHtml(html: string, sourceUrl = HANGAREN_EVENTS_URL): RawCandidateEvent[] {
  const blocks = html.match(/<article class="eventlist-event eventlist-event--upcoming[\s\S]*?<\/article>/g) ?? [];
  const results: RawCandidateEvent[] = [];

  for (const block of blocks) {
    try {
      const titleMatch = block.match(/<h1 class="eventlist-title"><a href="([^"]+)" class="eventlist-title-link">([^<]*)<\/a><\/h1>/);
      if (!titleMatch) continue; // malformed block — skip, never take down the whole sync
      const [, href, rawTitle] = titleMatch;
      const title = decodeHtmlEntities(rawTitle).trim();
      if (!title) continue;

      const permalink = href.split("?")[0];
      const officialEventUrl = permalink.startsWith("http") ? permalink : `${HANGAREN_BASE_URL}${permalink}`;

      const { startDatetime, endDatetime } = extractDates(block);

      // Whole-block text (not just an attempted "description div" extract —
      // regex can't reliably bound nested divs). "ICS" is the last line of
      // the date/calendar-export header that precedes every event's actual
      // bio text, so everything between it and the LINE-UP marker is the bio.
      const lines = htmlToText(block).split("\n");
      const { artists, lineupStartIdx } = extractLineup(lines);
      const finalArtists = artists.length > 0 || title.includes(":") ? artists : title.split(",").map((s) => s.trim()).filter(Boolean);

      const { ticketUrl, residentAdvisorUrl } = extractTicketUrl(block);

      const imgMatch = block.match(/data-image="(https:\/\/images\.squarespace-cdn\.com\/[^"]+)"/);

      const icsIdx = lines.findIndex((l) => l === "ICS");
      const bioLines =
        icsIdx !== -1 && lineupStartIdx > icsIdx
          ? lines.slice(icsIdx + 1, lineupStartIdx).filter((l) => !/^https?:\/\//i.test(l))
          : [];
      const description = bioLines.join(" ").slice(0, 600) || null;

      results.push({
        sourceId: HANGAREN_SOURCE_ID,
        sourceUrl,
        title,
        description,
        artists: finalArtists,
        startDatetime,
        endDatetime,
        venueName: HANGAREN_VENUE_NAME,
        officialEventUrl,
        ticketUrl,
        facebookUrl: null,
        residentAdvisorUrl,
        imageUrl: imgMatch ? imgMatch[1] : null,
        priceFrom: null,
        genreHint: null,
        genreConfidenceHint: null,
      });
    } catch {
      // A single malformed record must never take down the whole sync.
      continue;
    }
  }

  return results;
}

/**
 * Real HTTP fetch against the permitted plain-HTML `/events` page (never the
 * robots.txt-disallowed `?format=json`/`?format=ical` shortcuts). Throws a
 * descriptive error on network failure or a non-OK response so the sync
 * runner can record it as a distinct source failure, never as "zero events".
 */
export function createHangarenAdapter(fetchImpl: typeof fetch = fetch): SourceAdapter {
  return {
    sourceId: HANGAREN_SOURCE_ID,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      let res: Response;
      try {
        res = await fetchImpl(HANGAREN_EVENTS_URL, {
          signal: AbortSignal.timeout(15_000),
          headers: {
            "user-agent": "NattefrekvensBot/1.0 (+https://nattefrekvens.dk/about; first-party sync)",
            accept: "text/html",
          },
        });
      } catch (err) {
        throw new Error(`Hangaren fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!res.ok) {
        throw new Error(`Hangaren responded with HTTP ${res.status}`);
      }
      const html = await res.text();
      return parseHangarenEventsHtml(html, HANGAREN_EVENTS_URL);
    },
  };
}
