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
 * each event's own /concerts/<slug>/ page. So this adapter fetches the
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
 * Refshaleøen, not a separate venue — events there are still tagged
 * venueName "Poolen" (with "Poolen Outside" registered as an alias in
 * src/lib/data/venues.ts) rather than inventing a second venue record; the
 * "– Outside" distinction is preserved in the event's own title text, which
 * is exactly how the venue itself presents it.
 *
 * Markup rewrite (2026-09-17): Poolen relaunched its site between two
 * scheduled syncs (last success 2026-09-16 11:42 UTC, first failure 17:02
 * UTC the same day), replacing the old `component-event-teaser`/`boxify`/
 * `text__h2` programme markup and `component-08`/`text__h0` detail-page
 * markup with a new `pc-shows__*` / `pc-concert__*` BEM-style structure, and
 * moving detail pages from `/da/koncerter/<slug>/` to `/concerts/<slug>/`.
 * The new markup exposes both the show date (`<time datetime="YYYY-MM-DD">`)
 * and, on detail pages, doors/show times as clean `<dt>/<dd>` facts — no
 * more free-text Danish date/status-line parsing needed. The programme list
 * itself no longer carries a per-item image; each event's image is now read
 * from its own detail page instead (`.pc-concert__media img`).
 */

export const POOLEN_SOURCE_ID = "src-poolen";
export const POOLEN_BASE_URL = "https://poolen.dk";
export const POOLEN_PROGRAM_URL = "https://poolen.dk/da/";
const POOLEN_VENUE_NAME = "Poolen";

/** "20:00" / "21.00" -> {hour, minute}. Both separators appear on real pages. Null on anything unrecognized. */
function parseClockTime(text: string): { hour: number; minute: number } | null {
  const match = text.trim().match(/^(\d{1,2})[.:](\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** "295 kr. inkl. gebyr" / "From 363 kr. inkl. gebyr" -> 295 / 363. Null when no amount is present. */
function parsePriceKr(text: string): number | null {
  const match = text.match(/(\d+)\s*kr\.?/i);
  return match ? Number(match[1]) : null;
}

/** "2026-09-19" -> {year:2026, month:9, day:19}. Null on anything unrecognized — never guessed. */
function parseIsoDate(text: string): DateKey | null {
  const match = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export interface PoolenProgramEntry {
  title: string;
  detailUrl: string;
  ticketUrl: string | null;
  /** Raw ISO date from the programme page's own `<time datetime="...">` — not yet parsed/validated. */
  dateText: string | null;
}

/**
 * Parses the programme page's `<ol class="pc-shows__list"><li class="pc-shows__item ...">`
 * entries. Each item carries the title/link (`.pc-shows__title` /
 * `.pc-shows__title-text`), a machine-readable date (`.pc-shows__when`'s own
 * `datetime` attribute), and a ticket action that is either a `<a
 * class="pc-shows__action ...">` link or, for a cancelled/sold-out show, a
 * plain `<span class="pc-shows__action ...">` status badge instead (no
 * `href` at all) — status detection itself happens on the detail page
 * (see parsePoolenEventDetailHtml), so a missing `<a>` here just means
 * ticketUrl stays null for that entry.
 */
export function parsePoolenProgramHtml(html: string): PoolenProgramEntry[] {
  const blocks = html.match(/<li class="pc-shows__item[^"]*"[^>]*>[\s\S]*?<\/li>/g) ?? [];
  const results: PoolenProgramEntry[] = [];

  for (const block of blocks) {
    try {
      const hrefMatch = block.match(/<a class="pc-shows__title" href="([^"]+)"/);
      if (!hrefMatch) continue; // malformed block — skip, never take down the whole sync
      const detailUrl = hrefMatch[1];

      const titleMatch = block.match(/<span class="pc-shows__title-text">([^<]*)<\/span>/);
      const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() : "";
      if (!title) continue;

      const dateMatch = block.match(/<time class="pc-shows__when" datetime="([^"]+)"/);
      const dateText = dateMatch ? dateMatch[1] : null;

      const ticketMatch = block.match(/<a\s+class="pc-shows__action[^"]*"\s*href="([^"]+)"/);

      results.push({ title, detailUrl, ticketUrl: ticketMatch ? ticketMatch[1] : null, dateText });
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
  const titleMatch = html.match(/<h1 class="pc-concert__title">([\s\S]*?)<\/h1>/);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : entry.title;
  if (!title) throw new Error(`Poolen detail page has no title (${entry.detailUrl})`);

  // The info box (date/facts/ticket action) and the body/prose that follows
  // it are two adjacent, reliably-ordered blocks — sliced between their own
  // opening markers rather than balancing nested divs, same approach the
  // pre-relaunch parser used for its own left/right column split.
  const infoStart = html.indexOf('<div class="pc-concert__info');
  const bodyStart = infoStart === -1 ? -1 : html.indexOf('<div class="pc-concert__body', infoStart);
  if (infoStart === -1 || bodyStart === -1) throw new Error(`Poolen detail page is missing its event-info section (${entry.detailUrl})`);
  const infoHtml = html.slice(infoStart, bodyStart);

  const dateAttrMatch = infoHtml.match(/<time datetime="([^"]+)"/);
  const dateKey = dateAttrMatch ? parseIsoDate(dateAttrMatch[1]) : null;
  if (!dateKey) throw new Error(`Poolen detail page has an unparseable date (${entry.detailUrl})`);

  const facts: Record<string, string> = {};
  for (const factMatch of infoHtml.matchAll(/<dt>([^<]+)<\/dt>\s*<dd>([^<]*)<\/dd>/g)) {
    facts[decodeHtmlEntities(factMatch[1]).trim()] = decodeHtmlEntities(factMatch[2]).trim();
  }

  // Doors time is the event's real start (consistent with how Culture
  // Box's door hours are treated as the event's start); show start, when
  // earlier stated as identical or later, isn't a second instant worth a
  // separate field RawCandidateEvent doesn't have — it's already implied
  // by the stored description text for anyone who wants the detail.
  const doorsTime = facts["Doors"] ? parseClockTime(facts["Doors"]) : null;
  const showTime = facts["Show"] ? parseClockTime(facts["Show"]) : null;
  const openTime = doorsTime ?? showTime;
  if (!openTime) throw new Error(`Poolen detail page has no doors/show time (${entry.detailUrl})`);
  const startDatetime = copenhagenWallClockToUtc(dateKey, openTime.hour, openTime.minute).toISOString();

  const priceFrom = facts["Price"] ? parsePriceKr(facts["Price"]) : null;

  // The ticket action is either a real ticket link, or — for a cancelled or
  // sold-out show — a plain status badge with no href at all. Conservative,
  // same as the pre-relaunch parser: only the unambiguous "Cancelled"/"Sold
  // out" values are trusted as hints, nothing else is guessed.
  const ticketLinkMatch = infoHtml.match(/<a\s+class="pc-concert__action[^"]*"\s*href="([^"]+)"/);
  const ticketUrl = ticketLinkMatch ? ticketLinkMatch[1] : entry.ticketUrl;
  const statusMatch = infoHtml.match(/<span class="pc-concert__action[^"]*">\s*([^<]+?)\s*<\/span>/);
  const statusText = statusMatch ? statusMatch[1].trim().toLowerCase() : null;
  const soldOutHint = statusText === "sold out" ? true : null;
  const cancelledHint = statusText === "cancelled" ? true : null;

  // The event's own image now lives on its detail page only — the
  // programme list stopped carrying per-item images in the relaunch.
  // Scoped to the hero figure specifically: earlier `<img>` tags on the
  // page (e.g. a sponsor logo in the header) are not the event's image.
  const mediaMatch = html.match(/<figure class="pc-concert__media">([\s\S]*?)<\/figure>/);
  const imgMatch = mediaMatch ? mediaMatch[1].match(/<img[^>]+src="([^"]+)"/) : null;
  const imageUrl = imgMatch ? imgMatch[1] : null;

  // The description prose sits between its own opening marker and whichever
  // comes first: a support-artists block, or the always-present Lockers
  // section — same bounded-slice approach as the info box above.
  const proseMarker = '<div class="pc-concert__prose">';
  const proseIdx = html.indexOf(proseMarker, bodyStart);
  let descriptionHtml = "";
  if (proseIdx !== -1) {
    const supportIdx = html.indexOf('<div class="pc-concert__support">', proseIdx);
    const lockersIdx = html.indexOf("pc-concert__lockers", proseIdx);
    const boundaries = [supportIdx, lockersIdx].filter((i) => i !== -1);
    const proseEnd = boundaries.length > 0 ? Math.min(...boundaries) : html.length;
    descriptionHtml = html.slice(proseIdx + proseMarker.length, proseEnd);
  }
  const fullDescriptionText = htmlToText(descriptionHtml).replace(/\n/g, " ").trim();
  // English-language guard (pre-launch QA audit, 2026-08-29 — Poolen's own
  // body text used to sometimes be Danish; the site is now English-first
  // post-relaunch, but the guard is harmless to keep and still protects
  // against any residual Danish copy). Genre resolution below still uses
  // the real, untruncated fullDescriptionText as evidence regardless — this
  // only decides what's shown.
  const description = !fullDescriptionText
    ? null
    : isLikelyDanish(fullDescriptionText)
      ? null
      : truncateAtBoundary(fullDescriptionText, 600);

  // Support-artist names live in their own `.pc-concert__band` sections,
  // each with a `.pc-concert__band-name` heading — a distinct class from
  // the unrelated "Related shows" list further down the page, so no
  // bounding is needed to avoid picking those up.
  const supportArtists = [...html.matchAll(/<h2 class="pc-concert__band-name">([^<]+)<\/h2>/g)].map((m) =>
    decodeHtmlEntities(m[1]).trim(),
  );
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
    imageUrl,
    priceFrom,
    genreHint,
    genreConfidenceHint: genreHint ? genreConfidenceForEvidence("official-description") : null,
    // The real, untruncated text genre resolution above used (see the
    // comment on `description` a few lines up) — kept separately so the
    // shared pipeline's relevance check sees it too, even for a Danish bio
    // whose `description` above is null (relevance-architecture audit,
    // 2026-08-30 — see RawCandidateEvent.relevanceText's doc comment).
    relevanceText: fullDescriptionText || null,
    soldOutHint,
    cancelledHint,
    cancellationEvidence: cancelledHint ? 'Poolen status badge "Cancelled"' : null,
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
 * Fetches the programme page, then every listed event's own detail page (a
 * short delay between each, out of politeness — this is ~30 requests per
 * sync, not one). A programme-page failure is a genuine source failure
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
