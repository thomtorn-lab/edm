import { copenhagenWallClockToUtc, type DateKey } from "../datetime";
import { genreConfidenceForEvidence } from "../classification";
import { deterministicGenreFromText } from "./deterministicGenreMapping";
import { decodeHtmlEntities, htmlToText, truncateAtBoundary } from "./htmlExtraction";
import type { GenreSlug } from "../taxonomy";
import type { RawCandidateEvent, SourceAdapter } from "./types";

/**
 * Real first-party adapter for Gravity Copenhagen (src-gravity in
 * src/lib/data/sources.ts). Gravity repair audit, 2026-08-25.
 *
 * The registry's pre-existing src-gravity entry (adapter: "first-party-json",
 * lastError: "0 events parsed...") was never a real integration — it is
 * explicitly commented "Deliberately degraded example — mirrors spec section
 * 43's '0 events detected' case", and no adapter file or ADAPTERS-map entry
 * for it ever existed anywhere in this codebase (confirmed by search before
 * writing this file). There is no JSON feed to repair: gravitycph.dk is a
 * plain WordPress + WooCommerce site (robots.txt is the standard WP
 * boilerplate, generator meta confirms WordPress 7.1 / WooCommerce 11.0.1),
 * ticket sales happen in-page via WooCommerce (not a third-party platform),
 * and /events/ returns 404 — there is no dedicated archive endpoint. Real
 * upcoming shows are announced as individual WordPress Pages (not a "event"
 * custom post type — /wp-json/wp/v2/pages/<id> is the only relevant REST
 * route, no public /events REST collection), linked from the homepage's own
 * hero carousel. This is the same two-stage shape as poolenAdapter.ts /
 * aliceAdapter.ts: fetch the homepage once for the current line-up, then
 * each listed event's own detail page for date/time, venue, genre and
 * description — implemented fresh here since no prior working version
 * exists to repair.
 *
 * Every candidate the homepage currently carries (confirmed live: Eric
 * Prydz, Armin van Buuren, CamelPhat, I Hate Models — all Oct-Dec 2026) is
 * hosted at TAP1, not at Gravity's own registered address; "Gravity" is a
 * promoter brand renting TAP1's room, not a fixed physical venue.
 *
 * QA follow-up (2026-08-29): detail pages are not all on the same template.
 * Three of the four (Eric Prydz, Armin van Buuren, I Hate Models) still
 * carry the original "icon-box" info-rows — a "Location: "TAP 1"" row for
 * venue and an explicit "Music: <tags>" row for genre (e.g. "Trance &
 * Techno") — fed into the same deterministicGenreFromText mapping every
 * other adapter uses. CamelPhat's page alone has been migrated to a new
 * template that drops those info-rows and instead serves a schema.org
 * MusicEvent JSON-LD block. parseGravityEventDetailHtml tries the old
 * template first, then falls back to JSON-LD, so a page on either template
 * — and any future page migrated the same way CamelPhat's was — resolves
 * correctly without title-specific handling.
 */

export const GRAVITY_SOURCE_ID = "src-gravity";
export const GRAVITY_BASE_URL = "https://gravitycph.dk/";

/** "26.09.2026" -> {year:2026, month:9, day:26}. Null on anything unrecognized. */
function parseGravityListingDate(text: string): DateKey | null {
  const match = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return { year, month, day };
}

/** "20:00 - 04:00" -> {start:{hour:20,minute:0}, end:{hour:4,minute:0}}. Null on anything unrecognized. */
function parseGravityTimeRange(text: string): { start: { hour: number; minute: number }; end: { hour: number; minute: number } } | null {
  const match = text.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);
  if (startHour > 23 || startMinute > 59 || endHour > 23 || endMinute > 59) return null;
  return { start: { hour: startHour, minute: startMinute }, end: { hour: endHour, minute: endMinute } };
}

/** Extracts one "icon-box" info-row's value by its label (e.g. "Location:", "Music:") — the shared markup shape every old-template info-row on a Gravity detail page uses. */
function extractInfoRow(html: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*</strong>\\s*<span[^>]*>([\\s\\S]*?)</span>`, "i");
  const match = html.match(re);
  if (!match) return null;
  const text = htmlToText(match[1]).replace(/\s+/g, " ").trim();
  return text || null;
}

/**
 * Structured MusicEvent data from the detail page's own JSON-LD block
 * (QA follow-up, 2026-08-29: real Production evidence — the CamelPhat page
 * specifically has been migrated to a new detail-page template that carries
 * a schema.org MusicEvent block with a full startDate/endDate, venue name,
 * and description, and drops the old "icon-box" date/Location/Music info-rows
 * entirely. Live-reconfirmed the same day: Eric Prydz, Armin van Buuren, and
 * I Hate Models — the rest of the current lineup — are all still on the old
 * template with the old info-rows intact and no MusicEvent JSON-LD at all,
 * so this is a per-page migration in progress, not a site-wide redesign; an
 * unconditional switch to JSON-LD-only parsing would have fixed CamelPhat
 * while silently breaking the other three. See tryOldTemplateFields /
 * tryJsonLdFields below for the resulting two-path extraction.
 */
interface GravityJsonLd {
  startDate: string;
  endDate?: string;
  description?: string;
  location?: { name?: string };
}

function extractGravityJsonLd(html: string): GravityJsonLd | null {
  const match = html.match(
    /<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@type":"MusicEvent".*?)<\/script>/,
  );
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as Partial<GravityJsonLd>;
    if (typeof parsed.startDate !== "string") return null;
    return parsed as GravityJsonLd;
  } catch {
    return null;
  }
}

/** Fields common to both extraction paths, assembled into a RawCandidateEvent by parseGravityEventDetailHtml. */
interface GravityCoreFields {
  startDatetime: string;
  endDatetime: string | null;
  venueName: string;
  description: string | null;
  genreEvidenceText: string;
}

/**
 * Old template: date/time from the "23 October | Friday | 20:00 - 04:00"
 * icon-box row (combined with the listing page's own date), venue from the
 * "Location: "TAP 1"" row, description/genre from the body paragraph plus
 * the "Music:" row. Returns null (never throws) when any required piece is
 * absent, so the caller can fall back to the JSON-LD path — this is how a
 * page on the new template (no old info-rows at all) is distinguished from
 * a genuinely broken old-template page.
 */
function tryOldTemplateFields(html: string, dateKey: DateKey): GravityCoreFields | null {
  const timeRangeMatch = html.match(/\d{1,2}\s+\w+\s*\|\s*\w+\s*\|\s*(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})/);
  const timeRange = timeRangeMatch ? parseGravityTimeRange(timeRangeMatch[1]) : null;
  if (!timeRange) return null;

  // The Location info-row is shaped differently from every other info-row:
  // the label AND the venue name both sit inside the same <strong> (curly
  // quotes around the name, e.g. Location: "TAP 1"), while the <span> right
  // after carries the street address instead of a repeated value — so this
  // needs its own pattern rather than extractInfoRow's label-then-span shape.
  const venueMatch = html.match(/Location:\s*[“"]([^”"]+)[”"]/);
  const venueName = venueMatch ? decodeHtmlEntities(venueMatch[1]).trim() : null;
  if (!venueName) return null;

  const startDatetime = copenhagenWallClockToUtc(dateKey, timeRange.start.hour, timeRange.start.minute).toISOString();
  // The end time is on the same calendar date as doors unless it's past
  // midnight (a "20:00 - 04:00" show ends the following morning) — same
  // next-day rule every other late-night adapter on this codebase applies.
  const endDateKey =
    timeRange.end.hour < timeRange.start.hour || (timeRange.end.hour === timeRange.start.hour && timeRange.end.minute < timeRange.start.minute)
      ? { ...dateKey, day: dateKey.day + 1 }
      : dateKey;
  const endDatetime = copenhagenWallClockToUtc(endDateKey, timeRange.end.hour, timeRange.end.minute).toISOString();

  const musicText = extractInfoRow(html, "Music:");
  const paragraphMatch = html.match(/animate-paragraph">([\s\S]*?)<div class="d-flex align-items-center justify-content-center/);
  const fullDescriptionText = paragraphMatch ? htmlToText(paragraphMatch[1]).replace(/\n/g, " ").replace(/\s+/g, " ").trim() : "";
  const description = [fullDescriptionText, musicText ? `Music: ${musicText}` : null].filter(Boolean).join(" ") || null;
  const genreEvidenceText = [musicText, fullDescriptionText].filter(Boolean).join(" ");

  return { startDatetime, endDatetime, venueName, description, genreEvidenceText };
}

/**
 * New template: everything from the page's own schema.org MusicEvent
 * JSON-LD block. startDate/endDate already carry a UTC offset — no
 * wall-clock/timezone-name parsing needed, unlike the old template. Returns
 * null (never throws) when the block is absent or missing an essential
 * field, so the caller reports one unified "no parseable start/end time"
 * failure rather than a path-specific one.
 */
function tryJsonLdFields(html: string): GravityCoreFields | null {
  const jsonLd = extractGravityJsonLd(html);
  if (!jsonLd || Number.isNaN(Date.parse(jsonLd.startDate))) return null;

  const startDatetime = new Date(jsonLd.startDate).toISOString();
  const endDatetime = jsonLd.endDate && !Number.isNaN(Date.parse(jsonLd.endDate)) ? new Date(jsonLd.endDate).toISOString() : null;

  const venueName = jsonLd.location?.name ? decodeHtmlEntities(jsonLd.location.name).trim() : null;
  if (!venueName) return null;

  const fullDescriptionText = jsonLd.description ? decodeHtmlEntities(jsonLd.description).trim() : "";
  const description = fullDescriptionText || null;

  return { startDatetime, endDatetime, venueName, description, genreEvidenceText: fullDescriptionText };
}

export interface GravityListingEntry {
  title: string;
  detailUrl: string;
  dateKey: DateKey | null;
}

/**
 * Parses the homepage's hero carousel. Real markup repeats every card twice
 * (a desktop/mobile responsive duplicate — confirmed live: identical
 * title+date+url pairs appear back to back), so entries are deduplicated by
 * detailUrl, keeping the first (and always identical) occurrence.
 */
export function parseGravityHomeHtml(html: string): GravityListingEntry[] {
  const seen = new Set<string>();
  const results: GravityListingEntry[] = [];
  const cardRe =
    /<h4 class="animate-me lh-sm my-0 fw-medium" style="color:#6a6a6a !important;">([^<]*)<\/h4>[\s\S]{0,400}?<div class="title">\s*<a href="([^"]+)">\s*<h4[^>]*>\s*<span[^>]*>([^<]*)<\/span>/g;

  for (const match of html.matchAll(cardRe)) {
    try {
      const dateText = decodeHtmlEntities(match[1]).trim();
      const detailUrl = match[2];
      const title = decodeHtmlEntities(match[3]).replace(/\s+/g, " ").trim();
      if (!title || !detailUrl) continue;
      if (seen.has(detailUrl)) continue;
      seen.add(detailUrl);
      results.push({ title, detailUrl, dateKey: parseGravityListingDate(dateText) });
    } catch {
      // A single malformed card must never take down the whole sync.
      continue;
    }
  }
  return results;
}

/**
 * Parses one event's detail page into a full RawCandidateEvent. Throws on
 * genuinely missing essentials (date, time, venue) — callers skip a single
 * failure and continue, matching every other adapter's per-record contract.
 */
export function parseGravityEventDetailHtml(html: string, entry: GravityListingEntry, sourceUrl = GRAVITY_BASE_URL): RawCandidateEvent {
  const { title, detailUrl } = entry;
  if (!title) throw new Error(`Gravity detail page has no title (${detailUrl})`);
  if (!entry.dateKey) throw new Error(`Gravity listing date is unparseable for "${title}" (${detailUrl})`);

  // Old template first — it's what most of the current lineup is still on —
  // then JSON-LD for a page that's been migrated to the new one. Neither
  // path throws on its own; only exhausting both is a real failure.
  const fields = tryOldTemplateFields(html, entry.dateKey) ?? tryJsonLdFields(html);
  if (!fields) throw new Error(`Gravity detail page has no parseable start/end time (${detailUrl})`);
  const { startDatetime, endDatetime, venueName, description, genreEvidenceText } = fields;

  // Genre evidence: whichever path matched already folds its own
  // event-specific genre text (the old template's "Music:" row, or the new
  // template's JSON-LD description) into genreEvidenceText. Same
  // deterministic-mapping-first rule every other adapter follows; text with
  // no specific genre/electronic keyword correctly resolves to no hint
  // rather than a guess.
  const specificGenre = genreEvidenceText ? deterministicGenreFromText(genreEvidenceText) : null;
  const genericElectronic = !specificGenre && /\belectronic(s|a)?\b/i.test(genreEvidenceText);
  const genreHint: GenreSlug | null = specificGenre ?? (genericElectronic ? "electronic-other" : null);

  // The homepage sometimes prefixes a recurring theme-night brand onto the
  // real title (real evidence: "Gravity Opera: CAMELPHAT") — kept verbatim
  // in title (it's genuinely how the site displays it), but stripped for
  // artists so lineup/dedup matching sees the artist name, not the brand.
  const artistName = title.replace(/^Gravity\s+\w+:\s*/i, "").trim() || title;

  return {
    sourceId: GRAVITY_SOURCE_ID,
    sourceUrl,
    title,
    description: description ? truncateAtBoundary(description, 800) : null,
    artists: [artistName],
    startDatetime,
    endDatetime,
    venueName,
    officialEventUrl: detailUrl,
    ticketUrl: detailUrl, // tickets are sold in-page via WooCommerce — no separate reseller URL exists
    facebookUrl: null,
    residentAdvisorUrl: null,
    imageUrl: null,
    priceFrom: null, // price is rendered client-side after a ticket-tier is picked — never present in the static HTML
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
      console.error(`[gravity-adapter] attempt 1 failed (${lastError}), retrying once in ${retryDelayMs}ms`);
      await delay(retryDelayMs);
    }
  }
  throw new Error(`${lastError} (after retry)`);
}

/**
 * Fetches the homepage's current hero carousel, then every listed event's
 * own detail page (a short politeness delay between each). A homepage fetch
 * failure is a genuine source failure (thrown). A single detail-page failure
 * drops only that one event — logged, never thrown — so one broken page
 * never takes down an otherwise-healthy sync.
 */
export function createGravityAdapter(fetchImpl: typeof fetch = fetch, retryDelayMs = 2_000, politenessDelayMs = 250): SourceAdapter {
  return {
    sourceId: GRAVITY_SOURCE_ID,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      const homeRes = await fetchWithRetry(fetchImpl, GRAVITY_BASE_URL, retryDelayMs, "Gravity homepage");
      const homeHtml = await homeRes.text();
      const entries = parseGravityHomeHtml(homeHtml);

      const results: RawCandidateEvent[] = [];
      for (const entry of entries) {
        try {
          const detailRes = await fetchWithRetry(fetchImpl, entry.detailUrl, retryDelayMs, `Gravity event page (${entry.detailUrl})`);
          const detailHtml = await detailRes.text();
          results.push(parseGravityEventDetailHtml(detailHtml, entry, GRAVITY_BASE_URL));
        } catch (err) {
          console.error(`[gravity-adapter] skipping "${entry.title}": ${err instanceof Error ? err.message : String(err)}`);
        }
        if (politenessDelayMs > 0) await delay(politenessDelayMs);
      }
      return results;
    },
  };
}
