import { copenhagenWallClockToUtc, type DateKey } from "../datetime";
import { genreConfidenceForEvidence } from "../classification";
import { deterministicGenreFromText } from "./deterministicGenreMapping";
import { decodeHtmlEntities, htmlToText } from "./htmlExtraction";
import type { RawCandidateEvent, SourceAdapter } from "./types";

/**
 * Real first-party adapter for Pumpehuset (src-pumpehuset in
 * src/lib/data/sources.ts).
 *
 * Pumpehuset's programme page (pumpehuset.dk/en/program/) renders its
 * listing client-side: a Vue app (`#app`) calls
 * POST /wp-admin/admin-ajax.php with `action=fetch_concerts`, genre-filters
 * server-side (`genres=Elektronisk`), sorts by `concert_date` and paginates
 * (`pageNumber`/`pageAmount`) — this IS the mechanism the site's own
 * frontend uses to render events, not a scraped/reverse-engineered private
 * API. robots.txt (`User-agent: * / Disallow:`) places no restriction on
 * either the programme page or /wp-admin/admin-ajax.php. This adapter calls
 * that endpoint directly rather than fetching+parsing the client-rendered
 * HTML shell.
 *
 * The listing response gives every field EXCEPT a start time — only a plain
 * date ("20. aug 2026"). Each event's own detail page (`link`,
 * pumpehuset.dk/koncerter/<slug>/) is real server-rendered HTML carrying
 * both the date and the actual door/show times ("dørene åbner" / "Showet
 * starter", e.g. "20.00" / "21.00") in one small info card — so the detail
 * page is fetched for every candidate to resolve a real startDatetime,
 * mirroring cultureBoxAdapter.ts's listing+detail-page pattern. A detail
 * page that fails to fetch or doesn't carry a parseable time leaves that
 * candidate's startDatetime null (never guessed) — see
 * pumpehusetAdapter.test.ts for the real, unmodified recorded responses
 * this was built against.
 */

export const PUMPEHUSET_SOURCE_ID = "src-pumpehuset";
export const PUMPEHUSET_BASE_URL = "https://pumpehuset.dk";
export const PUMPEHUSET_AJAX_URL = `${PUMPEHUSET_BASE_URL}/wp-admin/admin-ajax.php`;
const PUMPEHUSET_VENUE_NAME = "Pumpehuset";
const PUMPEHUSET_GENRE_FILTER = "Elektronisk";
const PAGE_AMOUNT = 50;
const MAX_PAGES = 20; // safety bound against a pagination bug looping forever — real catalog is a few dozen events

interface PumpehusetSupportBand {
  band_name: string;
  band_description: string;
  image: string | false;
  spotify: string;
}

interface PumpehusetConcert {
  title: string;
  image: string | false;
  support_bands: PumpehusetSupportBand[] | false;
  custom_support_title: string | null;
  hide_support_title: boolean | null;
  date: string;
  date_list: string;
  year_list: string;
  price: string;
  ticket_link: string;
  ticket_status: string;
  link: string;
  genre: string;
}

const DANISH_MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  maj: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  okt: 10,
  nov: 11,
  dec: 12,
};

const DANISH_WEEKDAYS = /\b(Mandag|Tirsdag|Onsdag|Torsdag|Fredag|L[øo]rdag|S[øo]ndag)\b/i;

/** "20. aug 2026" / "13. sep 2026" -> {year, month, day}. Null on anything unrecognized — never guessed. */
export function parseDanishDate(dateText: string): DateKey | null {
  const cleaned = dateText.trim().toLowerCase();
  const match = cleaned.match(/^(\d{1,2})\.\s*([a-zæøå]+)\.?\s*(\d{4})$/);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const month = DANISH_MONTHS[monthText];
  if (!month) return null;
  const day = Number(dayText);
  if (day < 1 || day > 31) return null;
  return { year: Number(yearText), month, day };
}

/** "20.00" / "9.05" -> {hour, minute}. Null on anything unrecognized — never guessed. */
export function parseDotTime(text: string): { hour: number; minute: number } | null {
  const match = text.trim().match(/^(\d{1,2})\.(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** The text inside the next `.text__headline` div following the first occurrence of `label` in `html`, if any. */
function valueAfterLabel(html: string, label: string | RegExp): string | null {
  const labelMatch = typeof label === "string" ? html.indexOf(label) : (html.match(label)?.index ?? -1);
  if (labelMatch === -1) return null;
  const labelLength = typeof label === "string" ? label.length : (html.match(label)?.[0].length ?? 0);
  const after = html.slice(labelMatch + labelLength);
  const valueMatch = after.match(/<div[^>]*class="[^"]*text__headline[^"]*"[^>]*>\s*([^<]+?)\s*<\/div>/);
  return valueMatch ? decodeHtmlEntities(valueMatch[1]).trim() : null;
}

/**
 * Extracts an event's real date + start time from its own detail page.
 * Prefers the "Showet starter" (show start) time over "dørene åbner"
 * (doors) — doors is entry-only, the show start is the actual event start.
 * Falls back to doors time if show-start isn't present, since a doors-only
 * event still genuinely starts around then. Returns null (never a guessed
 * default) when the date or neither time field can be found — a free/promo
 * page template that omits this card is a real, expected case, not an
 * error.
 */
export function extractEventDateAndTime(detailHtml: string): { dateKey: DateKey; hour: number; minute: number } | null {
  // Scoped to the info card, not the whole document: pages also render an
  // "other events" widget further down reusing near-identical date/price
  // markup for unrelated events, which could otherwise false-match a
  // Danish weekday name. A fixed window comfortably covers the real card
  // (verified against real fixtures, well under 2000 chars) without
  // depending on being able to find its precise closing tag.
  const cardIdx = detailHtml.indexOf("single-event-info");
  if (cardIdx === -1) return null;
  const card = detailHtml.slice(cardIdx, cardIdx + 4000);

  const weekdayMatch = card.match(DANISH_WEEKDAYS);
  if (!weekdayMatch) return null;
  const dateText = valueAfterLabel(card, weekdayMatch[0]);
  const dateKey = dateText ? parseDanishDate(dateText) : null;
  if (!dateKey) return null;

  const showText = valueAfterLabel(card, "Showet starter");
  const doorsText = valueAfterLabel(card, "dørene åbner");
  const time = (showText && parseDotTime(showText)) || (doorsText && parseDotTime(doorsText));
  if (!time) return null;

  return { dateKey, hour: time.hour, minute: time.minute };
}

/** The venue's own presenter/promoter line ("PUMPEHUSET og Live nation Præsenterer"), if present — real evidence, not invented. */
function extractPresenterLine(detailHtml: string): string | null {
  const match = detailHtml.match(/<div class="u-text-white text__headline text__headline--size-5 grid">\s*([^<]+?)\s*<\/div>/);
  return match ? decodeHtmlEntities(match[1]).trim().replace(/\s+/g, " ") : null;
}

/** The intro paragraph's full opening tag, immediately preceding the fuller description div. */
const BODY_INTRO_MARKER = '<p class="text__content text__content--large">';

/**
 * Extracts the event's own written description from its detail page — a
 * real editorial write-up (Pumpehuset data-quality gap fix, 2026-08-21):
 * every event page carries an intro paragraph (`text__content--large`)
 * immediately followed by a fuller body block (`text__content`), BEFORE the
 * `single-event-info` date/price card this adapter already scopes off of.
 * This is genuine, event-specific first-party text — e.g. WITCHZ's own page
 * says "sin dragende, elektroniske lyd" (his captivating electronic sound)
 * and "alternativ pop, mørk electronica og industriel phonk" — but was
 * previously never read at all; only the small presenter line
 * ("PUMPEHUSET og X Præsenterer") was captured, which carries no genre
 * information. The body block's inner markup varies a lot per event
 * (observed live: some are pasted raw Facebook-post embed markup, deeply
 * nested divs with no clean structure) so this deliberately does NOT try to
 * parse that markup — it takes the whole raw slice between the intro
 * paragraph and `single-event-info` and lets htmlToText strip every tag
 * uniformly, regardless of nesting. A free/promo page whose intro paragraph
 * is empty (no bio at all) correctly yields an empty string, never invented
 * text.
 */
function extractBodyDescriptionLines(detailHtml: string): string[] {
  const cardIdx = detailHtml.indexOf("single-event-info");
  if (cardIdx === -1) return [];
  const introIdx = detailHtml.lastIndexOf(BODY_INTRO_MARKER, cardIdx);
  if (introIdx === -1 || introIdx > cardIdx) return [];
  // `single-event-info` is a class name inside that card's own opening
  // <div ...> tag, not the tag's start — slicing straight to cardIdx would
  // cut mid-tag, leaving a dangling, unclosed "<div class=..." fragment
  // that htmlToText can't recognize as a tag (no closing ">") and so
  // wouldn't strip. Cut at the start of that div's own opening tag instead.
  const cardTagStart = detailHtml.lastIndexOf("<div", cardIdx);
  const end = cardTagStart > introIdx ? cardTagStart : cardIdx;
  const block = detailHtml.slice(introIdx, end);
  return htmlToText(block).split("\n").filter(Boolean);
}

const LINEUP_START = /^Line[- ]?Up:?$/i;

/**
 * Best-effort lineup extraction from the body description text, when the
 * venue's own copy states one explicitly (e.g. "Line-Up: Leeni & Danilo
 * Kupfernagel / Lush / NILU" — real evidence found on a Byhaven pop-up page
 * whose fetch_concerts JSON carried no support_bands data at all, so the
 * only artists this adapter previously extracted were the promoter/event
 * name itself). Only ever ADDS real evidence — never invents names, and
 * returns an empty array (never guessed) when no such marker is present.
 */
function extractLineupFromBodyLines(lines: string[]): string[] {
  const startIdx = lines.findIndex((l) => LINEUP_START.test(l));
  if (startIdx === -1) return [];
  const names: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // A lineup list is a short run of names — a long sentence (a new prose
    // paragraph resuming after the list) signals the list has ended.
    if (line.split(" ").length > 6) break;
    names.push(line);
  }
  return names;
}

/** Support-band names + free-text bios, when present — real per-band evidence from the venue's own JSON, not a title guess. */
function artistsAndDescriptionFromBands(bands: PumpehusetSupportBand[]): { artists: string[]; description: string | null } {
  const artists = bands.map((b) => b.band_name.trim()).filter(Boolean);
  const bios = bands
    .map((b) => htmlToText(b.band_description ?? "").replace(/\n/g, " ").trim())
    .filter(Boolean);
  return { artists, description: bios.length > 0 ? bios.join("\n\n") : null };
}

function sameArtists(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Falls back to parsing the title itself when no support_bands list is given (common for a single-headliner show). */
function artistsFromTitle(title: string): string[] {
  const afterColon = title.includes(":") ? title.slice(title.indexOf(":") + 1) : title;
  return afterColon
    .split(/\s*\+\s*|\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parsePriceFrom(priceText: string): number | null {
  const digits = priceText.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

/**
 * Genre evidence: Pumpehuset's own `genre` field ("Elektronisk") is
 * official-source-metadata (classification.ts's evidence hierarchy's
 * highest tier) — this isn't inferred, the venue's own taxonomy says so
 * directly (unambiguous: "Elektronisk" is literally "Electronic" in
 * Danish, unlike e.g. Billetto's "hardcore" subcategory which turned out to
 * mean hardcore punk). When the venue's own text (title / support-band
 * bios / the event page's own written description) additionally names a
 * specific subgenre, that sharper slug is used instead at the same high
 * confidence — a keyword match against the venue's own text about THIS
 * show, matching hangarenAdapter/cultureBoxAdapter's "official-description"
 * precedent — but the generic "electronic-other" + official-source-metadata
 * credit is always the floor, never absent, since the source field itself
 * guarantees it. Takes arbitrary text pieces so it can be called twice: once
 * at listing-parse time (title + support-band bios only) and, when that
 * still lands on the generic floor, again at enrichment time once the
 * detail page's own richer body text is available (see enrichWithShowTimes)
 * — never overwrites an already-specific genre, only ever sharpens the
 * generic floor when stronger evidence becomes available.
 */
function resolveGenre(title: string, ...textPieces: (string | null)[]) {
  const textEvidence = [title, ...textPieces.filter((t): t is string => Boolean(t))].join(" ");
  const specific = deterministicGenreFromText(textEvidence);
  if (specific) {
    return { genreHint: specific, genreConfidenceHint: genreConfidenceForEvidence("official-description") };
  }
  return {
    genreHint: "electronic-other" as const,
    genreConfidenceHint: genreConfidenceForEvidence("official-source-metadata"),
  };
}

/**
 * Parses the fetch_concerts JSON response (already genre-filtered
 * server-side) into candidates. startDatetime is always null at this
 * stage — the listing response carries no time, only a date — and is
 * filled in later by enrichWithShowTimes from each event's own detail
 * page. A single malformed record is skipped, never thrown, matching every
 * other adapter's contract.
 */
export function parsePumpehusetConcertsJson(jsonText: string): RawCandidateEvent[] {
  let concerts: unknown;
  try {
    concerts = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(concerts)) return [];

  const results: RawCandidateEvent[] = [];
  for (const raw of concerts) {
    try {
      const concert = raw as PumpehusetConcert;
      const title = decodeHtmlEntities(concert.title ?? "").trim();
      if (!title || !concert.link) continue;
      if (!concert.genre || !concert.genre.toLowerCase().includes(PUMPEHUSET_GENRE_FILTER.toLowerCase())) continue;

      const bands = Array.isArray(concert.support_bands) ? concert.support_bands : [];
      const { artists: bandArtists, description } = artistsAndDescriptionFromBands(bands);
      const artists = bandArtists.length > 0 ? bandArtists : artistsFromTitle(title);

      const { genreHint, genreConfidenceHint } = resolveGenre(title, description);

      const isFree = /fri\s*entr/i.test(concert.ticket_status ?? "");
      const priceFrom = isFree ? 0 : parsePriceFrom(concert.price ?? "");

      results.push({
        sourceId: PUMPEHUSET_SOURCE_ID,
        sourceUrl: concert.link,
        title,
        description,
        artists,
        startDatetime: null, // resolved from the detail page by enrichWithShowTimes
        endDatetime: null,
        venueName: PUMPEHUSET_VENUE_NAME,
        officialEventUrl: concert.link,
        ticketUrl: concert.ticket_link || null,
        facebookUrl: null,
        residentAdvisorUrl: concert.ticket_link && /^https:\/\/ra\.co\//i.test(concert.ticket_link) ? concert.ticket_link : null,
        imageUrl: concert.image || null,
        priceFrom,
        genreHint,
        genreConfidenceHint,
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

async function fetchWithRetry(fetchImpl: typeof fetch, url: string, init: RequestInit, retryDelayMs: number, label: string): Promise<Response> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) });
      if (res.ok) return res;
      lastError = `${label} responded with HTTP ${res.status}`;
      if (res.status < 500) break; // a 4xx won't fix itself on retry
    } catch (err) {
      lastError = `${label} fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (attempt === 1) {
      console.error(`[pumpehuset-adapter] attempt 1 failed (${lastError}), retrying once in ${retryDelayMs}ms`);
      await delay(retryDelayMs);
    }
  }
  throw new Error(`${lastError} (after retry)`);
}

/**
 * Fetches every genre-filtered concert across all pages of the
 * fetch_concerts AJAX action. Paginates until a page returns fewer than
 * PAGE_AMOUNT items (standard end-of-results signal), capped at MAX_PAGES
 * as a safety bound. Throws after both attempts fail on any single page,
 * so the sync runner records a distinct source failure rather than a
 * silent partial/zero result.
 */
async function fetchAllConcerts(fetchImpl: typeof fetch, retryDelayMs: number): Promise<RawCandidateEvent[]> {
  const all: RawCandidateEvent[] = [];
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    const body = new URLSearchParams({
      action: "fetch_concerts",
      searchString: "",
      searchMonth: "false",
      sort: "concert_date",
      pageNumber: String(pageNumber),
      pageAmount: String(PAGE_AMOUNT),
      locations: "",
      genres: PUMPEHUSET_GENRE_FILTER,
    }).toString();

    const res = await fetchWithRetry(
      fetchImpl,
      PUMPEHUSET_AJAX_URL,
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "ElectronicCPHBot/1.0 (+https://electroniccph.com/about; first-party sync)" }, body },
      retryDelayMs,
      "Pumpehuset fetch_concerts",
    );
    const jsonText = await res.text();
    const pageCandidates = parsePumpehusetConcertsJson(jsonText);
    all.push(...pageCandidates);

    let pageItemCount: number;
    try {
      const parsed = JSON.parse(jsonText);
      pageItemCount = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      pageItemCount = 0;
    }
    if (pageItemCount < PAGE_AMOUNT) break;
  }
  return all;
}

/**
 * Resolves each candidate's real startDatetime from its own detail page
 * (see extractEventDateAndTime's header comment for why the listing alone
 * can't supply this). A single detail-page fetch failing or not carrying a
 * parseable date+time degrades only that candidate to startDatetime: null
 * — logged, never thrown — so one broken page can never take down an
 * otherwise-healthy Pumpehuset sync; a null startDatetime is then correctly
 * held by the shared quality gate rather than published with a guessed
 * time.
 */
async function enrichWithShowTimes(candidates: RawCandidateEvent[], fetchImpl: typeof fetch, retryDelayMs: number, politenessDelayMs: number): Promise<RawCandidateEvent[]> {
  const results: RawCandidateEvent[] = [];
  for (const candidate of candidates) {
    let next = candidate;
    if (candidate.officialEventUrl) {
      try {
        const res = await fetchWithRetry(
          fetchImpl,
          candidate.officialEventUrl,
          { headers: { "user-agent": "ElectronicCPHBot/1.0 (+https://electroniccph.com/about; first-party sync)", accept: "text/html" } },
          retryDelayMs,
          `Pumpehuset event page (${candidate.officialEventUrl})`,
        );
        const detailHtml = await res.text();
        const resolved = extractEventDateAndTime(detailHtml);
        if (resolved) {
          next = { ...candidate, startDatetime: copenhagenWallClockToUtc(resolved.dateKey, resolved.hour, resolved.minute).toISOString() };
        }
        const presenter = extractPresenterLine(detailHtml);
        const bodyLines = extractBodyDescriptionLines(detailHtml);
        const bodyDescription = bodyLines.length > 0 ? bodyLines.join(" ").replace(/\s+/g, " ").trim() : null;

        // Combine the richer written description (see extractBodyDescriptionLines'
        // doc comment for why this previously-unread text matters) with any
        // support-band bios already present; fall back to the bare presenter
        // line only when neither exists at all — never replaces real prose
        // with the presenter line.
        const combinedDescription = [next.description, bodyDescription].filter(Boolean).join("\n\n") || presenter || next.description;
        if (combinedDescription !== next.description) next = { ...next, description: combinedDescription };

        // The body text's own "Line-Up:" list (when present) is only trusted
        // when the listing JSON's support_bands data supplied nothing better
        // than the generic title-derived fallback — real support_bands
        // artists are never overridden.
        if (bodyLines.length > 0 && sameArtists(next.artists, artistsFromTitle(next.title))) {
          const bodyLineup = extractLineupFromBodyLines(bodyLines);
          if (bodyLineup.length > 0) next = { ...next, artists: bodyLineup };
        }

        // Re-attempt genre resolution now that the fuller detail-page text is
        // available — the listing-time pass only ever saw the title and
        // support-band bios. Never downgrades an already-specific genre
        // (resolveGenre itself never does), only ever sharpens the generic
        // "electronic-other" floor when real evidence becomes available.
        if (next.genreHint === "electronic-other") {
          const refined = resolveGenre(next.title, next.description);
          if (refined.genreHint !== "electronic-other") {
            next = { ...next, genreHint: refined.genreHint, genreConfidenceHint: refined.genreConfidenceHint };
          }
        }
      } catch (err) {
        console.error(
          `[pumpehuset-adapter] detail page fetch failed for ${candidate.officialEventUrl}, keeping startDatetime unresolved for this candidate: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    results.push(next);
    if (politenessDelayMs > 0) await delay(politenessDelayMs);
  }
  return results;
}

/**
 * Real HTTP adapter: fetches every Elektronisk-filtered concert from the
 * site's own fetch_concerts AJAX action, then enriches each with a real
 * start time from its own detail page. See this file's header comment for
 * why both stages are necessary.
 */
export function createPumpehusetAdapter(fetchImpl: typeof fetch = fetch, retryDelayMs = 2_000, politenessDelayMs = 250): SourceAdapter {
  return {
    sourceId: PUMPEHUSET_SOURCE_ID,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      const candidates = await fetchAllConcerts(fetchImpl, retryDelayMs);
      return enrichWithShowTimes(candidates, fetchImpl, retryDelayMs, politenessDelayMs);
    },
  };
}
