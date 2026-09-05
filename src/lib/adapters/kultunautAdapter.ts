import { copenhagenWallClockToUtc, type DateKey } from "../datetime";
import { genreConfidenceForEvidence } from "../classification";
import { deterministicGenreFromText, hasRichGenreEvidence } from "./deterministicGenreMapping";
import { decodeHtmlEntities, htmlToText } from "./htmlExtraction";
import type { GenreSlug } from "../taxonomy";
import type { RawCandidateEvent, SourceAdapter } from "./types";

/**
 * Real first-party adapter for KultuNaut (src-kultunaut in
 * src/lib/data/sources.ts) — a national Danish culture-events aggregator
 * ("Den elektroniske kulturguide"), evaluated across a two-stage audit
 * (source-expansion, 2026-08-25; full inventory + dedup verification and
 * VEGA venue-model fix, 2026-09-05) and implemented as a DISCOVERY-ONLY
 * source per that audit's final decision.
 *
 * WHY DISCOVERY-ONLY, NOT A BACKBONE: the full audit inventoried every
 * current/upcoming event (62 unique, exhaustive pagination) and verified
 * every plausible A/B-tier candidate event-by-event against Production's
 * real canonical events and Discovery Queue. Result: of 14 A-tier and 17
 * B-tier candidates, 18 were exact duplicates already covered by Poolen,
 * Pumpehuset, Hangaren, ALICE or Billetto's own first-party/API coverage,
 * 1 was already Discovery-Queue-pending, and only 4 A-tier + 8 B-tier were
 * genuinely new — real, non-trivial discovery value, but not enough to
 * justify auto-publish trust: roughly a quarter of all 62 events yielded
 * zero usable genre evidence even from full detail-page text, KultuNaut's
 * own genre tag was proven unreliable (real false positives: Gloryhammer
 * and Clawfinger, both metal bands, tagged "Club/DJ"; a Depeche Mode
 * listening-lecture tagged "Elektronisk"), and the site's own
 * legal/reuse terms were never located or reviewed (robots.txt permits the
 * paths this adapter uses, but that is crawl permission, not a confirmed
 * reuse license). This adapter therefore NEVER auto-publishes — see
 * src/lib/data/sources.ts's src-kultunaut registration (`autoPublish:
 * false`, `roles: ["discovery"]`) and src/db/sync.ts's own enforcement of
 * that flag (a source-level gate that applies to any future
 * autoPublish:false source, not special-cased to this one).
 *
 * DISCOVERY SCOPE: KultuNaut's own listing supports both a genre filter
 * (`Genre=`) and a geography filter (`Area=Kbh.+og+Frederiksberg`, the
 * exact area value confirmed live — both in the original audit and again
 * in the 2026-09-05 follow-up — to restrict results to Copenhagen +
 * Frederiksberg, matching this app's own Venue.city union type). Only the
 * two real electronic-relevant taxonomy values in the site's own genre
 * <select> are fetched — `Elektronisk` and `Club/DJ` (confirmed disjoint
 * sets, zero ArrNr overlap between them, verified again 2026-09-05 across
 * a full exhaustive pagination of both: 38 Elektronisk + 24 Club/DJ = 62
 * unique events, zero cross-category duplicates) — never a made-up value.
 * robots.txt (fetched live, most recently 2026-09-05, unchanged from the
 * original audit) disallows only specific /perl/ subpaths (searchlist,
 * ebillet, retsted, billet, images, huskeliste, adm, openlogin,
 * openloginpref, redir, nautjs, viskort, arradd) under one `User-agent: *`
 * block; the listing (`/perl/arrlist/`, `/perl/arrlist2/` pagination) and
 * detail (`/perl/arrmore/`) paths this adapter fetches are NOT in that
 * list. The `/perl/billet/` ticket-purchase path IS disallowed — this
 * adapter never fetches it, only stores the URL as ticketUrl (same as
 * every other adapter's Ticketmaster/RA ticket links: linked, never
 * crawled).
 *
 * RELEVANCE: KultuNaut's own genre tag is real discovery-filter evidence
 * (it's why we only ever fetch these two tags) but is NOT trusted as
 * definitive electronic-relevance/genre-confidence evidence. Genre/
 * relevance is always derived the normal way, from the event's own
 * detail-page description text via the shared deterministic mapping (same
 * evidence-hierarchy rule as poolenAdapter.ts/aliceAdapter.ts), the
 * `relevanceText` field (so the pipeline's own negative-relevance check
 * sees the FULL detail-page text, never just the display-truncated
 * `description`), and the pipeline's own Discogs lineup-enrichment
 * fallback — never assumed from the site's tag or the venue alone. This
 * adapter deliberately does NOT pre-filter candidates before they reach
 * the shared pipeline (an earlier draft of this adapter, from the
 * 2026-08-25 audit, had its own bespoke "positive electronic evidence"
 * gate keyed to two specific trusted venues — reviewed and REMOVED here:
 * the shared pipeline already safely represents "insufficient evidence"
 * as a low-confidence Discovery Queue row, exactly like every other
 * broad-aggregator source's own noise (Billetto's Discovery Queue already
 * carries hundreds of such rows) — inventing a KultuNaut-specific
 * pre-filter on top of that would itself be exactly the kind of
 * source-specific classification system the 2026-09-05 audit's
 * implementation gate explicitly prohibits).
 *
 * TECHNICAL: plain server-rendered HTML, no JSON-LD/microdata/JS hydration
 * of any kind — confirmed absent on both listing and detail pages, most
 * recently re-confirmed 2026-09-05. Charset is iso-8859-1 declared ONLY
 * via an in-body <meta> tag (the HTTP Content-Type header carries no
 * charset param at all) — `res.text()` would silently corrupt every
 * Danish æ/ø/å; this adapter decodes the raw bytes explicitly instead (see
 * decodeKultunautBody below).
 *
 * Two-stage fetch, same shape as aliceAdapter.ts/poolenAdapter.ts: each
 * genre's listing page (paginated via `/perl/arrlist2/...?startnr=N`, same
 * full-HTML-page shape as page 1) supplies only the event id + detail-page
 * URL; every field (title, date, venue+address, ticket link, description,
 * image) comes from that event's own detail page, which never repeats
 * structured data the listing already carries reliably enough to skip
 * re-deriving it twice.
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
const MAX_PAGES = 10; // loop protection (Billetto's precedent) — generous headroom over the ~35-40 events/genre observed live

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

/**
 * "d. 27. august 2026, kl. 20." / "kl. 20.30" -> {year,month,day,hour,minute}.
 * Also handles a multi-day event's date block, which states the START day
 * separately from the month/year — e.g. "Fre. d. 29. og lør. d. 30. januar
 * 2027, kl. 07." and "Tor. d. 26. til søn. d. 29. august 2027, kl. 18-03." —
 * by capturing the FIRST "d. DAY." as this event's start day, optionally
 * skipping over an "og/til [WEEKDAY.] d. DAY." interstitial that names the
 * range's end day, before requiring the MONTH YEAR that follows (a trailing
 * "-05"/"-03" end-hour in a range is never captured as this event's own
 * start time; only the first number after "kl." is, matching the
 * single-start-time semantics this site uses throughout). Real verified
 * evidence (2026-09-05 fixture capture, byte-accurate after fixing
 * inspectSource.ts's charset handling — see decodeResponseBody): "Electro
 * Werkz" (ArrNr 20265870, Fri 29 – Sat 30 Jan 2027) must parse to day=29,
 * and "Karrusel 2027" (ArrNr 20288648, Thu 26 – Sun 29 Aug 2027) must parse
 * to day=26 — both regression-tested directly against these real strings.
 * Null on anything unrecognized — never guessed.
 */
export function parseKultunautDate(text: string): { date: DateKey; hour: number; minute: number } | null {
  const match = text.match(
    /d\.\s*(\d{1,2})\.\s*(?:(?:og|til)\s+(?:[a-zæøåA-ZÆØÅ]+\.\s*)?d\.\s*\d{1,2}\.\s*)?([a-zæøåA-ZÆØÅ]+)\s+(\d{4}),?\s*kl\.\s*(\d{1,2})(?:\.(\d{2}))?/,
  );
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
 * (real evidence: "Depeche Modes Violator - musikforedrag") is included
 * for a second, more structural reason beyond just "not an artist name":
 * if the whole title were wrongly treated as a single artist,
 * relevance.ts's maskKnownArtistNames would mask this exact word out of
 * the negative-relevance category-signal check downstream — silently
 * defeating that check for the one case it exists to catch. A non-artist
 * title must never reach that masking step at all.
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
  // Full, UNTRUNCATED cleaned text — genre classification and relevanceText
  // (below) both run against this, never against the shorter stored
  // `description`. Real bug this guards against (found live during the
  // original 2026-08-25 precision audit): a long full-lineup rave write-up
  // (Chapter ii: possessed @ Hangaren) states "psytrance"/"Trance" only
  // after character 800 — truncating first would silently discard that
  // evidence. Mirrors aliceAdapter.ts's own fullDescriptionText/description
  // split exactly.
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
  // Gap 4D (KultuNaut publish work package, 2026-09-05): a bare, uncorroborated
  // keyword match ("Live experimental electronics" — four words, one hit) must
  // not earn the same top evidence tier as a richly-evidenced match (a second
  // distinct genre-family hit, or explicit dance/club-context corroboration —
  // see hasRichGenreEvidence's own doc comment). Generalized in the shared
  // mapping module, not specific to this source: any adapter treating its own
  // first-party description text as "official-description" tier has the same
  // exposure.
  const hasRichEvidence = fullDescriptionText ? hasRichGenreEvidence(fullDescriptionText) : false;

  return {
    sourceId: KULTUNAUT_SOURCE_ID,
    sourceUrl: detailUrl,
    title,
    description,
    // The FULL detail-page text, independent of `description`'s 800-char
    // display truncation (RawCandidateEvent.relevanceText's own doc
    // comment) — so the shared pipeline's negative-relevance check
    // (hasNonElectronicGenreSignal/hasNonElectronicCategorySignal) always
    // sees everything this adapter saw when it resolved genreHint, never
    // just the truncated display copy.
    relevanceText: fullDescriptionText || null,
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
    genreConfidenceHint: genreHint
      ? genreConfidenceForEvidence(hasRichEvidence ? "official-description" : "deterministic-mapping")
      : null,
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
 * own detail page (short politeness delay between each).
 *
 * COMPLETENESS (source freshness/completeness architecture,
 * src/lib/adapters/types.ts's SourceAdapter.lastFetchWasComplete): unlike
 * the earlier 2026-08-25 draft of this adapter, a single detail-page
 * failure is no longer treated as merely "drop this one candidate and
 * move on" for freshness purposes — it also marks this whole sync's
 * result as INCOMPLETE (lastFetchWasComplete() returns false), mirroring
 * billettoAdapter.ts's own later-page-failure handling generalized to
 * per-candidate-detail-page granularity. This matters because
 * src/db/sync.ts's freshness bookkeeping (lastCompleteSyncAt) is what the
 * venue-blocks diagnostic and Discovery Queue staleness derivation rely on
 * to tell "genuinely no longer offered by the source" apart from "this
 * sync just had a transient per-record hiccup" — a candidate that failed
 * to fetch this run must never be silently treated as stale/gone.
 */
export function createKultunautAdapter(fetchImpl: typeof fetch = fetch, retryDelayMs = 2_000, politenessDelayMs = 250): SourceAdapter {
  // Tracks whether the most recent fetchCandidates() call gathered every
  // listing page AND every detail page it discovered — see the doc comment
  // above and SourceAdapter.lastFetchWasComplete's own doc comment. Starts
  // true; only a detail-page failure below ever sets it false. A fresh
  // fetchCandidates() call always resets it first.
  let lastFetchComplete = true;

  return {
    sourceId: KULTUNAUT_SOURCE_ID,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      lastFetchComplete = true;
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
          const candidate = parseKultunautDetailHtml(detailHtml, arrNr);
          results.push(candidate);
        } catch (err) {
          console.error(`[kultunaut-adapter] skipping ArrNr=${arrNr}: ${err instanceof Error ? err.message : String(err)}`);
          lastFetchComplete = false;
        }
        if (politenessDelayMs > 0) await delay(politenessDelayMs);
      }
      return results;
    },
    lastFetchWasComplete(): boolean {
      return lastFetchComplete;
    },
  };
}
