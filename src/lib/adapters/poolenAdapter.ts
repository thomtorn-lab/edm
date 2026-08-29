import { copenhagenWallClockToUtc, type DateKey } from "../datetime";
import { genreConfidenceForEvidence } from "../classification";
import { deterministicGenreFromText } from "./deterministicGenreMapping";
import { decodeHtmlEntities, htmlToText, truncateAtBoundary, isLikelyDanish } from "./htmlExtraction";
import type { GenreSlug } from "../taxonomy";
import type { RawCandidateEvent, SourceAdapter } from "./types";

/**
 * Real first-party adapter for Poolen (src-poolen in src/lib/data/sources.ts).
 *
 * Unlike Hangaren/Culture Box, a single page is not enough: the programme
 * page (poolen.dk/da/ — WordPress, robots.txt places no restriction on it)
 * lists every upcoming show with a title, calendar date and a link to its
 * own detail page, but the doors/show TIME, price, full description (the
 * text genre evidence lives here) and support-artist lineup only exist on
 * each event's own /da/koncerter/<slug>/ page. So this adapter fetches the
 * programme page once, then fetches each listed event's detail page (with
 * the same retry-once-on-5xx courtesy as the single-page adapters) to
 * assemble a complete RawCandidateEvent. A detail-page failure drops only
 * that one event from this run — it is picked up again on the next sync —
 * never the whole batch; only a programme-page failure is a source failure.
 *
 * Poolen is a mixed-genre venue (concerts, comedy/bingo nights, hip-hop,
 * house/techno raves…), not an electronic-only one — genre is never assumed
 * from the venue alone. Evidence comes from the event's own detail-page
 * text: a specific-subgenre keyword (via the shared deterministic mapping,
 * same "official-description"/high-confidence tier Hangaren and Culture Box
 * already use for their own bio text) takes priority; failing that, an
 * explicit but non-specific "electronic"/"elektronisk" mention in the
 * venue's own copy is still real first-party evidence, credited the same
 * tier under the deliberately generic "electronic-other" slug rather than
 * inventing a subgenre no text actually states. Everything else is left
 * unresolved for the shared pipeline's own deterministic-mapping fallback
 * and Discogs lineup enrichment (src/db/sync.ts) to attempt — never
 * auto-published on venue alone, matching the quality gate every other
 * source already goes through.
 *
 * "Outside" is Poolen's own outdoor extension of the same physical venue on
 * Refshaleøen (its programme teasers even use a distinct purple style for
 * it), not a separate venue — events there are still tagged venueName
 * "Poolen" (with "Poolen Outside" registered as an alias in
 * src/lib/data/venues.ts) rather than inventing a second venue record; the
 * "– Outside" distinction is preserved in the event's own title text, which
 * is exactly how the venue itself presents it.
 */

export const POOLEN_SOURCE_ID = "src-poolen";
export const POOLEN_BASE_URL = "https://poolen.dk";
export const POOLEN_PROGRAM_URL = "https://poolen.dk/da/";
const POOLEN_VENUE_NAME = "Poolen";

const MONTH_NAMES: Record<string, number> = {
  // Detail pages mix Danish and English month spellings inconsistently
  // (a translation-plugin quirk, not a real distinction) — both accepted.
  januar: 1, january: 1,
  februar: 2, february: 2,
  marts: 3, march: 3,
  april: 4,
  maj: 5, may: 5,
  juni: 6, june: 6,
  juli: 7, july: 7,
  august: 8,
  september: 9,
  oktober: 10, october: 10,
  november: 11,
  december: 12,
};

/** "22 august 2026" / "18. july 2026" -> {year:2026, month:7, day:18}. Null on anything unrecognized — never guessed. */
function parseDanishDate(text: string): DateKey | null {
  const match = text
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})\.?\s+([a-zæøå]+)\s+(\d{4})$/);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const month = MONTH_NAMES[monthText];
  if (!month) return null;
  const day = Number(dayText);
  if (day < 1 || day > 31) return null;
  return { year: Number(yearText), month, day };
}

/** "19.00" / "18.30" -> {hour, minute}. Null on anything unrecognized. */
function parseClockTime(text: string): { hour: number; minute: number } | null {
  const match = text.trim().match(/^(\d{1,2})\.(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** "250 Kr." -> 250. Null when no amount is present. */
function parsePriceKr(text: string): number | null {
  const match = text.match(/(\d+)\s*kr\.?/i);
  return match ? Number(match[1]) : null;
}

export interface PoolenProgramEntry {
  title: string;
  detailUrl: string;
  ticketUrl: string | null;
  imageUrl: string | null;
  dateText: string | null;
}

/**
 * Parses the programme page's repeated `.component-event-teaser` blocks.
 * Each has three `.boxify > h2` labels in a fixed order — title, Danish
 * weekday name (unused; redundant with the date), calendar date — followed
 * by an optional lineup label the codebase doesn't need at this stage
 * (support acts are re-derived from each detail page instead, where they
 * carry their own structure). The weekday name is intentionally skipped
 * rather than parsed — it's decorative, and the calendar date fully
 * determines the day regardless of what label the site puts on it.
 */
export function parsePoolenProgramHtml(html: string): PoolenProgramEntry[] {
  const blocks = html.match(/<section class="component component-event-teaser default-grid">[\s\S]*?<\/section>/g) ?? [];
  const results: PoolenProgramEntry[] = [];

  for (const block of blocks) {
    try {
      const detailMatch = block.match(/<a href="(https:\/\/poolen\.dk\/da\/koncerter\/[^"]+)" class="btn btn--boxed-black">/);
      if (!detailMatch) continue; // malformed block — skip, never take down the whole sync
      const detailUrl = detailMatch[1];

      const labels = [...block.matchAll(/<div class="boxify [\w-]+">\s*<h2 class="text__h2">([^<]*)<\/h2>/g)].map((m) =>
        decodeHtmlEntities(m[1]).trim(),
      );
      const title = labels[0];
      if (!title) continue;
      const dateText = labels[2] ?? null;

      const ticketMatch = block.match(/<a href="([^"]+)" target="_blank" class="btn btn--boxed-grey">/);
      const imageMatch = block.match(/background-image:\s*url\('([^']+)'\)/);

      results.push({
        title,
        detailUrl,
        ticketUrl: ticketMatch ? ticketMatch[1] : null,
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
 * genuinely missing essentials (title, date, doors/show time) — callers
 * skip a single failure and continue, matching every other adapter's
 * per-record contract; nothing here is ever guessed.
 */
export function parsePoolenEventDetailHtml(html: string, entry: PoolenProgramEntry, sourceUrl = POOLEN_PROGRAM_URL): RawCandidateEvent {
  const titleMatch = html.match(/<h1 class="text__h0 text__headline">([\s\S]*?)<\/h1>/);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : entry.title;
  if (!title) throw new Error(`Poolen detail page has no title (${entry.detailUrl})`);

  const heroMatch = html.match(/<section class="component component-08">([\s\S]*?)<\/section>/);
  if (!heroMatch) throw new Error(`Poolen detail page is missing its event-info section (${entry.detailUrl})`);
  const heroHtml = heroMatch[1];

  const rightColMarker = '<div class="row-start-1 gap-6 lg:pl-20 lg:row-auto lg:pl-0 single-event-info">';
  const rightColIdx = heroHtml.indexOf(rightColMarker);
  if (rightColIdx === -1) throw new Error(`Poolen detail page is missing its date/price info box (${entry.detailUrl})`);
  const leftColHtml = heroHtml.slice(0, rightColIdx);
  const rightColHtml = heroHtml.slice(rightColIdx + rightColMarker.length);

  // The description div's own opening tag is a unique substring within the
  // left column (the only OTHER "text__content"-classed element is a <p>
  // with an extra modifier class, "text__content text__content--large"),
  // and the left column already ends exactly at the info-box boundary
  // above — so everything after it is the full bio, without needing to
  // balance the nested <div class="player"> iframe wrapper inside it.
  const descMarker = '<div class="text__content">';
  const descIdx = leftColHtml.indexOf(descMarker);
  const descriptionHtml = descIdx === -1 ? "" : leftColHtml.slice(descIdx + descMarker.length);
  const fullDescriptionText = htmlToText(descriptionHtml).replace(/\n/g, " ").trim();
  // English-language guard (pre-launch QA audit, 2026-08-29 — Poolen's own
  // body text is sometimes Danish, and Electronic CPH is English-language
  // with no runtime translation; same rule Pumpehuset already applies).
  // Genre resolution below still uses the real, untruncated
  // fullDescriptionText as evidence regardless — this only decides what's
  // shown.
  const description = !fullDescriptionText
    ? null
    : isLikelyDanish(fullDescriptionText)
      ? null
      : truncateAtBoundary(fullDescriptionText, 600);

  const rightColLines = htmlToText(rightColHtml).split("\n");
  // The right column can carry a ticket-availability/status badge
  // ("Udsolgt", "Aflyst", "Få tilbage", "Flyttet") as its own line, and on
  // at least some pages it renders BEFORE the date line rather than after
  // it — real Production evidence (QA follow-up, 2026-08-29): the date
  // parser received the literal strings "Få tilbage" and "Aflyst" for real
  // events, because the code blindly trusted rightColLines[0] to always be
  // the date. Fixed structurally, not with title-specific exceptions: scan
  // for the first line that actually matches parseDanishDate's tight,
  // anchored "13. december 2026" shape (nothing else in this column — price,
  // times, address — can accidentally match that shape), collecting any
  // recognized status-label line encountered along the way as lifecycle
  // evidence instead of discarding or misreading it. Mirrors Pumpehuset's
  // conservative ticket_status handling: only the unambiguous "udsolgt"/
  // "aflyst" values are trusted; "få tilbage" (few left) is deliberately NOT
  // sold out, and "flyttet" (moved) is left to the ordinary reschedule
  // detection instead of guessed.
  let soldOutHint: boolean | null = null;
  let cancelledHint: boolean | null = null;
  let dateKey: DateKey | null = null;
  for (const line of rightColLines) {
    const normalized = line.trim().toLowerCase();
    if (normalized === "udsolgt") {
      soldOutHint = true;
      continue;
    }
    if (normalized === "aflyst") {
      cancelledHint = true;
      continue;
    }
    const parsed = parseDanishDate(line);
    if (parsed) {
      dateKey = parsed;
      break;
    }
  }
  if (!dateKey) {
    throw new Error(
      `Poolen detail page has an unparseable date "${rightColLines[0] ?? entry.dateText ?? ""}" (${entry.detailUrl})`,
    );
  }

  const doorsIdx = rightColLines.findIndex((l) => /^dørene åbner$/i.test(l));
  const showIdx = rightColLines.findIndex((l) => /^show start$/i.test(l));
  const doorsTime = doorsIdx !== -1 ? parseClockTime(rightColLines[doorsIdx + 1] ?? "") : null;
  const showTime = showIdx !== -1 ? parseClockTime(rightColLines[showIdx + 1] ?? "") : null;
  // Doors time is the event's real start (consistent with how Culture
  // Box's door hours are treated as the event's start); show start, when
  // earlier stated as identical or later, isn't a second instant worth a
  // separate field RawCandidateEvent doesn't have — it's already implied
  // by the stored description text for anyone who wants the detail.
  const openTime = doorsTime ?? showTime;
  if (!openTime) throw new Error(`Poolen detail page has no doors/show time (${entry.detailUrl})`);
  const startDatetime = copenhagenWallClockToUtc(dateKey, openTime.hour, openTime.minute).toISOString();

  const priceIdx = rightColLines.findIndex((l) => /^pris$/i.test(l));
  const priceFrom = priceIdx !== -1 ? parsePriceKr(rightColLines[priceIdx + 1] ?? "") : null;

  const ticketMatch = rightColHtml.match(/<a class="inline-block text-box-black" href="([^"]+)"/);
  const ticketUrl = ticketMatch ? ticketMatch[1] : entry.ticketUrl;

  // Support-artist names live outside the component-08 hero entirely, in a
  // later `.support-artists` block bounded by the section it sits inside.
  const supportMatch = html.match(/<div class="support-artists">([\s\S]*?)<\/section>/);
  const supportArtists = supportMatch
    ? [...supportMatch[1].matchAll(/<div class="text__headline text__headline--size-3 grid">\s*([^<]+?)\s*<\/div>/g)].map((m) =>
        decodeHtmlEntities(m[1]).trim(),
      )
    : [];
  // The headliner's own name for lineup/enrichment purposes, not the
  // display title — "Omar S – Outside" is a real artist plus a venue-area
  // suffix, and a Discogs lookup for "Omar S – Outside" would just fail.
  const headlinerName = title.replace(/\s*[–-]\s*Outside\s*$/i, "").trim();
  const artists = [headlinerName, ...supportArtists].filter(Boolean);

  // Genre evidence, evidence-hierarchy order: a specific subgenre keyword
  // in the venue's own description text is "official-description" (high),
  // exactly like Hangaren/Culture Box already credit their own bio text.
  // Failing that, an explicit (if non-specific) "electronic"/"elektronisk"
  // mention in that SAME first-party text is still real evidence — tagged
  // as the deliberately generic "electronic-other" rather than a guessed
  // subgenre. Anything short of that is left unresolved for the shared
  // pipeline's own fallback and lineup enrichment to attempt.
  const specificGenre = fullDescriptionText ? deterministicGenreFromText(fullDescriptionText) : null;
  const genericElectronic = !specificGenre && /\belectronic\b|\belektronisk\b/i.test(fullDescriptionText);
  const genreHint: GenreSlug | null = specificGenre ?? (genericElectronic ? "electronic-other" : null);

  return {
    sourceId: POOLEN_SOURCE_ID,
    sourceUrl,
    title,
    description,
    artists,
    startDatetime,
    endDatetime: null, // no end time is ever stated on this site — never invented
    venueName: POOLEN_VENUE_NAME,
    officialEventUrl: entry.detailUrl,
    ticketUrl,
    facebookUrl: null,
    residentAdvisorUrl: null,
    imageUrl: entry.imageUrl,
    priceFrom,
    genreHint,
    genreConfidenceHint: genreHint ? genreConfidenceForEvidence("official-description") : null,
    soldOutHint,
    cancelledHint,
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
      console.error(`[poolen-adapter] attempt 1 failed (${lastError}), retrying once in ${retryDelayMs}ms`);
      await delay(retryDelayMs);
    }
  }
  throw new Error(`${lastError} (after retry)`);
}

/**
 * Fetches the programme page, then every listed event's own detail page
 * (a short delay between each, out of politeness — this is ~25 requests
 * per sync, not one). A programme-page failure is a genuine source failure
 * (thrown, same as Hangaren/Culture Box). A single detail-page failure
 * drops only that one event — logged, never thrown — so one broken page
 * never takes down an otherwise-healthy sync; it's picked up again next run.
 */
export function createPoolenAdapter(fetchImpl: typeof fetch = fetch, retryDelayMs = 2_000, politenessDelayMs = 250): SourceAdapter {
  return {
    sourceId: POOLEN_SOURCE_ID,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      const programRes = await fetchWithRetry(fetchImpl, POOLEN_PROGRAM_URL, retryDelayMs, "Poolen programme page");
      const programHtml = await programRes.text();
      const entries = parsePoolenProgramHtml(programHtml);

      const results: RawCandidateEvent[] = [];
      for (const entry of entries) {
        try {
          const detailRes = await fetchWithRetry(fetchImpl, entry.detailUrl, retryDelayMs, `Poolen event page (${entry.detailUrl})`);
          const detailHtml = await detailRes.text();
          results.push(parsePoolenEventDetailHtml(detailHtml, entry, POOLEN_PROGRAM_URL));
        } catch (err) {
          console.error(`[poolen-adapter] skipping "${entry.title}": ${err instanceof Error ? err.message : String(err)}`);
        }
        if (politenessDelayMs > 0) await delay(politenessDelayMs);
      }
      return results;
    },
  };
}
