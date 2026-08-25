import { copenhagenWallClockToUtc, type DateKey } from "../datetime";
import { genreConfidenceForEvidence } from "../classification";
import { deterministicGenreFromText } from "./deterministicGenreMapping";
import { decodeHtmlEntities, htmlToText } from "./htmlExtraction";
import type { GenreSlug } from "../taxonomy";
import type { RawCandidateEvent, SourceAdapter } from "./types";

/**
 * Real first-party adapter for KultuNaut (src-kultunaut in
 * src/lib/data/sources.ts) — a national Danish culture-events aggregator
 * ("Den elektroniske kulturguide"), evaluated and onboarded during the
 * source-expansion work package (2026-08-25).
 *
 * DISCOVERY SCOPE: KultuNaut's own listing supports both a genre filter
 * (`Genre=`) and a geography filter (`Area=Kbh.+og+Frederiksberg`, the
 * exact area value confirmed live to restrict results to Copenhagen +
 * Frederiksberg — matching this app's own Venue.city union type). Only the
 * two real electronic-relevant taxonomy values confirmed live in the
 * site's own genre <select> are fetched — `Elektronisk` and `Club/DJ`
 * (confirmed disjoint sets, zero id overlap between them in a live check,
 * so both are worth fetching) — never a made-up value. robots.txt (fetched
 * live) disallows only specific /perl/ subpaths (searchlist, ebillet,
 * retsted, billet, images, huskeliste, adm, openlogin, openloginpref,
 * redir, nautjs, viskort, arradd) under one `User-agent: *` block; the
 * listing (`/perl/arrlist/`, `/perl/arrlist2/` pagination) and detail
 * (`/perl/arrmore/`) paths this adapter fetches are NOT in that list. The
 * `/perl/billet/` ticket-purchase path IS disallowed — this adapter never
 * fetches it, only stores the URL as ticketUrl (same as every other
 * adapter's Ticketmaster/RA ticket links: linked, never crawled).
 *
 * RELEVANCE: KultuNaut's own genre tag is real discovery-filter evidence
 * (it's why we only ever fetch these two tags) but is NOT trusted as
 * definitive electronic-relevance/genre-confidence evidence the way
 * Pumpehuset's server-filtered "Elektronisk" field is — live sampling
 * found real false positives under both tags (a Depeche-Mode listening
 * lecture, ambiguous electropop acts), the same kind of self-tagging
 * imprecision already documented for Billetto's own subcategory field.
 * Genre/relevance is therefore always derived the normal way, from the
 * event's own detail-page description text via the shared deterministic
 * mapping (same evidence-hierarchy rule as poolenAdapter.ts/aliceAdapter.ts)
 * and the pipeline's own Discogs lineup enrichment fallback — never
 * assumed from the site's tag or the venue alone.
 *
 * TECHNICAL: plain server-rendered HTML, no JSON-LD/microdata/JS hydration
 * of any kind — confirmed absent on both listing and detail pages. Charset
 * is iso-8859-1 declared ONLY via an in-body <meta> tag (the HTTP
 * Content-Type header carries no charset param at all) — `res.text()`
 * would silently corrupt every Danish æ/ø/å as this app's own
 * inspectSource.ts reachability tool discovered live; this adapter decodes
 * the raw bytes explicitly instead (see decodeKultunautBody below).
 *
 * Two-stage fetch, same shape as aliceAdapter.ts/poolenAdapter.ts: each
 * genre's listing page (paginated via `/perl/arrlist2/...?startnr=N`, same
 * full-HTML-page shape as page 1, confirmed live) supplies only the event
 * id + detail-page URL; every field (title, date, venue+address, ticket
 * link, description, image) comes from that event's own detail page, which
 * never repeats structured data the listing already carries reliably
 * enough to skip re-deriving it twice.
 *
 * No end time, and no reliable structured price field, are ever stated on
 * this site's detail pages — both left null/never guessed. A DKK amount
 * does sometimes appear loose inside the free-text description (e.g.
 * "Entré: 275 kr"), but never in a dedicated, consistently-positioned
 * field the way Culture Box/Poolen/ALICE's ticket-info blocks state a
 * price — extracting it would mean pattern-matching prose, not reading a
 * real field, so priceFrom is deliberately always null here.
 */

export const KULTUNAUT_SOURCE_ID = "src-kultunaut";
export const KULTUNAUT_BASE_URL = "https://www.kultunaut.dk/";
const KULTUNAUT_AREA = "Kbh. og Frederiksberg";
const KULTUNAUT_GENRES = ["Elektronisk", "Club/DJ"] as const;
const PAGE_SIZE = 12; // observed live — every listing/pagination page returns exactly 12 cards
const MAX_PAGES = 10; // loop protection (Billetto's precedent) — generous headroom over the ~35-50 events/genre observed live

const DANISH_MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  marts: 3,
  april: 4,
  maj: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
};

/**
 * KultuNaut serves `Content-Type: text/html` with no charset param — the
 * page declares iso-8859-1 only via an in-body <meta> tag that fetch()'s
 * own res.text() never looks at. Decoding explicitly here, rather than
 * trusting res.text(), is what actually fixes the corruption (see the
 * module doc comment) — mirrors inspectSource.ts's own decodeResponseBody,
 * kept separately here since that file is a diagnostic script, not
 * something this adapter should import from.
 */
async function decodeKultunautBody(res: Response): Promise<string> {
  const buf = new Uint8Array(await res.arrayBuffer());
  return new TextDecoder("iso-8859-1").decode(buf);
}

function buildListingUrl(genre: string, startnr: number): string {
  const base = startnr <= 1 ? "https://www.kultunaut.dk/perl/arrlist/type-nynaut" : "https://www.kultunaut.dk/perl/arrlist2/type-nynaut";
  const params = new URLSearchParams({ Genre: genre, Area: KULTUNAUT_AREA });
  if (startnr > 1) params.set("startnr", String(startnr));
  return `${base}?${params.toString()}`;
}

export function buildDetailUrl(arrNr: string): string {
  return `https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=${arrNr}`;
}

/** Every distinct event id + its own detail-page URL on one listing page, in document order. */
export function parseListingIds(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(/perl\/arrmore\/type-nynaut\?ArrNr=(\d+)/g)) {
    ids.add(m[1]);
  }
  return [...ids];
}

/** The page's own stated total result count ("Viser <strong>35</strong> events"), or null if not found. */
export function parseResultCount(html: string): number | null {
  const match = html.match(/result-count-map">Viser\s*<strong>(\d+)<\/strong>/);
  return match ? Number(match[1]) : null;
}

/** "d. 27. august 2026, kl. 20." / "kl. 20.30" -> {year,month,day,hour,minute}. Null on anything unrecognized — never guessed. */
export function parseKultunautDate(text: string): { date: DateKey; hour: number; minute: number } | null {
  const match = text.match(/d\.\s*(\d{1,2})\.\s*([a-zæøåA-ZÆØÅ]+)\s+(\d{4}),\s*kl\.\s*(\d{1,2})(?:\.(\d{2}))?/);
  if (!match) return null;
  const [, dayText, monthText, yearText, hourText, minuteText] = match;
  const month = DANISH_MONTHS[monthText.toLowerCase()];
  if (!month) return null;
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return { date: { year: Number(yearText), month, day }, hour, minute };
}

/**
 * Titles that read as an event/series NAME rather than a performer's own
 * name are never treated as a lineup — matches this project's "never
 * invented" rule for RawCandidateEvent.artists. Real evidence: "Murmur",
 * "Poliça", "FKJ", "Glayden (FI)" are genuinely just the act's own name;
 * "Copenhagen Soul Weekender in Absalon", "EleKtro Universal: Mini
 * Festival", "Stvw pres. punk rave" are event names, not artists — a
 * colon/pipe, "pres."/"presents", or a generic festival/night/tour/
 * weekender word are all real evidence of the latter. "musikforedrag"
 * (real evidence: "Depeche Modes Violator - musikforedrag", precision
 * audit 2026-08-25) is included for a second, more structural reason
 * beyond just "not an artist name": if the whole title were wrongly
 * treated as a single artist, relevance.ts's maskKnownArtistNames would
 * mask this exact word out of the negative-relevance category-signal
 * check downstream — silently defeating that check for the one case it
 * exists to catch. A non-artist title must never reach that masking step
 * at all.
 */
export function guessArtistsFromTitle(title: string): string[] {
  if (/[:|]|\bpres\.|\bpresents\b|\bfestival\b|\bweekender\b|\btour\b|club\s*night|mini\s*festival|\bmusikforedrag\b/i.test(title)) {
    return [];
  }
  return [title];
}

/**
 * Parses one event's detail page into a full RawCandidateEvent. Throws on
 * genuinely missing essentials (title, date, venue) — callers skip a
 * single failure and continue, matching every other adapter's per-record
 * contract; nothing here is ever guessed.
 */
export function parseKultunautDetailHtml(html: string, arrNr: string): RawCandidateEvent {
  const detailUrl = buildDetailUrl(arrNr);

  const titleMatch = html.match(/<h2 class="beta">([\s\S]*?)<\/h2>/);
  if (!titleMatch) throw new Error(`KultuNaut detail page has no title (${detailUrl})`);
  const title = decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim();
  if (!title) throw new Error(`KultuNaut detail page has an empty title (${detailUrl})`);

  const dateMatch = html.match(/class="event-date">[\s\S]*?<p>([^<]+)<\/p>/);
  if (!dateMatch) throw new Error(`KultuNaut detail page is missing its date block (${detailUrl})`);
  const parsedDate = parseKultunautDate(decodeHtmlEntities(dateMatch[1]));
  if (!parsedDate) throw new Error(`KultuNaut detail page has an unparseable date "${dateMatch[1]}" (${detailUrl})`);
  const startDatetime = copenhagenWallClockToUtc(parsedDate.date, parsedDate.hour, parsedDate.minute).toISOString();

  const venueMatch = html.match(/perl\/sted\/type-nynaut\/nr-\d+" class="ignore-external-icon">([^<]*)<\/a>\s*<p>([^<]*)<\/p>/);
  if (!venueMatch) throw new Error(`KultuNaut detail page is missing its venue block (${detailUrl})`);
  const venueName = decodeHtmlEntities(venueMatch[1]).trim();
  if (!venueName) throw new Error(`KultuNaut detail page has an empty venue name (${detailUrl})`);

  const ticketMatch = html.match(/<a class="(?:white|blue)button" href="([^"]+)" title="K\S+\/bestil billet"/);
  const ticketUrl = ticketMatch ? decodeHtmlEntities(ticketMatch[1]) : null;

  const articleMatch = html.match(/<article class="event-description">([\s\S]*?)<\/article>/);
  // Full, UNTRUNCATED cleaned text — genre classification below runs
  // against this, never against the shorter stored `description`. Real
  // bug found live during the precision audit (2026-08-25): a long
  // full-lineup rave write-up (Chapter ii: possessed @ Hangaren) states
  // "psytrance"/"Trance" only after character 800 — truncating first (as
  // an earlier version of this function did) silently discarded that
  // evidence and left the candidate's genre unresolved. Mirrors
  // aliceAdapter.ts's own fullDescriptionText/description split exactly.
  const fullDescriptionText = articleMatch
    ? htmlToText(articleMatch[1])
        .split("\n")
        .filter((line) => !/^K\S+\/bestil billet$/.test(line))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
  const description = fullDescriptionText ? fullDescriptionText.slice(0, 800) : null;

  const imageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
  const imageUrl = imageMatch ? decodeHtmlEntities(imageMatch[1]) : null;

  // Genre evidence, same evidence-hierarchy order as poolenAdapter.ts/
  // aliceAdapter.ts — NEVER the site's own genre tag (see module doc
  // comment for why that tag isn't trusted here): a specific subgenre
  // keyword in the event's own description text is "official-description"
  // (high); failing that, an explicit but non-specific "electronic"
  // mention in that same text is the deliberately generic
  // "electronic-other" rather than a guessed subgenre. Anything short of
  // that is left unresolved for the shared pipeline's own fallback and
  // Discogs lineup enrichment to attempt.
  const specificGenre = fullDescriptionText ? deterministicGenreFromText(fullDescriptionText) : null;
  const genericElectronic = !specificGenre && /\belectronic(s|a)?\b/i.test(fullDescriptionText);
  const genreHint: GenreSlug | null = specificGenre ?? (genericElectronic ? "electronic-other" : null);

  return {
    sourceId: KULTUNAUT_SOURCE_ID,
    sourceUrl: detailUrl,
    title,
    description,
    artists: guessArtistsFromTitle(title),
    startDatetime,
    endDatetime: null, // never stated on this site — never invented
    venueName,
    officialEventUrl: detailUrl,
    ticketUrl,
    facebookUrl: null,
    residentAdvisorUrl: null,
    imageUrl,
    priceFrom: null, // no reliable dedicated price field exists — see module doc comment
    genreHint,
    genreConfidenceHint: genreHint ? genreConfidenceForEvidence("official-description") : null,
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
      console.error(`[kultunaut-adapter] attempt 1 failed (${lastError}), retrying once in ${retryDelayMs}ms`);
      await delay(retryDelayMs);
    }
  }
  throw new Error(`${lastError} (after retry)`);
}

/**
 * Fetches every genre's paginated listing (stopping once the page's own
 * stated result count is reached, or a page returns fewer than PAGE_SIZE
 * ids, or MAX_PAGES is hit), dedupes ids across both genre fetches (a
 * listing failure here — the listing pages themselves, not a single
 * detail page — is a genuine source failure, thrown, same as every other
 * adapter's homepage/listing fetch), then fetches every distinct event's
 * own detail page (short politeness delay between each; a single
 * detail-page failure drops only that one event, logged, never thrown).
 */
export function createKultunautAdapter(fetchImpl: typeof fetch = fetch, retryDelayMs = 2_000, politenessDelayMs = 250): SourceAdapter {
  return {
    sourceId: KULTUNAUT_SOURCE_ID,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      const ids = new Set<string>();
      for (const genre of KULTUNAUT_GENRES) {
        let total: number | null = null;
        for (let page = 0; page < MAX_PAGES; page++) {
          const startnr = page * PAGE_SIZE + 1;
          if (total !== null && startnr > total) break;
          const url = buildListingUrl(genre, startnr);
          const res = await fetchWithRetry(fetchImpl, url, retryDelayMs, `KultuNaut listing (${genre}, startnr=${startnr})`);
          const html = await decodeKultunautBody(res);
          if (total === null) total = parseResultCount(html);
          const pageIds = parseListingIds(html);
          if (pageIds.length === 0) break;
          for (const id of pageIds) ids.add(id);
          if (pageIds.length < PAGE_SIZE) break;
          if (politenessDelayMs > 0) await delay(politenessDelayMs);
        }
      }

      const results: RawCandidateEvent[] = [];
      for (const arrNr of ids) {
        try {
          const detailRes = await fetchWithRetry(fetchImpl, buildDetailUrl(arrNr), retryDelayMs, `KultuNaut event page (ArrNr=${arrNr})`);
          const detailHtml = await decodeKultunautBody(detailRes);
          results.push(parseKultunautDetailHtml(detailHtml, arrNr));
        } catch (err) {
          console.error(`[kultunaut-adapter] skipping ArrNr=${arrNr}: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (politenessDelayMs > 0) await delay(politenessDelayMs);
      }
      return results;
    },
  };
}
