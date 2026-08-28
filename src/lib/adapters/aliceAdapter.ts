import { copenhagenWallClockToUtc, type DateKey } from "../datetime";
import { genreConfidenceForEvidence } from "../classification";
import { deterministicGenreFromText } from "./deterministicGenreMapping";
import { decodeHtmlEntities, htmlToText, extractLowestDkkAmount } from "./htmlExtraction";
import type { GenreSlug } from "../taxonomy";
import type { RawCandidateEvent, SourceAdapter } from "./types";

/**
 * Real first-party adapter for ALICE (src-alice in src/lib/data/sources.ts).
 *
 * ALICE (alicecph.com, WordPress) publishes no JSON feed, no per-event
 * JSON-LD (its one ld+json block is generic Yoast SEO WebPage/WebSite
 * metadata, same as Culture Box) and no REST route for its "event" custom
 * post type (wp-json/wp/v2/event -> rest_no_route). robots.txt places no
 * restriction on the site. The homepage's own event grid
 * (alicecph.com/en/) is, unlike the /en/event/ archive (which returns old,
 * already-past events with no reliable "upcoming only" filter or working
 * pagination signal), the venue's actual real-time upcoming-programme
 * surface: every entry carries a real 2026-dated show, a title, a one-line
 * teaser and a link to that event's own detail page. This adapter therefore
 * fetches the homepage once for the current programme, then each listed
 * event's own /en/event/<slug>/ detail page (same two-stage shape as
 * poolenAdapter.ts) for the real date/time, ticket link+price and a full
 * description.
 *
 * ALICE is explicitly a mixed-genre "concert venue" (jazz, global/roots,
 * folk, live bands, and electronic sets all in the same programme), never
 * electronic-only — genre is never assumed from the venue alone, same rule
 * Poolen already follows. Evidence comes from the event's own detail-page
 * description text: a specific-subgenre keyword (shared deterministic
 * mapping, "official-description"/high-confidence tier) takes priority;
 * failing that, an explicit but non-specific "electronic" mention in that
 * same first-party text is tagged the generic "electronic-other" at the
 * same tier rather than guessing a subgenre no text actually states.
 * Everything else is left unresolved for the shared pipeline's own
 * deterministic-mapping fallback and Discogs lineup enrichment to attempt —
 * never auto-published on venue alone.
 */

export const ALICE_SOURCE_ID = "src-alice";
export const ALICE_BASE_URL = "https://alicecph.com";
export const ALICE_PROGRAM_URL = "https://alicecph.com/en/";
const ALICE_VENUE_NAME = "ALICE";

/** "Friday _04.09.26" -> {year:2026, month:9, day:4}. Two-digit year is always 20XX on this site. Null on anything unrecognized. */
function parseAliceDate(text: string): DateKey | null {
  const match = text.match(/_(\d{2})\.(\d{2})\.(\d{2})/);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return { year: 2000 + Number(yearText), month, day };
}

/** "20:00" -> {hour:20, minute:0}. Null on anything unrecognized. */
function parseClockTime(text: string): { hour: number; minute: number } | null {
  const match = text.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * The venue's own display title ("Dengue Dengue Dengue <sup>PE</sup> + 3Phaz
 * <sup>EG</sup>") into a plain, readable title ("Dengue Dengue Dengue PE +
 * 3Phaz EG") and an artists array (["Dengue Dengue Dengue PE", "3Phaz EG"]),
 * splitting on " + " exactly as the venue's own multi-bill titles do —
 * never guessed or reordered.
 */
export function parseAliceTitle(rawTitleHtml: string): { title: string; artists: string[] } {
  const withoutSup = rawTitleHtml.replace(/<sup>([\s\S]*?)<\/sup>/gi, " $1").replace(/\(|\)/g, "");
  const title = decodeHtmlEntities(withoutSup).replace(/\s+/g, " ").trim();
  const artists = title
    .split(/\s*\+\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { title, artists };
}

export interface AliceProgramEntry {
  title: string;
  artists: string[];
  detailUrl: string;
  teaser: string | null;
  imageUrl: string | null;
  dateText: string | null;
}

/**
 * Parses the homepage's repeated event blocks. Both the grid ("EventGridItem",
 * upcoming programme) and the archive-list ("EventListItem") variants share
 * the same inner structure — an "EventInfo--title" h2 (optionally wrapped in
 * an <a>), a date <span>, and a one-line <small> teaser — so one parser
 * covers either surface.
 */
export function parseAliceProgramHtml(html: string): AliceProgramEntry[] {
  const results: AliceProgramEntry[] = [];
  const blockRe = /id="event-\d+"[\s\S]*?(?=id="event-\d+"|<\/main|$)/g;

  for (const blockMatch of html.matchAll(blockRe)) {
    const block = blockMatch[0];
    try {
      const hrefMatch = block.match(/href="(https:\/\/alicecph\.com\/en\/event\/[a-z0-9-]+\/)"/);
      if (!hrefMatch) continue; // malformed block — skip, never take down the whole sync
      const detailUrl = hrefMatch[1];

      const titleMatch = block.match(/class="[^"]*EventInfo--title[^"]*"[^>]*>([\s\S]*?)<\/h2>/);
      if (!titleMatch) continue;
      const { title, artists } = parseAliceTitle(titleMatch[1]);
      if (!title) continue;

      const dateMatch = block.match(/<span[^>]*>([^<]*_\d{2}\.\d{2}\.\d{2}[^<]*)<\/span>/);
      const dateText = dateMatch ? decodeHtmlEntities(dateMatch[1]).trim() : null;

      const teaserMatch = block.match(/<\/h2>\s*<small[^>]*>([^<]*)<\/small>/);
      const teaser = teaserMatch ? decodeHtmlEntities(teaserMatch[1]).trim() || null : null;

      const imageMatch = block.match(/src="(https:\/\/alicecph\.com\/content\/uploads\/[^"]+)"/);

      results.push({
        title,
        artists,
        detailUrl,
        teaser,
        imageUrl: imageMatch ? imageMatch[1] : null,
        dateText,
      });
    } catch {
      // A single malformed record must never take down the whole sync.
      continue;
    }
  }

  return results;
}

/**
 * Parses one event's detail page into a full RawCandidateEvent. Throws on
 * genuinely missing essentials (title, date, doors/concert time) — callers
 * skip a single failure and continue, matching every other adapter's
 * per-record contract; nothing here is ever guessed.
 */
export function parseAliceEventDetailHtml(html: string, entry: AliceProgramEntry, sourceUrl = ALICE_PROGRAM_URL): RawCandidateEvent {
  // The detail page's only <h1> is the site-wide "ALICE" logo link, not the
  // event's own title — this site never repeats the event name as a heading
  // on its own detail page. The listing page's own title/artists are
  // already clean and complete, so they're trusted as-is rather than
  // re-derived from a detail-page element that doesn't carry them.
  const { title, artists } = entry;
  if (!title) throw new Error(`ALICE detail page has no title (${entry.detailUrl})`);

  const ticketInfoMatch = html.match(/class="[^"]*EventContent--ticket-info[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
  if (!ticketInfoMatch) throw new Error(`ALICE detail page is missing its date/ticket info block (${entry.detailUrl})`);
  const ticketInfoHtml = ticketInfoMatch[1];
  const ticketInfoLines = htmlToText(ticketInfoHtml).split("\n");

  const dateLine = ticketInfoLines.find((l) => /_\d{2}\.\d{2}\.\d{2}/.test(l)) ?? entry.dateText ?? "";
  const dateKey = parseAliceDate(dateLine);
  if (!dateKey) throw new Error(`ALICE detail page has an unparseable date "${dateLine}" (${entry.detailUrl})`);

  const doorsLine = ticketInfoLines.find((l) => /^doors at:/i.test(l)) ?? "";
  const concertLine = ticketInfoLines.find((l) => /^concert at:/i.test(l)) ?? "";
  const doorsTime = parseClockTime(doorsLine.replace(/^doors at:\s*/i, ""));
  const concertTime = parseClockTime(concertLine.replace(/^concert at:\s*/i, ""));
  // Doors time is the event's real start, matching how door hours are
  // treated as the start on every other first-party adapter (Culture Box,
  // Poolen); the concert/show time is already implied by the description.
  const openTime = doorsTime ?? concertTime;
  if (!openTime) throw new Error(`ALICE detail page has no doors/concert time (${entry.detailUrl})`);
  const startDatetime = copenhagenWallClockToUtc(dateKey, openTime.hour, openTime.minute).toISOString();

  const priceFrom = extractLowestDkkAmount(ticketInfoHtml);

  const ticketMatch = ticketInfoHtml.match(/class="[^"]*EventTicketButton[^"]*"[^>]*href="([^"]+)"/);
  const ticketUrl = ticketMatch ? ticketMatch[1] : null;

  const contentMatch = html.match(/class="[^"]*EventContent--content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
  const fullDescriptionText = contentMatch ? htmlToText(contentMatch[1]).replace(/\n/g, " ").trim() : "";
  const description = fullDescriptionText ? fullDescriptionText.slice(0, 800) : entry.teaser;

  // Genre evidence, evidence-hierarchy order (same rule as poolenAdapter.ts):
  // a specific subgenre keyword in the event's own description text is
  // "official-description" (high); failing that, an explicit but
  // non-specific "electronic" mention in that same text is still real
  // evidence, tagged the deliberately generic "electronic-other" rather
  // than a guessed subgenre. Anything short of that is left unresolved for
  // the shared pipeline's own fallback and lineup enrichment to attempt.
  const specificGenre = fullDescriptionText ? deterministicGenreFromText(fullDescriptionText) : null;
  const genericElectronic = !specificGenre && /\belectronic(s|a)?\b/i.test(fullDescriptionText);
  const genreHint: GenreSlug | null = specificGenre ?? (genericElectronic ? "electronic-other" : null);

  return {
    sourceId: ALICE_SOURCE_ID,
    sourceUrl,
    title,
    description,
    artists,
    startDatetime,
    endDatetime: null, // no end time is ever stated on this site — never invented
    venueName: ALICE_VENUE_NAME,
    officialEventUrl: entry.detailUrl,
    ticketUrl,
    facebookUrl: null,
    residentAdvisorUrl: null,
    imageUrl: entry.imageUrl,
    priceFrom,
    genreHint,
    genreConfidenceHint: genreHint ? genreConfidenceForEvidence("official-description") : null,
    // No sold-out/cancelled signal found anywhere in this site's markup
    // (event lifecycle/status audit, 2026-08-28) — never guessed. Sampled
    // fixtures only cover normally-on-sale events, so this isn't proof ALICE
    // never renders one, just that nothing currently captured shows it.
    soldOutHint: null,
    cancelledHint: null,
  };
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
      console.error(`[alice-adapter] attempt 1 failed (${lastError}), retrying once in ${retryDelayMs}ms`);
      await delay(retryDelayMs);
    }
  }
  throw new Error(`${lastError} (after retry)`);
}

/**
 * Fetches the homepage's current programme, then every listed event's own
 * detail page (a short politeness delay between each). A homepage fetch
 * failure is a genuine source failure (thrown, same as Poolen/Culture Box).
 * A single detail-page failure drops only that one event — logged, never
 * thrown — so one broken page never takes down an otherwise-healthy sync;
 * it's picked up again next run.
 */
export function createAliceAdapter(fetchImpl: typeof fetch = fetch, retryDelayMs = 2_000, politenessDelayMs = 250): SourceAdapter {
  return {
    sourceId: ALICE_SOURCE_ID,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      const programRes = await fetchWithRetry(fetchImpl, ALICE_PROGRAM_URL, retryDelayMs, "ALICE homepage");
      const programHtml = await programRes.text();
      const entries = parseAliceProgramHtml(programHtml);

      const results: RawCandidateEvent[] = [];
      for (const entry of entries) {
        try {
          const detailRes = await fetchWithRetry(fetchImpl, entry.detailUrl, retryDelayMs, `ALICE event page (${entry.detailUrl})`);
          const detailHtml = await detailRes.text();
          results.push(parseAliceEventDetailHtml(detailHtml, entry, ALICE_PROGRAM_URL));
        } catch (err) {
          console.error(`[alice-adapter] skipping "${entry.title}": ${err instanceof Error ? err.message : String(err)}`);
        }
        if (politenessDelayMs > 0) await delay(politenessDelayMs);
      }
      return results;
    },
  };
}
