import { copenhagenWallClockToUtc, addDaysToDateKey, type DateKey } from "../datetime";
import { genreConfidenceForEvidence } from "../classification";
import { deterministicGenreFromText } from "./deterministicGenreMapping";
import { decodeHtmlEntities, htmlToText, extractAnchorTexts, extractLowestDkkAmount } from "./htmlExtraction";
import type { RawCandidateEvent, SourceAdapter } from "./types";
import type { GenreSlug } from "../taxonomy";

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
 * Two rooms run simultaneously on the same night, each with its own
 * showcase/lineup — but they are the SAME club night: one shared venue, one
 * shared admission/door-hours/ticket context, one canonical page. Product
 * decision (partner-ready polish pass, Culture Box-specific — not a general
 * Event -> Rooms architecture change): they are represented as ONE canonical
 * event, with the per-room breakdown kept as room-separated lineup content in
 * `description` ("Black Box\n<artists>\n\nRed Box\n<artists>") and combined
 * into the title/artists fields. This is safe specifically because every
 * signal that would distinguish two genuinely separate events (venue, night,
 * door hours, ticket/RA link) is identical between rooms on this page — a
 * night with only one room block behaves exactly as before (a single-element
 * "combination").
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
      if (roomBlocks.length === 0) continue; // no usable room content — nothing to publish for this night

      // ONE canonical event per night (see header comment): title and
      // artists combine every room's own content, in room order; the
      // room-separated lineup breakdown lives in `description` below.
      const roomTitle = (room: RoomBlock) =>
        room.showcaseTitle
          ? `${room.roomName}: ${room.showcaseTitle}`
          : room.artists.length > 0
            ? `${room.roomName}: ${room.artists.join(", ")}`
            : room.roomName;
      // Both rooms routinely run the SAME night-wide showcase under one name
      // (real evidence: "Black Box: HYGGELIT SHOWCASE · Red Box: HYGGELIT
      // SHOWCASE") — printing the room-prefixed identity twice is redundant
      // noise for one night that's already a single canonical event. When
      // every room's own identity (its showcase title, or its lineup when it
      // named none) is the SAME event after conservative case/whitespace/
      // punctuation normalization, the public title collapses to just that
      // shared identity; genuinely different room identities keep the
      // existing "Room: X · Room: Y" format. Only ever compares/collapses
      // the TITLE — the room-separated lineup breakdown in `description`
      // below is built independently and always keeps every room distinct.
      const roomIdentity = (room: RoomBlock): string | null =>
        room.showcaseTitle ?? (room.artists.length > 0 ? room.artists.join(", ") : null);
      const normalizeIdentity = (text: string): string =>
        text
          .normalize("NFKD")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, "")
          .replace(/\s+/g, " ")
          .trim();
      const identities = roomBlocks.map(roomIdentity);
      const sharedIdentity =
        roomBlocks.length > 1 && identities.every((id): id is string => id !== null) &&
        new Set(identities.map(normalizeIdentity)).size === 1
          ? identities[0]!
          : null;
      const title = sharedIdentity ?? roomBlocks.map(roomTitle).join(" · ");
      const artists = roomBlocks.flatMap((room) => room.artists);
      const description = roomBlocks
        .map((room) => `${room.roomName}\n${room.artists.length > 0 ? room.artists.join(", ") : "Lineup TBA"}`)
        .join("\n\n");

      // Genre evidence: a keyword match against the venue's OWN text about a
      // specific room's show (the showcase/theme title it chose to print) is
      // "official-description" tier (classification.ts's evidence
      // hierarchy — high confidence), mirroring hangarenAdapter's bio-text
      // rule. Credited to the whole (now consolidated) night only when every
      // room that named a genre agrees on the SAME one — rooms naming
      // different genres, or naming none at all, correctly leave genre
      // unresolved for the pipeline's own deterministic fallback / Discogs
      // lineup enrichment to attempt, rather than guessed from either room
      // alone or from "this venue is electronic".
      const roomGenreHints = roomBlocks
        .map((room) => (room.showcaseTitle ? deterministicGenreFromText(room.showcaseTitle) : null))
        .filter((g): g is GenreSlug => g !== null);
      const distinctRoomGenres = new Set(roomGenreHints);
      const genreHint = distinctRoomGenres.size === 1 ? [...distinctRoomGenres][0] : null;

      results.push({
        sourceId: CULTURE_BOX_SOURCE_ID,
        sourceUrl,
        title,
        description,
        artists,
        startDatetime,
        endDatetime,
        venueName: CULTURE_BOX_VENUE_NAME,
        officialEventUrl: baseUrl,
        ticketUrl: null, // no ticket/RA/Billetto link present on this page
        facebookUrl,
        residentAdvisorUrl: null,
        imageUrl,
        priceFrom,
        genreHint,
        genreConfidenceHint: genreHint ? genreConfidenceForEvidence("official-description") : null,
      });
    } catch {
      // A single malformed record must never take down the whole sync.
      continue;
    }
  }

  return results;
}

/**
 * Detail-page enrichment (per-night `/event/<slug>/` page, distinct from the
 * `/events/` listing above). The listing gives every night's rooms a
 * showcase title (sometimes genre-bearing) and lineup; the venue's own
 * per-night detail page additionally carries a real free-text description
 * (`.post-block__additional-text`, shared across both rooms in one article)
 * and, separately, a Resident Advisor event link. Neither exists on the
 * listing page — this is genuinely new evidence, not a reformat of what's
 * already scraped.
 *
 * The description text is real, but it talks about the whole NIGHT, not one
 * room in isolation — a genre word appearing in it cannot be blindly applied
 * to both rooms without risking crediting the wrong room's genre (a
 * night's two rooms routinely run different styles — see
 * "attributeGenreToRoom" below). Extraction and room-attribution are kept as
 * separate, independently testable steps for exactly that reason.
 */

/**
 * Extracts the night's own free-text description as plain-text paragraphs,
 * from the detail page's `.post-block__additional-text` block (bounded by
 * that div's enclosing `</article>` — verified against 15 real recorded
 * detail pages to reliably close the block, unlike scanning for any
 * particular sentence of boilerplate). Returns [] rather than throwing when
 * the block isn't present — a page-structure change here must degrade to
 * "no description evidence", never take down parsing.
 */
export function extractDescriptionParagraphs(detailHtml: string): string[] {
  const blockIdx = detailHtml.indexOf("post-block__additional-text");
  if (blockIdx === -1) return [];
  const articleEndIdx = detailHtml.indexOf("</article>", blockIdx);
  const fragment = articleEndIdx === -1 ? detailHtml.slice(blockIdx) : detailHtml.slice(blockIdx, articleEndIdx);

  const paragraphs: string[] = [];
  for (const m of fragment.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = htmlToText(m[1]).replace(/\n/g, " ").trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs;
}

/** The night's own Resident Advisor event link from its detail page, if the venue linked one. Never guessed/constructed. */
export function extractResidentAdvisorUrl(detailHtml: string): string | null {
  const match = detailHtml.match(/https:\/\/ra\.co\/events\/\d+/);
  return match ? match[0] : null;
}

/**
 * Whether `text` names this artist. Deliberately exact-substring only (full
 * display name, case-insensitive) — a looser first-name/partial match was
 * evaluated against all 15 real detail-page fixtures collected for this
 * feature and never changed a single outcome, so it's dropped: it could only
 * ever add cross-room misattribution risk for zero real-world benefit.
 */
function mentionsArtist(text: string, artistName: string): boolean {
  return text.toUpperCase().includes(artistName.toUpperCase());
}

/**
 * Room-attribution guard: a genre keyword found in the night's shared
 * description is credited to THIS room only when a paragraph containing it
 * names at least one of this room's own artists and names none of the other
 * room's artists (artists from every other room sharing the night, not just
 * "the" other room — a night is never assumed to have exactly two).
 * Under-attribution is always acceptable (leaves genre unresolved for the
 * existing deterministic/Discogs fallback, exactly like a night with no
 * showcase title behaves today); crediting the wrong room's genre is not, so
 * a paragraph naming both sides, or neither, is excluded outright. If more
 * than one qualifying paragraph disagrees on genre, the room is left
 * unresolved rather than picking one arbitrarily.
 */
export function attributeGenreToRoom(paragraphs: string[], roomArtists: string[], otherRoomsArtists: string[]): GenreSlug | null {
  const distinctGenres = new Set<GenreSlug>();
  for (const paragraph of paragraphs) {
    const genre = deterministicGenreFromText(paragraph);
    if (!genre) continue;
    const mentionsThisRoom = roomArtists.some((a) => mentionsArtist(paragraph, a));
    const mentionsOtherRoom = otherRoomsArtists.some((a) => mentionsArtist(paragraph, a));
    if (mentionsThisRoom && !mentionsOtherRoom) distinctGenres.add(genre);
  }
  if (distinctGenres.size !== 1) return null; // nothing qualified, or qualifying paragraphs disagreed
  return [...distinctGenres][0];
}

/**
 * Enriches already-parsed listing candidates with each night's detail page:
 * one room-attributed genre fill-in (only when the listing's own showcase
 * title left genre unresolved — this never second-guesses evidence the
 * listing page already credited), a real description, and the Resident
 * Advisor link, all applied to every room sharing that night. Candidates are
 * grouped by their shared night (the part of officialEventUrl before `#`) so
 * a night's detail page is fetched exactly once regardless of how many rooms
 * it has. A single night's detail-page fetch failing degrades only that
 * night to the plain listing-page candidates it already had — logged, never
 * thrown, never dropped, picked up again on the next sync — so one broken
 * page can never take down an otherwise-healthy Culture Box sync.
 */
export async function enrichCandidatesWithDetailPages(
  candidates: RawCandidateEvent[],
  fetchImpl: typeof fetch,
  retryDelayMs: number,
  politenessDelayMs: number,
): Promise<RawCandidateEvent[]> {
  const byNight = new Map<string, RawCandidateEvent[]>();
  for (const candidate of candidates) {
    if (!candidate.officialEventUrl) continue;
    const [nightUrl] = candidate.officialEventUrl.split("#");
    if (!byNight.has(nightUrl)) byNight.set(nightUrl, []);
    byNight.get(nightUrl)!.push(candidate);
  }

  const enriched = new Map<RawCandidateEvent, RawCandidateEvent>();

  for (const [nightUrl, nightCandidates] of byNight) {
    let detailHtml: string;
    try {
      const res = await fetchWithRetry(fetchImpl, nightUrl, retryDelayMs, `Culture Box event page (${nightUrl})`);
      detailHtml = await res.text();
    } catch (err) {
      console.error(
        `[culture-box-adapter] detail page fetch failed for ${nightUrl}, keeping listing-only data for this night: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (politenessDelayMs > 0) await delay(politenessDelayMs);
      continue; // this night's candidates are left exactly as parsed from the listing
    }

    const paragraphs = extractDescriptionParagraphs(detailHtml);
    const residentAdvisorUrl = extractResidentAdvisorUrl(detailHtml);
    const description = paragraphs.length > 0 ? paragraphs.join("\n\n") : null;

    for (const candidate of nightCandidates) {
      const otherRoomsArtists = nightCandidates.filter((c) => c !== candidate).flatMap((c) => c.artists);
      const next: RawCandidateEvent = { ...candidate };
      if (residentAdvisorUrl) next.residentAdvisorUrl = residentAdvisorUrl;
      // The detail page's real free-text description is genuinely new
      // evidence (the night's own write-up), but it must not erase the
      // room-separated lineup breakdown already built from the listing page
      // — the two are combined, prose first, so the "About" section reads
      // naturally before the per-room lineup.
      if (description) {
        next.description = candidate.description ? `${description}\n\n${candidate.description}` : description;
      }

      if (!next.genreHint) {
        const genre = attributeGenreToRoom(paragraphs, candidate.artists, otherRoomsArtists);
        if (genre) {
          next.genreHint = genre;
          next.genreConfidenceHint = genreConfidenceForEvidence("official-description");
        }
      }
      enriched.set(candidate, next);
    }

    if (politenessDelayMs > 0) await delay(politenessDelayMs);
  }

  return candidates.map((c) => enriched.get(c) ?? c);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(fetchImpl: typeof fetch, url: string, retryDelayMs: number, label: string): Promise<Response> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchImpl(url, {
        signal: AbortSignal.timeout(15_000),
        headers: {
          "user-agent": "NattefrekvensBot/1.0 (+https://nattefrekvens.dk/about; first-party sync)",
          accept: "text/html",
        },
      });
      if (res.ok) return res;
      lastError = `${label} responded with HTTP ${res.status}`;
      if (res.status < 500) break; // a 4xx won't fix itself on retry
    } catch (err) {
      lastError = `${label} fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (attempt === 1) {
      console.error(`[culture-box-adapter] attempt 1 failed (${lastError}), retrying once in ${retryDelayMs}ms`);
      await delay(retryDelayMs);
    }
  }
  throw new Error(`${lastError} (after retry)`);
}

/**
 * Real HTTP fetch against the permitted, unrestricted /events/ page, then
 * (task: Culture Box detail-page evidence) each distinct night's own
 * `/event/<slug>/` page — a short politeness delay between each, same
 * pattern as poolenAdapter.ts's programme+detail two-stage fetch. Retries
 * once after a short delay on a transient failure (network error or 5xx) —
 * a single blip shouldn't flag a healthy source as failed. The listing fetch
 * throws a descriptive error after both attempts fail, so the sync runner
 * records it as a distinct source failure, never as "zero events"; a
 * detail-page fetch failure is handled entirely inside
 * enrichCandidatesWithDetailPages and never reaches here.
 */
export function createCultureBoxAdapter(fetchImpl: typeof fetch = fetch, retryDelayMs = 2_000, politenessDelayMs = 250): SourceAdapter {
  return {
    sourceId: CULTURE_BOX_SOURCE_ID,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      const res = await fetchWithRetry(fetchImpl, CULTURE_BOX_EVENTS_URL, retryDelayMs, "Culture Box");
      const html = await res.text();
      const candidates = parseCultureBoxEventsHtml(html, CULTURE_BOX_EVENTS_URL);
      return enrichCandidatesWithDetailPages(candidates, fetchImpl, retryDelayMs, politenessDelayMs);
    },
  };
}
