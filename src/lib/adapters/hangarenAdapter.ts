import { copenhagenWallClockToUtc, type DateKey } from "../datetime";
import { genreConfidenceForEvidence } from "../classification";
import { deterministicGenreFromText } from "./deterministicGenreMapping";
import { decodeHtmlEntities, htmlToText, stripBareUrls } from "./htmlExtraction";
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

// ---- HTML text extraction ----
// decodeHtmlEntities/htmlToText moved to ./htmlExtraction (shared with
// cultureBoxAdapter.ts) — behavior unchanged, see that module.

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
    // A lineup line sometimes carries the artist's own SoundCloud/Instagram
    // link inline (e.g. "Kromagon: https://soundcloud.com/aragon -") — the
    // raw URL itself must never surface as part of the stored artist name.
    const cleaned = stripBareUrls(line.replace(/\s*[-–—:]\s*$/, "").trim());
    if (cleaned) artists.push(cleaned);
  }
  return { artists, lineupStartIdx: startIdx };
}

/**
 * Truncates bio text to at most `maxLength` characters without cutting off
 * mid-word or mid-sentence when a clean boundary exists near the limit —
 * editorial-description follow-up (real evidence: Hangaren bios routinely
 * got cut to a bare `.slice(0, 600)`, landing mid-word, e.g. "...She al",
 * "...no dou", "...Today, "). Prefers the last sentence-ending punctuation
 * within the limit; falls back to the last word boundary; only cuts
 * mid-word as a last resort (a single 600+-character run with no space,
 * which no real bio in this source has done).
 */
export function truncateAtBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastSentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (lastSentenceEnd > maxLength * 0.5) return slice.slice(0, lastSentenceEnd + 1).trim();
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
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
      const fullBioText = bioLines.join(" ");

      // Product decision (editorial-description follow-up): Hangaren's own
      // copy between "ICS" and "LINE-UP:" is consistently third-person
      // encyclopedic artist biography ("X is an internationally renowned
      // DJ...", "Born to chill, forced to DJ...") — never event-specific
      // framing (what this particular night is, why it's worth going to).
      // The page gives no structural signal to separate "about this event"
      // text from "about the artist in general" text within that block, and
      // building a heuristic to guess the difference would be exactly the
      // fragile text-classification this project avoids. So this is never
      // shown as the public event description — title/artists/venue/genre/
      // ticket link already carry what's actually known about the event.
      // fullBioText is still used for genre evidence directly below (a
      // narrower, already-deterministic keyword match, unrelated to whether
      // the prose itself gets displayed) — truncateAtBoundary remains
      // available (and tested) as boundary-safe hygiene for any future
      // event-specific text this source might one day provide, but isn't
      // wired to anything here while every description is generic bio text.
      const description = null;

      // Genre evidence: a keyword match against the venue's OWN descriptive
      // text about this specific show is "official-description" tier
      // (classification.ts's evidence hierarchy — high confidence), not the
      // generic "deterministic-mapping" fallback (medium) the pipeline uses
      // when an adapter supplies no hint. Hangaren has no explicit genre
      // field, but its bios routinely state the genre outright (e.g. "Hard
      // Bounce, Schranz and Techno are genres that define the sound of
      // Kander") — that is reliable evidence, not a guess, and crediting it
      // correctly is what the existing rules already call for. Matched
      // against the FULL bio (not the 600-char stored summary — a genre
      // mention past that cutoff, common in longer artist bios, must not be
      // missed). A match against the title ALONE (no bio text at all, e.g. a
      // bare artist name) gets no such credit — the pipeline's own
      // title+description fallback still applies to those, at medium.
      const descriptionGenre = fullBioText ? deterministicGenreFromText(fullBioText) : null;

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
        genreHint: descriptionGenre,
        genreConfidenceHint: descriptionGenre ? genreConfidenceForEvidence("official-description") : null,
        // No sold-out/cancelled signal exists anywhere in this page's markup
        // (event lifecycle/status audit, 2026-08-28) — the only "sold out"
        // text present is generic door-policy boilerplate repeated on every
        // event, not a per-event status field. Never guessed.
        soldOutHint: null,
        cancelledHint: null,
      });
    } catch {
      // A single malformed record must never take down the whole sync.
      continue;
    }
  }

  return results;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(HANGAREN_EVENTS_URL, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      "user-agent": "NattefrekvensBot/1.0 (+https://nattefrekvens.dk/about; first-party sync)",
      accept: "text/html",
    },
  });
}

/**
 * Real HTTP fetch against the permitted plain-HTML `/events` page (never the
 * robots.txt-disallowed `?format=json`/`?format=ical` shortcuts). Retries
 * once after a short delay on a transient failure (network error or 5xx) —
 * a single blip shouldn't flag a healthy source as failed. Throws a
 * descriptive error only after both attempts fail, so the sync runner can
 * record it as a distinct source failure, never as "zero events". A sync
 * runs every 6h, so anything beyond one retry is better left to the next
 * scheduled run than held up here.
 */
export function createHangarenAdapter(fetchImpl: typeof fetch = fetch, retryDelayMs = 2_000): SourceAdapter {
  return {
    sourceId: HANGAREN_SOURCE_ID,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      let lastError: string | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await fetchOnce(fetchImpl);
          if (res.ok) {
            const html = await res.text();
            return parseHangarenEventsHtml(html, HANGAREN_EVENTS_URL);
          }
          lastError = `Hangaren responded with HTTP ${res.status}`;
          if (res.status < 500) break; // a 4xx won't fix itself on retry
        } catch (err) {
          lastError = `Hangaren fetch failed: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (attempt === 1) {
          console.error(`[hangaren-adapter] attempt 1 failed (${lastError}), retrying once in ${retryDelayMs}ms`);
          await delay(retryDelayMs);
        }
      }
      throw new Error(`${lastError} (after retry)`);
    },
  };
}
