import { copenhagenWallClockToUtc, addDaysToDateKey, type DateKey } from "../datetime";
import { genreConfidenceForEvidence } from "../classification";
import { deterministicGenreFromText } from "./deterministicGenreMapping";
import { decodeHtmlEntities, htmlToText, extractAnchorTexts, extractLowestDkkAmount } from "./htmlExtraction";
import type { RawCandidateEvent, SourceAdapter } from "./types";

/**
 * Real first-party adapter for Culture Box (src-culture-box in
 * src/lib/data/sources.ts).
 *
 * Culture Box's own site (culture-box.com, WordPress) publishes no JSON
 * feed, no per-event JSON-LD (the page's one ld+json block is generic
 * Yoast SEO site metadata — Organization/WebSite/WebPage — with zero
 * Event/MusicEvent entries) and no ICS/RSS. robots.txt places no
 * restriction on /events/, and the page is plain server-rendered HTML with
 * every event already present in the initial response — no headless
 * browser required. This adapter therefore parses the DOM structure
 * directly (see cultureBoxAdapter.test.ts for a real, unmodified recorded
 * response and the evaluation notes).
 *
 * Structure (one `<article class="post-block">` per NIGHT, not per event):
 *   h2.post-block__title           -> the night's date ("FRI 21 AUGUST 2026")
 *   a[href*="/event/"]             -> canonical per-night URL (shared by both rooms)
 *   div.post-block__content__block -> one per ROOM (Black Box / Red Box today,
 *                                      not assumed fixed — whatever rooms appear)
 *     h3                           -> room name
 *     p > strong (optional)        -> the venue's own showcase/theme title for
 *                                      that room, when it named one
 *     p > a...a                    -> lineup, as SoundCloud-linked artist names
 *   .post-block__footer__aside li  -> entrance fee, door hours, Facebook event link
 *
 * Two rooms run simultaneously on the same night with independent lineups —
 * genuinely two different events sharing one venue/date, not duplicates of
 * each other (src/lib/dedup.ts already keeps same-venue-same-night events
 * with disjoint lineups separate). Since the site gives both rooms the same
 * canonical URL, a `#<room-slug>` fragment is appended to keep their
 * provenance (sourceEventLinks) distinct — the real page, just disambiguated
 * for a room-less identity model, never a fabricated URL.
 */

export const CULTURE_BOX_SOURCE_ID = "src-culture-box";
export const CULTURE_BOX_BASE_URL = "https://culture-box.com";
export const CULTURE_BOX_EVENTS_URL = `${CULTURE_BOX_BASE_URL}/events/`;
const CULTURE_BOX_VENUE_NAME = "Culture Box";

const MONTH_NAMES: Record<string, number> = {
  JANUARY: 1,
  FEBRUARY: 2,
  MARCH: 3,
  APRIL: 4,
  MAY: 5,
  JUNE: 6,
  JULY: 7,
  AUGUST: 8,
  SEPTEMBER: 9,
  OCTOBER: 10,
  NOVEMBER: 11,
  DECEMBER: 12,
};

/** "FRI 21 AUGUST 2026" -> {year:2026, month:8, day:21}. Null on anything unrecognized — never guessed. */
function parseDateHeading(headingText: string): DateKey | null {
  const cleaned = headingText.replace(/\s+/g, " ").trim().toUpperCase();
  const match = cleaned.match(/^[A-Z]+\s+(\d{1,2})\s+([A-Z]+)\s+(\d{4})$/);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const month = MONTH_NAMES[monthText];
  if (!month) return null;
  const day = Number(dayText);
  if (day < 1 || day > 31) return null;
  return { year: Number(yearText), month, day };
}

interface DoorHours {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

/** "10PM – 8AM" / "8PM-8AM" -> 24h start/end. Null when the text doesn't match — never guessed. */
function parseDoorHours(text: string): DoorHours | null {
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!match) return null;
  const to24 = (h: string, meridiem: string): number => {
    let hour = Number(h) % 12;
    if (/PM/i.test(meridiem)) hour += 12;
    return hour;
  };
  return {
    startHour: to24(match[1], match[3]),
    startMinute: match[2] ? Number(match[2]) : 0,
    endHour: to24(match[4], match[6]),
    endMinute: match[5] ? Number(match[5]) : 0,
  };
}

function slugifyRoomName(room: string): string {
  return room
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface RoomBlock {
  roomName: string;
  showcaseTitle: string | null;
  artists: string[];
}

function parseRoomBlocks(articleHtml: string): RoomBlock[] {
  const blocks: RoomBlock[] = [];
  for (const blockMatch of articleHtml.matchAll(/<div class="post-block__content__block">([\s\S]*?)<\/div>/g)) {
    const blockHtml = blockMatch[1];
    const h3Match = blockHtml.match(/<h3[^>]*>([^<]*)<\/h3>/);
    if (!h3Match) continue; // malformed room block — skip, never take down the whole article
    const roomName = decodeHtmlEntities(h3Match[1]).trim();
    if (!roomName) continue;

    const pMatch = blockHtml.match(/<p>([\s\S]*?)<\/p>/);
    const pHtml = pMatch ? pMatch[1] : "";

    const strongMatch = pHtml.match(/^<strong>([\s\S]*?)<\/strong>/);
    const showcaseTitle = strongMatch
      ? htmlToText(strongMatch[1]).replace(/\n/g, " ").replace(/[:\s]+$/, "").trim() || null
      : null;

    const artists = extractAnchorTexts(pHtml);

    blocks.push({ roomName, showcaseTitle, artists });
  }
  return blocks;
}

export function parseCultureBoxEventsHtml(html: string, sourceUrl = CULTURE_BOX_EVENTS_URL): RawCandidateEvent[] {
  const articles = html.match(/<article class="post-block[^"]*">[\s\S]*?<\/article>/g) ?? [];
  const results: RawCandidateEvent[] = [];

  for (const article of articles) {
    try {
      const h2Match = article.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
      if (!h2Match) continue; // malformed article — skip, never take down the whole sync
      const dateKey = parseDateHeading(decodeHtmlEntities(h2Match[1]));
      if (!dateKey) continue;

      // Both the thumbnail link and the "More information" button point at
      // the same canonical per-night URL; take whichever appears first.
      const urlMatch = article.match(/href="(https:\/\/culture-box\.com\/event\/[^"]+)"/);
      const baseUrl = urlMatch ? urlMatch[1] : sourceUrl;

      const footerMatch = article.match(/<div class="post-block__footer__aside">([\s\S]*?)<\/div>/);
      const footerLis = [...(footerMatch?.[1] ?? "").matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);

      const feeLine = footerLis.find((l) => /entrance/i.test(l)) ?? "";
      const priceFrom = extractLowestDkkAmount(feeLine);

      const hoursLine = footerLis.find((l) => /\d\s*(AM|PM)/i.test(l) && !/entrance/i.test(l)) ?? "";
      const doorHours = parseDoorHours(hoursLine);

      const facebookLine = footerLis.find((l) => /facebook/i.test(l)) ?? "";
      const facebookMatch = facebookLine.match(/href="([^"]+)"/);
      const facebookUrl = facebookMatch ? facebookMatch[1] : null;

      const imgMatch = article.match(/data-src="(https:\/\/culture-box\.com\/wp-content\/uploads\/[^"]+)"/);
      const imageUrl = imgMatch ? imgMatch[1] : null;

      let startDatetime: string | null = null;
      let endDatetime: string | null = null;
      if (doorHours) {
        startDatetime = copenhagenWallClockToUtc(dateKey, doorHours.startHour, doorHours.startMinute).toISOString();
        // Door hours on this page are always an overnight range (e.g. 10PM-8AM);
        // an end clock-time that is not later than the start rolls to the next
        // calendar day, matching how the site itself presents the night.
        const endDayKey =
          doorHours.endHour * 60 + doorHours.endMinute <= doorHours.startHour * 60 + doorHours.startMinute
            ? addDaysToDateKey(dateKey, 1)
            : dateKey;
        endDatetime = copenhagenWallClockToUtc(endDayKey, doorHours.endHour, doorHours.endMinute).toISOString();
      }

      const roomBlocks = parseRoomBlocks(article);
      for (const room of roomBlocks) {
        const title = room.showcaseTitle
          ? `${room.roomName}: ${room.showcaseTitle}`
          : room.artists.length > 0
            ? `${room.roomName}: ${room.artists.join(", ")}`
            : room.roomName;

        // Genre evidence: a keyword match against the venue's OWN text about
        // THIS specific room's show (the showcase/theme title it chose to
        // print) is "official-description" tier (classification.ts's
        // evidence hierarchy — high confidence), mirroring hangarenAdapter's
        // bio-text rule. A bare artist name carries no such credit, and
        // there being no showcase title at all (common here) correctly
        // leaves genre unresolved for the pipeline's own deterministic
        // fallback / Discogs lineup enrichment to attempt, rather than
        // guessed from "this venue is electronic".
        const genreHint = room.showcaseTitle ? deterministicGenreFromText(room.showcaseTitle) : null;

        results.push({
          sourceId: CULTURE_BOX_SOURCE_ID,
          sourceUrl,
          title,
          description: null, // no free-text description exists on this page — never invented
          artists: room.artists,
          startDatetime,
          endDatetime,
          venueName: CULTURE_BOX_VENUE_NAME,
          officialEventUrl: `${baseUrl}#${slugifyRoomName(room.roomName)}`,
          ticketUrl: null, // no ticket/RA/Billetto link present on this page
          facebookUrl,
          residentAdvisorUrl: null,
          imageUrl,
          priceFrom,
          genreHint,
          genreConfidenceHint: genreHint ? genreConfidenceForEvidence("official-description") : null,
        });
      }
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
  return fetchImpl(CULTURE_BOX_EVENTS_URL, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      "user-agent": "NattefrekvensBot/1.0 (+https://nattefrekvens.dk/about; first-party sync)",
      accept: "text/html",
    },
  });
}

/**
 * Real HTTP fetch against the permitted, unrestricted /events/ page. Retries
 * once after a short delay on a transient failure (network error or 5xx) —
 * a single blip shouldn't flag a healthy source as failed. Throws a
 * descriptive error only after both attempts fail, so the sync runner
 * records it as a distinct source failure, never as "zero events".
 */
export function createCultureBoxAdapter(fetchImpl: typeof fetch = fetch, retryDelayMs = 2_000): SourceAdapter {
  return {
    sourceId: CULTURE_BOX_SOURCE_ID,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      let lastError: string | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await fetchOnce(fetchImpl);
          if (res.ok) {
            const html = await res.text();
            return parseCultureBoxEventsHtml(html, CULTURE_BOX_EVENTS_URL);
          }
          lastError = `Culture Box responded with HTTP ${res.status}`;
          if (res.status < 500) break; // a 4xx won't fix itself on retry
        } catch (err) {
          lastError = `Culture Box fetch failed: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (attempt === 1) {
          console.error(`[culture-box-adapter] attempt 1 failed (${lastError}), retrying once in ${retryDelayMs}ms`);
          await delay(retryDelayMs);
        }
      }
      throw new Error(`${lastError} (after retry)`);
    },
  };
}
