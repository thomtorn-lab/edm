import { genreConfidenceForEvidence } from "../classification";
import { deterministicGenreFromText, hasRichGenreEvidence } from "./deterministicGenreMapping";
import { decodeHtmlEntities, htmlToText, truncateAtBoundary } from "./htmlExtraction";
import type { GenreSlug } from "../taxonomy";
import type { RawCandidateEvent, SourceAdapter } from "./types";

/**
 * HvadErPå — shared discovery-only gap-filler adapter, Phase 1.
 *
 * WHY THIS EXISTS AND WHY IT'S SCOPED THIS NARROWLY: a three-round read-only
 * viability probe (HVADERPAA — NARROW TECHNICAL VIABILITY PROBE, closed with
 * a "B. BUILD RECOMMENDED WITH CONDITIONS" decision) individually opened and
 * classified every current/upcoming event at 14 candidate venues. Of 30 raw
 * events inspected, 21 were genuinely incremental relevant EDM coverage, but
 * 100% of that value came from just 5 of the 14 venues — Den Anden Side (9),
 * MODULE (4), Jolene (4), Baggen (2), and Klub Werkstatt (2, which already
 * has its own dedicated adapter and is deliberately excluded here). The other
 * 9 venues (RUST, H15, Halvandet, Pylonen, Bolsjefabrikken, Mayhem, Hotel
 * Cecil, UnderWerket, Basement) contributed ZERO incremental events — several
 * are hardcore/metal/jazz/wellness venues entirely outside Electronic CPH's
 * remit. Phase 1 therefore targets ONLY Den Anden Side, MODULE, Jolene and
 * Baggen's own venue pages, via explicit per-venue URL targeting — never the
 * site-wide event feed, and never any venue outside this allowlist, even if
 * hvaderpaa.dk's own markup happened to reference one (defended in code, see
 * ALLOWED_VENUES below and its use in fetchCandidates/parseEventJsonLd).
 *
 * DISCOVERY-ONLY: this source is registered general-aggregator/autoPublish
 * false in src/lib/data/sources.ts (src-hvaderpaa) — src/db/sync.ts's own
 * sourceAutoPublishAllowed gate enforces this regardless of what the shared
 * pipeline would otherwise decide, exactly like src-kultunaut. A general-
 * aggregator source's officialEventUrl also structurally can never render
 * "Official event" on the public site (src/lib/links.ts's classifySourceRole)
 * — it always renders "Source", satisfying the probe's corrected link
 * semantics (a hvaderpaa event page is provenance, never a first-party
 * record) without any adapter-local special-casing.
 *
 * TECHNICAL: every hvaderpaa.dk page carries clean, consistent schema.org
 * JSON-LD — confirmed across ~50 live fetches during the probe. A venue page
 * (/da/spillested/<slug>-koebenhavn/) carries a Place block followed by an
 * ItemList block (numberOfItems, itemListElement[] with position/url/name) —
 * the complete, authoritative current upcoming-event list for that venue. An
 * event page (/da/event/<id>/) carries one Event block with name, startDate/
 * endDate (both fully-offset ISO 8601 — no Danish-text date parsing needed,
 * unlike kultunautAdapter.ts), description, performer[], image, offers (an
 * Offer or AggregateOffer with .url), and location{name,address}.
 *
 * STABLE IDENTITY: hvaderpaa's own numeric event id, embedded in its event
 * page URL (/da/event/<id>/), IS the stable source-event identity — this
 * adapter sets both sourceUrl and officialEventUrl to that exact URL (same
 * pattern as every other adapter), and the shared pipeline's own dedupKey
 * (`raw.officialEventUrl ?? raw.sourceUrl`, see src/db/sync.ts) is what
 * Ignore Persistence, pending-row matching and sourceEventLinks all key off —
 * no separate ID-tracking mechanism is needed.
 *
 * LINK ROLES (probe's corrected semantics, Section 7 — reused exactly, never
 * a hvaderpaa-specific shortcut): an event's own offers.url is only ever a
 * CANDIDATE, never blindly trusted as "Tickets" merely because hvaderpaa put
 * it there.
 *   - ra.co (Resident Advisor)          -> residentAdvisorUrl, never ticketUrl
 *     (matches hangarenAdapter.ts/pumpehusetAdapter.ts precedent exactly —
 *     this is also a real, independent relevance signal: pipeline.ts's own
 *     hasTrustedElectronicTicketing is `raw.residentAdvisorUrl != null`).
 *   - billetto.dk                       -> ticketUrl (genuine purchase page).
 *   - songkick.com, bandsintown.com, or  -> neither field populated. Every
 *     any other unrecognized host           in-scope event sampled during the
 *                                          probe with one of these hosts was
 *                                          a listing/RSVP aggregator, not a
 *                                          direct purchase page or an
 *                                          event-specific official venue
 *                                          page — never guessed into a role
 *                                          it didn't earn.
 * Official Event: never populated from offers.url at all — no event across
 * every venue sampled in the probe ever carried a genuine event-specific
 * official venue/promoter page there (always RA/a ticket platform/absent).
 * officialEventUrl is always the hvaderpaa event page itself (Source role,
 * structurally guaranteed — see above).
 *
 * RELEVANCE: HvadErPå exposes no first-party genre taxonomy at all (unlike
 * Billetto's categorization.subcategory or KultuNaut's Genre= filter) — this
 * adapter's own genreHint comes only from the event's own description text,
 * same evidence-hierarchy order as every other Danish-text adapter (poolen/
 * alice/kultunaut): a specific-subgenre keyword is "official-description"
 * tier; failing that, an explicit-but-non-specific electronic mention is the
 * generic "electronic-other" at the same tier (Danish "elektronisk" is
 * checked here in addition to English "electronic" — deterministicGenreMapping.ts
 * itself has no Danish generic-electronic keyword, and real evidence from the
 * probe shows several genuinely-relevant events state ONLY "elektronisk
 * musikaften"/"elektronisk klubaften" with no more specific keyword, e.g.
 * "Order Of Magnitude: Quake" at Den Anden Side). Anything short of that is
 * left unresolved for the shared pipeline's own deterministic-mapping
 * fallback and Discogs lineup enrichment — never assumed from the venue
 * alone, matching every mixed-programme first-party adapter's own rule and
 * the probe's own explicit relevance rule ("do not infer relevance merely
 * because the venue is electronic-focused").
 *
 * CANCELLATION: no cancelledHint/soldOutHint is ever set — hvaderpaa's own
 * eventStatus was observed as EventScheduled on every event sampled, and per
 * the probe's own decision this source is discovery-only, not an authoritative
 * cancellation/status source. cancellationPolicy: "none" on the source
 * registration (src/lib/data/sources.ts) means an event this adapter no
 * longer sees on a later sync is never auto-unpublished on that basis alone —
 * same as every other "none"-policy source.
 */

export const HVADERPAA_SOURCE_ID = "src-hvaderpaa";
export const HVADERPAA_BASE_URL = "https://hvaderpaa.dk/";

/**
 * The Phase 1 venue allowlist — deliberately the ONLY four pages this
 * adapter ever fetches, and the only venue names a candidate is ever allowed
 * to resolve to. `canonicalName` matches this app's own venue registry
 * (src/lib/data/venues.ts) exactly, including the one deliberate exception:
 * hvaderpaa's own location.name for Jolene is "Jolene" (registered there as
 * an alias of the canonical "Jolene Bar") — never hardcoded to the registry
 * name, since venueName here should reflect what the SOURCE actually said,
 * with resolution against aliases left to the shared pipeline's own
 * resolveVenue (src/lib/normalize.ts), exactly like every other adapter.
 */
const ALLOWED_VENUES: { slug: string; canonicalName: string }[] = [
  { slug: "den-anden-side-koebenhavn", canonicalName: "Den Anden Side" },
  { slug: "module-koebenhavn", canonicalName: "MODULE" },
  { slug: "jolene-koebenhavn", canonicalName: "Jolene" },
  { slug: "baggen-koebenhavn", canonicalName: "Baggen" },
];

function venuePageUrl(slug: string): string {
  return `https://hvaderpaa.dk/da/spillested/${slug}/`;
}

/** True when `name` matches one of the allowlisted venues, case/whitespace-insensitive. */
function isAllowedVenueName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return ALLOWED_VENUES.some((v) => v.canonicalName.toLowerCase() === normalized);
}

/**
 * Every `<script type="application/ld+json">...</script>` block on a page,
 * parsed. A single malformed block is skipped, never thrown — hvaderpaa's
 * pages carry several unrelated JSON-LD blocks per page (Place, ItemList,
 * BreadcrumbList, Event), and this adapter only ever reads the one(s) it
 * recognizes by shape below.
 */
function extractJsonLdBlocks(html: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && typeof parsed === "object") blocks.push(parsed as Record<string, unknown>);
    } catch {
      // Skip a single malformed block — never fatal for the rest of the page.
    }
  }
  return blocks;
}

export interface HvaderpaaItemListEntry {
  url: string;
  name: string;
}

/**
 * The venue page's own ItemList JSON-LD block — the complete, authoritative
 * current upcoming-event list for that venue (confirmed live during the
 * probe: this superseded an earlier, wrong assumption that some venues'
 * event lists needed scrolling further down the HTML). Empty array (never
 * thrown) when the page states its own empty-state message or the block is
 * genuinely absent — both real, valid "0 upcoming events" outcomes.
 */
export function parseVenueItemList(html: string): HvaderpaaItemListEntry[] {
  const blocks = extractJsonLdBlocks(html);
  const itemList = blocks.find((b) => b["@type"] === "ItemList");
  if (!itemList) return [];
  const items = itemList.itemListElement;
  if (!Array.isArray(items)) return [];
  const out: HvaderpaaItemListEntry[] = [];
  for (const item of items) {
    if (item && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string") {
      const url = (item as Record<string, unknown>).url as string;
      const name = typeof (item as Record<string, unknown>).name === "string" ? ((item as Record<string, unknown>).name as string) : "";
      out.push({ url, name });
    }
  }
  return out;
}

/**
 * Classifies an event's offers.url into the correct link-role field — see
 * this module's own doc comment for the full semantics. Never guessed:
 * anything that isn't recognizably ra.co or billetto.dk earns neither role.
 */
export function classifyOffersUrl(url: string | null): { ticketUrl: string | null; residentAdvisorUrl: string | null } {
  if (!url) return { ticketUrl: null, residentAdvisorUrl: null };
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { ticketUrl: null, residentAdvisorUrl: null };
  }
  if (hostname === "ra.co") return { ticketUrl: null, residentAdvisorUrl: url };
  if (hostname === "billetto.dk") return { ticketUrl: url, residentAdvisorUrl: null };
  return { ticketUrl: null, residentAdvisorUrl: null };
}

// Danish generic-electronic mention (deterministicGenreMapping.ts has no
// Danish keyword at all — see this module's own doc comment for the real
// probe evidence this covers, e.g. "elektronisk musikaften" with no more
// specific keyword present).
const DANISH_GENERIC_ELECTRONIC_RE = /\belektronisk(e)?\b/i;
const ENGLISH_GENERIC_ELECTRONIC_RE = /\belectronic(s|a)?\b/i;

/**
 * Parses one event's own JSON-LD Event block into a full RawCandidateEvent.
 * Returns null (never throws) on a genuinely missing essential (name,
 * startDate, location.name) or a venue outside the Phase 1 allowlist —
 * callers skip a single failure/rejection and continue, matching every
 * other adapter's per-record contract.
 */
export function parseEventJsonLd(html: string, eventUrl: string): RawCandidateEvent | null {
  const blocks = extractJsonLdBlocks(html);
  const event = blocks.find((b) => b["@type"] === "Event" || b["@type"] === "MusicEvent");
  if (!event) return null;

  const title = typeof event.name === "string" ? decodeHtmlEntities(event.name).trim() : "";
  if (!title) return null;

  const startDateRaw = typeof event.startDate === "string" ? event.startDate : null;
  if (!startDateRaw) return null;
  const startDate = new Date(startDateRaw);
  if (Number.isNaN(startDate.getTime())) return null;
  const startDatetime = startDate.toISOString();

  const endDateRaw = typeof event.endDate === "string" ? event.endDate : null;
  const endDate = endDateRaw ? new Date(endDateRaw) : null;
  const endDatetime = endDate && !Number.isNaN(endDate.getTime()) ? endDate.toISOString() : null;

  const location = event.location as Record<string, unknown> | undefined;
  const venueNameRaw = location && typeof location.name === "string" ? location.name : null;
  if (!venueNameRaw) return null;
  const venueName = decodeHtmlEntities(venueNameRaw).trim();
  // Phase 1 allowlist enforcement (defense in depth — see this module's own
  // doc comment): even though this adapter only ever fetches the four
  // allowlisted venue pages, a candidate whose own JSON-LD names a different
  // venue is rejected outright rather than trusted, so a future hvaderpaa
  // markup change can never smuggle an out-of-scope venue's event in.
  if (!isAllowedVenueName(venueName)) return null;

  const description = typeof event.description === "string" ? decodeHtmlEntities(event.description).trim() : "";
  // Full, untruncated text is what genre classification runs against
  // (relevanceText) — the shorter, display-truncated `description` is
  // derived from it, same split as every other adapter.
  const fullDescriptionText = description ? htmlToText(description) : "";
  const truncatedDescription = fullDescriptionText ? truncateAtBoundary(fullDescriptionText, 800) : null;

  const performers = Array.isArray(event.performer) ? event.performer : [];
  const artists: string[] = [];
  for (const p of performers) {
    if (p && typeof p === "object" && typeof (p as Record<string, unknown>).name === "string") {
      const name = decodeHtmlEntities(((p as Record<string, unknown>).name as string)).trim();
      if (name) artists.push(name);
    }
  }

  const imageUrl = typeof event.image === "string" ? event.image : null;

  const offers = event.offers as Record<string, unknown> | undefined;
  const offersUrl = offers && typeof offers.url === "string" ? offers.url : null;
  const { ticketUrl, residentAdvisorUrl } = classifyOffersUrl(offersUrl);
  let priceFrom: number | null = null;
  if (offers) {
    const rawPrice = offers.price ?? offers.lowPrice;
    if (typeof rawPrice === "string" || typeof rawPrice === "number") {
      const parsed = Number(rawPrice);
      if (!Number.isNaN(parsed)) priceFrom = parsed;
    }
  }

  // GENRE EVIDENCE (see this module's own doc comment for the full
  // evidence-hierarchy rule): title + description together, same as every
  // other adapter's relevanceText composition (pipeline.ts prepends the
  // title again regardless, but genreHint resolution here follows the same
  // "look at everything the adapter itself saw" rule other adapters use).
  const evidenceText = `${title} ${fullDescriptionText}`.trim();
  const specificGenre = evidenceText ? deterministicGenreFromText(evidenceText) : null;
  const genericElectronic = !specificGenre && (DANISH_GENERIC_ELECTRONIC_RE.test(evidenceText) || ENGLISH_GENERIC_ELECTRONIC_RE.test(evidenceText));
  const genreHint: GenreSlug | null = specificGenre ?? (genericElectronic ? "electronic-other" : null);
  const hasRichEvidence = evidenceText ? hasRichGenreEvidence(evidenceText) : false;

  return {
    sourceId: HVADERPAA_SOURCE_ID,
    sourceUrl: eventUrl,
    title,
    description: truncatedDescription,
    relevanceText: fullDescriptionText || null,
    artists,
    startDatetime,
    endDatetime,
    venueName,
    // Always the hvaderpaa event page itself — Source/provenance only,
    // never Official event (see this module's own doc comment: this is
    // structurally guaranteed by the general-aggregator sourceType, not by
    // anything adapter-local).
    officialEventUrl: eventUrl,
    ticketUrl,
    facebookUrl: null,
    residentAdvisorUrl,
    imageUrl,
    priceFrom,
    genreHint,
    genreConfidenceHint: genreHint ? genreConfidenceForEvidence(hasRichEvidence ? "official-description" : "deterministic-mapping") : null,
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
      if (res.status < 500) break;
    } catch (err) {
      lastError = `${label} fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (attempt === 1) {
      console.error(`[hvaderpaa-adapter] attempt 1 failed (${lastError}), retrying once in ${retryDelayMs}ms`);
      await delay(retryDelayMs);
    }
  }
  throw new Error(`${lastError} (after retry)`);
}

/**
 * Fetches every allowlisted venue page's ItemList, then every distinct
 * event's own detail page (deduped by URL across venues, though no overlap
 * is expected in practice). A venue-page listing failure is a genuine source
 * failure for that venue and is thrown per-venue but caught at the top level
 * so one venue's outage never blocks the other three; a single event
 * detail-page failure is skipped (marks the whole sync INCOMPLETE, same
 * freshness-bookkeeping contract as kultunautAdapter.ts — see
 * SourceAdapter.lastFetchWasComplete's own doc comment).
 */
export function createHvaderpaaAdapter(fetchImpl: typeof fetch = fetch, retryDelayMs = 2_000, politenessDelayMs = 250): SourceAdapter {
  let lastFetchComplete = true;

  return {
    sourceId: HVADERPAA_SOURCE_ID,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      lastFetchComplete = true;
      const eventUrls = new Map<string, string>(); // url -> venue name it was discovered under, for logging only

      for (const venue of ALLOWED_VENUES) {
        try {
          const res = await fetchWithRetry(fetchImpl, venuePageUrl(venue.slug), retryDelayMs, `HvadErPå venue page (${venue.canonicalName})`);
          const html = await res.text();
          const items = parseVenueItemList(html);
          for (const item of items) eventUrls.set(item.url, venue.canonicalName);
        } catch (err) {
          console.error(`[hvaderpaa-adapter] venue page failed (${venue.canonicalName}): ${err instanceof Error ? err.message : String(err)}`);
          lastFetchComplete = false;
        }
        if (politenessDelayMs > 0) await delay(politenessDelayMs);
      }

      const results: RawCandidateEvent[] = [];
      for (const [eventUrl, venueLabel] of eventUrls) {
        try {
          const res = await fetchWithRetry(fetchImpl, eventUrl, retryDelayMs, `HvadErPå event page (${eventUrl})`);
          const html = await res.text();
          const candidate = parseEventJsonLd(html, eventUrl);
          if (!candidate) {
            console.error(`[hvaderpaa-adapter] skipping ${eventUrl}: no parseable Event JSON-LD or venue outside Phase 1 allowlist (discovered under ${venueLabel})`);
            continue;
          }
          results.push(candidate);
        } catch (err) {
          console.error(`[hvaderpaa-adapter] skipping ${eventUrl}: ${err instanceof Error ? err.message : String(err)}`);
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
