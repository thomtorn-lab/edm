import { genreConfidenceForEvidence } from "../classification";
import { deterministicGenreFromText } from "./deterministicGenreMapping";
import type { GenreSlug } from "../taxonomy";
import type { RawCandidateEvent, SourceAdapter } from "./types";

/**
 * Real adapter for Billetto (src-billetto in src/lib/data/sources.ts) —
 * built from the Phase 1 diagnosis (2026-08-20, Electronic CPH ingestion
 * task): a real, live GitHub Actions run against the documented public
 * endpoint confirmed the schema, the working Copenhagen filter, the
 * electronic-subcategory taxonomy, and found real overlaps with existing
 * Hangaren/Poolen events.
 *
 * API: GET https://billetto.dk/api/v3/public/events, authenticated via an
 * `Api-Keypair: <ACCESS_KEY_ID>:<ACCESS_KEY_SECRET>` header (never logged —
 * see buildApiKeypairHeader). Cursor pagination: `limit` (max 100) and
 * `after=<last event id>`, looped until a page returns fewer than `limit`
 * events (the natural end) or MAX_PAGES is hit (loop protection against a
 * misbehaving/looping API — Phase 1's full nationwide category=music sample
 * was 337 events across 4 pages, so this cap is generous headroom, not a
 * real-world ceiling).
 *
 * GEOGRAPHIC SCOPE: `subregion=Byen København` is the API's own broad
 * Copenhagen-area filter, used server-side to keep the fetched page count
 * down — but it is NOT municipality-precise (Billetto location-gate audit,
 * 2026-08-31: a real live record — "Mendelssohn Paulus" at Store Magleby
 * Kirke, postal_code 2791 — carries subregion="Byen København" despite
 * Dragør being its own municipality, entirely outside Copenhagen +
 * Frederiksberg). Every candidate is therefore independently re-checked
 * client-side in isCopenhagenLocation() before being emitted, so an
 * organiser being Copenhagen-AREA-based (not Copenhagen-municipality-based),
 * or an API filtering quirk, can never smuggle an out-of-scope event in. A
 * missing/malformed location is rejected, never assumed to be in scope.
 *
 * That same audit found the reverse failure mode too: isCopenhagenLocation's
 * city-prefix check alone silently drops a genuinely in-scope event whenever
 * Billetto's own `location.city` field carries a Copenhagen DISTRICT name
 * (e.g. "Nørrebro") instead of "København" — real live example: "Det
 * berlinske darkwave-fænomen NNHMN har sin debut i København" at RUST
 * (already a registered, trusted Copenhagen venue), city="Nørrebro". A
 * hand-maintained list of district names would need endless upkeep as new
 * ones appear, so isCopenhagenLocation now also accepts a second, narrower,
 * evidence-backed signal: the event's own `postal_code` checked against
 * isInScopeBillettoPostalCode() — a fixed, deterministic PRODUCT-GEOGRAPHY
 * definition of "København + Frederiksberg municipality", not a whitelist of
 * postal codes merely observed in Billetto's data so far (an earlier version
 * of this fix used exactly such an observed-only whitelist and was corrected
 * during merge review, 2026-08-31 follow-up audit, precisely because a
 * whitelist limited to already-seen codes would silently create a NEW class
 * of false negative for any real, valid København/Frederiksberg postal code
 * that simply had not appeared in the sample yet).
 *
 * The structural fact this range check relies on: Danish postal codes are
 * assigned per municipality, and København + Frederiksberg exclusively
 * occupy the ENTIRE 1000-1999 block (no other Danish municipality has any
 * code in that range) plus a fixed, small, discrete set of specific
 * 2000-series codes for København's outer districts (2100 Ø, 2150 Nordhavn,
 * 2200 N, 2300 S, 2400 NV, 2450 SV, 2500 Valby, 2700 Brønshøj, 2720 Vanløse)
 * and Frederiksberg itself (2000). Deliberately NOT a crude, wide numeric
 * range like "1000-2999": every neighbouring municipality (Rødovre 2610,
 * Hvidovre 2650, Tårnby/Kastrup 2770, Dragør 2791, Gentofte 2820/2900, etc.)
 * sits inside such a naive range, which is exactly the over-admission this
 * audit was warned against. This exact range/set combination was verified
 * (2026-08-31 follow-up audit) against every one of the 138 real, current,
 * live music-category Billetto records with known-correct classifications
 * (from their own `city` field): it reproduced all 137 already-correct
 * verdicts with zero discrepancies, correctly flipped the one true false
 * negative (NNHMN@RUST), and correctly kept the one known true negative
 * (Dragør, postal 2791) excluded. Live authoritative postal-registry sources
 * (e.g. PostNord, Danish Wikipedia) were unreachable from this sandbox to
 * cross-verify independently — this range is asserted from well-established,
 * stable, public Danish postal geography (unchanged since Denmark's 1967
 * four-digit postal system) rather than a live external fetch; a future pass
 * with working egress to an authoritative source should re-confirm it.
 *
 * ELECTRONIC CLASSIFICATION: only categorization.subcategory values Phase 1
 * confirmed are unambiguously electronic (techno, house, electro,
 * edm_electronic, trance) are trusted as official-source-metadata (highest
 * tier, high confidence) — see BILLETTO_ELECTRONIC_SUBCATEGORY_GENRE.
 * Billetto's own "hardcore" subcategory is deliberately EXCLUDED: Phase 1's
 * live sample caught a real hardcore-PUNK show tagged that way ("KÆMPE
 * MOSHPIT VOL. 11" @ UnderWerket) — trusting it blindly would have
 * misclassified a non-electronic event. "disco" is excluded for the same
 * reason (funk/retro framing is common under that tag). Anything not in the
 * trusted set falls through to the same official-description-tier
 * deterministic text evidence every other adapter already uses
 * (deterministicGenreFromText over title+description), and from there to
 * the shared pipeline's own medium-confidence fallback and Discogs lineup
 * enrichment (src/db/sync.ts) — never a guess dressed up as evidence.
 */

export const BILLETTO_SOURCE_ID = "src-billetto";
export const BILLETTO_API_URL = "https://billetto.dk/api/v3/public/events";
const BILLETTO_PAGE_LIMIT = 100;
const BILLETTO_SUBREGION_FILTER = "Byen København";
const MAX_PAGES = 25; // loop protection — see header comment

/**
 * Only these Billetto subcategories are trusted as unambiguous, deterministic
 * electronic-music evidence (Phase 1 diagnosis, live-verified). Deliberately
 * excludes "hardcore" (real hardcore-punk false positive found live) and
 * "disco" (ambiguous funk/retro framing) — see the module doc comment.
 */
const BILLETTO_ELECTRONIC_SUBCATEGORY_GENRE: Partial<Record<string, GenreSlug>> = {
  techno: "techno",
  house: "house",
  electro: "electro",
  trance: "trance",
  // Broad/generic — Billetto's own catch-all tag for electronic dance music
  // that doesn't declare a specific subgenre; mapped to the equally generic
  // electronic-other rather than guessing a specific one.
  edm_electronic: "electronic-other",
};

export interface BillettoHeadliner {
  name: string;
}

export interface BillettoLocation {
  location_name: string | null;
  address_line: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  country_code: string | null;
  region: string | null;
  subregion: string | null;
}

export interface BillettoCategorization {
  category: string | null;
  subcategory: string | null;
  type: string | null;
}

export interface BillettoEvent {
  id: string;
  object?: string;
  kind?: string;
  state: string | null;
  title: string;
  description: string | null;
  url: string;
  branded_url?: string;
  image_link: string | null;
  availability: boolean | null;
  organiser: { id: number; name: string } | null;
  minimum_price: { amount_in_cents: number; currency: string } | null;
  categorization: BillettoCategorization | null;
  location: BillettoLocation | null;
  startdate: string | null;
  enddate: string | null;
  headliners?: { data: BillettoHeadliner[] } | null;
}

interface BillettoEventsResponse {
  data: BillettoEvent[];
}

/**
 * Builds the Api-Keypair header value. Pure/exported so header construction
 * is independently testable without a network call and without ever
 * printing the result — callers must not log it.
 */
export function buildApiKeypairHeader(accessKeyId: string, accessKeySecret: string): string {
  return `${accessKeyId}:${accessKeySecret}`;
}

/**
 * Discrete København-outer-district + Frederiksberg codes outside the
 * 1000-1999 block — see the module doc comment for the full structural
 * rationale and verification basis. Deliberately a small, named, stable set
 * (these eleven codes have been fixed since Denmark's 1967 postal system),
 * not derived from — and not limited to — any particular venue or event
 * data this project happens to have observed.
 */
const BILLETTO_OUTER_DISTRICT_POSTAL_CODES = new Set([
  "2000", // Frederiksberg
  "2100", // København Ø
  "2150", // København - Nordhavn
  "2200", // København N
  "2300", // København S
  "2400", // København NV
  "2450", // København SV
  "2500", // Valby
  "2700", // Brønshøj
  "2720", // Vanløse
]);

/**
 * True for any postal code structurally inside København or Frederiksberg
 * municipality — the entire 1000-1999 block (exclusive to these two
 * municipalities in the Danish postal system; no other municipality has any
 * code in this range) plus the fixed discrete outer-district set above.
 * Everything else (Rødovre 2610, Hvidovre 2650, Tårnby/Kastrup 2770, Dragør
 * 2791, Gentofte 2820/2900, and all codes >= 2800 generally) is correctly
 * excluded. See the module doc comment for verification basis.
 */
function isInScopeBillettoPostalCode(postalCode: string): boolean {
  const trimmed = postalCode.trim();
  if (!/^\d{4}$/.test(trimmed)) return false;
  const code = Number(trimmed);
  if (code >= 1000 && code <= 1999) return true;
  return BILLETTO_OUTER_DISTRICT_POSTAL_CODES.has(trimmed);
}

/**
 * Conservative Copenhagen scope check, independent of (and applied on top
 * of) the API's own subregion filter — see the module doc comment. A
 * missing/blank city is rejected, never assumed in-scope. Tolerant of the
 * postal-suffix variants Phase 1 observed live ("København K", "København
 * S", trailing space/period, etc.) via a prefix match, but never matches on
 * substring alone (e.g. would not match "Nørrebro" or an address merely
 * containing "København" elsewhere) — that gap is deliberately covered by
 * the SEPARATE, narrower `postalCode` signal instead (Billetto location-gate
 * audit, 2026-08-31), not by loosening the city text match itself: a
 * district-name substring match would be far more prone to real false
 * positives (an address merely mentioning a neighbourhood in passing) than
 * a structural postal-code check against isInScopeBillettoPostalCode().
 * `postalCode` is optional so every existing call site/behavior without it
 * is completely unchanged.
 */
export function isCopenhagenLocation(city: string | null | undefined, postalCode?: string | null): boolean {
  if (postalCode && isInScopeBillettoPostalCode(postalCode)) return true;
  if (!city) return false;
  const normalized = city.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return normalized.startsWith("københavn") || normalized.startsWith("frederiksberg");
}

/**
 * Deterministic genre evidence from Billetto's own explicit categorization,
 * evidence-hierarchy tier A (official-source-metadata, highest). Returns
 * null for anything outside the trusted subcategory set — including
 * "hardcore" and "disco" — so the caller falls through to text evidence.
 */
export function genreFromBillettoCategorization(categorization: BillettoCategorization | null): GenreSlug | null {
  if (!categorization) return null;
  if (categorization.category !== "music") return null;
  if (!categorization.subcategory) return null;
  return BILLETTO_ELECTRONIC_SUBCATEGORY_GENRE[categorization.subcategory] ?? null;
}

function isPubliclyAvailable(event: BillettoEvent): boolean {
  // Billetto's own explicit publish state is the primary signal — "draft"
  // (or any other unrecognized non-published, non-cancelled state) is not a
  // real public listing and must never be ingested. "cancelled" is
  // deliberately NOT excluded here (event lifecycle/status handling,
  // 2026-08-28): an already-known event that Billetto explicitly marks
  // cancelled must still flow through so mapBillettoEvent can propagate that
  // as cancelledHint, rather than silently vanishing from sync output — see
  // Section 2B ("cancelled" must never be treated as disappearance/deletion)
  // and mapBillettoEvent's own cancelledHint mapping below.
  // `availability` never gates inclusion either way — its real meaning is
  // unconfirmed (re-audited 2026-08-28, see mapBillettoEvent's soldOutHint
  // comment below), but a `false` value plainly does not mean "gone": the
  // event is still `state: "published"` and worth discovering regardless.
  if (event.state != null && event.state !== "published" && event.state !== "cancelled") return false;
  return true;
}

function mapHeadliners(headliners: BillettoEvent["headliners"]): string[] {
  if (!headliners?.data) return [];
  return headliners.data.map((h) => h.name?.trim()).filter((name): name is string => Boolean(name));
}

/**
 * Billetto's `minimum_price.amount_in_cents` field is misleadingly named —
 * live samples confirm it is already whole DKK, not minor-unit cents/øre
 * (e.g. a real touring-artist show priced at 425 = 425 DKK, not 4.25 DKK;
 * a nominal community-night ticket at 50 = 50 DKK, not 0.50 DKK). Trusting
 * the observed real data over the field's name.
 */
function mapPriceFrom(minimumPrice: BillettoEvent["minimum_price"]): number | null {
  if (!minimumPrice) return null;
  if (minimumPrice.currency !== "DKK") return null;
  return minimumPrice.amount_in_cents;
}

/**
 * Maps one Billetto event into the shared RawCandidateEvent shape. Throws
 * on genuinely missing essentials (title, date, location) — callers skip a
 * single failure and continue, matching every other adapter's per-record
 * contract. Returns null (not a throw) for a well-formed event that is
 * simply out of scope (not published, or not a Copenhagen location) — that
 * is an expected, common outcome, not a parse failure.
 */
export function mapBillettoEvent(event: BillettoEvent): RawCandidateEvent | null {
  if (!isPubliclyAvailable(event)) return null;
  if (!isCopenhagenLocation(event.location?.city, event.location?.postal_code)) return null;

  const title = event.title?.trim();
  if (!title) throw new Error(`Billetto event ${event.id} has no title`);
  if (!event.startdate) throw new Error(`Billetto event ${event.id} has no start date`);

  const description = event.description?.trim() || null;
  const artists = mapHeadliners(event.headliners);

  const categoryGenre = genreFromBillettoCategorization(event.categorization);
  let genreHint: GenreSlug | null = categoryGenre;
  let genreConfidenceHint = categoryGenre ? genreConfidenceForEvidence("official-source-metadata") : null;
  if (!genreHint) {
    const textGenre = deterministicGenreFromText(`${title} ${description ?? ""}`);
    if (textGenre) {
      genreHint = textGenre;
      // Billetto gave its own categorization for this event but it did NOT
      // resolve to a trusted electronic subcategory (genre false-positive
      // audit, 2026-08-25) — that is real evidence Billetto itself did not
      // classify the event as electronic, so a bare keyword match from the
      // generic text fallback is only as trustworthy as it is everywhere
      // else in this codebase (deterministic-mapping tier, medium — see
      // pipeline.ts's own identically-tiered use of the same function), not
      // an explicit high-confidence assertion by the source. Without this,
      // a single incidental word match (KEYWORD_MAP's bare "house"/"psy"/
      // "electro" entries) auto-publishes: real Production false positives
      // this fixes — "ECSTATIC DANCE by Range of Motion" (categorization
      // health_wellness/personal_health, matched "house" in "...out of the
      // house"), "ILK x KU.BE no. 6: Kresten Osgood Kvintet" (music/
      // blues_jazz, matched "house" in "publishing house"), "Dansk
      // Danseteaters Summer Dance 2026" (performing_arts/dance, matched
      // "house" in "the Opera House"). Deliberately does NOT downgrade when
      // Billetto gave no categorization at all — that's a different,
      // unobserved-live scenario every other adapter already treats as
      // official-description by default.
      const categorizationPresentButUntrusted =
        event.categorization?.category != null && event.categorization?.subcategory != null;
      genreConfidenceHint = genreConfidenceForEvidence(
        categorizationPresentButUntrusted ? "deterministic-mapping" : "official-description",
      );
    }
  }

  return {
    sourceId: BILLETTO_SOURCE_ID,
    sourceUrl: BILLETTO_API_URL,
    title,
    description,
    artists,
    startDatetime: event.startdate,
    endDatetime: event.enddate ?? null,
    venueName: event.location?.location_name?.trim() || null,
    // Billetto's own event page is simultaneously the official record and
    // the ticket purchase point for this source — both fields point at the
    // same real URL rather than inventing a distinction that doesn't exist.
    officialEventUrl: event.url,
    ticketUrl: event.url,
    facebookUrl: null,
    residentAdvisorUrl: null,
    imageUrl: event.image_link ?? null,
    priceFrom: mapPriceFrom(event.minimum_price),
    genreHint,
    genreConfidenceHint,
    // `state` is Billetto's own explicit, reliable, always-checked publish
    // status (event lifecycle/status handling, 2026-08-28) — "cancelled" is
    // a genuine structured signal, not an inference, and a null/unset state
    // (rare — most real records carry one) correctly yields "unknown" rather
    // than a false negative.
    cancelledHint: event.state == null ? null : event.state === "cancelled",
    // `availability` is deliberately NOT mapped to soldOutHint (re-audited
    // 2026-08-28): Billetto's own documentation gives no confirmed meaning
    // for this field beyond a hedge in the Phase 1 diagnosis notes
    // (sources.ts's integrationNote), and the only real example captured —
    // a free, reservation-based event (danskDanseteater, __fixtures__/
    // billetto-events.json) — is genuinely ambiguous: `availability: false`
    // there could mean sold-out reservations, a closed booking window, an
    // already-passed date-instance within a multi-day listing, or something
    // else entirely — not confirmed to specifically mean SOLD OUT. A fresh
    // live 100-event authenticated sample (2026-08-28, subregion=Byen
    // København) found zero further false-availability examples to
    // corroborate either way. Billetto exposes no other, more specific
    // ticket-status field. Per the product rule that a false-positive SOLD
    // OUT label is worse than a missing one: soldOutHint stays null
    // (unknown) for every Billetto event until a source-confirmed meaning
    // for `availability` is found.
    soldOutHint: null,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(
  fetchImpl: typeof fetch,
  accessKeyId: string,
  accessKeySecret: string,
  after: string | null,
  retryDelayMs: number,
): Promise<BillettoEventsResponse> {
  const params = new URLSearchParams({
    limit: String(BILLETTO_PAGE_LIMIT),
    subregion: BILLETTO_SUBREGION_FILTER,
  });
  if (after) params.set("after", after);
  const url = `${BILLETTO_API_URL}?${params.toString()}`;

  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        signal: AbortSignal.timeout(20_000),
        headers: {
          "Api-Keypair": buildApiKeypairHeader(accessKeyId, accessKeySecret),
          accept: "application/json",
          "user-agent": "NattefrekvensBot/1.0 (+https://nattefrekvens.dk/about; first-party sync)",
        },
      });
    } catch (err) {
      lastError = `Billetto API fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      if (attempt === 1) {
        await delay(retryDelayMs);
        continue;
      }
      throw new Error(`${lastError} (after retry)`);
    }

    if (res.ok) return (await res.json()) as BillettoEventsResponse;

    // 401/403 (bad or revoked credentials) will never succeed on retry —
    // fail fast with a clear, credential-value-free message. Only a 5xx is
    // worth one retry, matching every other adapter's courtesy retry.
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Billetto API rejected the configured credentials (HTTP ${res.status}).`);
    }
    lastError = `Billetto API responded with HTTP ${res.status}`;
    if (res.status < 500) throw new Error(lastError);
    if (attempt === 1) {
      await delay(retryDelayMs);
      continue;
    }
  }
  throw new Error(`${lastError} (after retry)`);
}

/**
 * Fetches every current Copenhagen event page-by-page (cursor pagination:
 * `after=<last id>`, capped at MAX_PAGES for loop protection), maps each to
 * RawCandidateEvent, and skips — never throws for — a single malformed
 * record or an out-of-scope/unpublished one. A credential or network
 * failure on the FIRST page is a genuine source failure (thrown, surfaces
 * as the sync's "failed" outcome); a failure on a LATER page stops
 * pagination but still returns everything gathered so far, rather than
 * discarding a partially-successful fetch.
 */
export function createBillettoAdapter(fetchImpl: typeof fetch = fetch, retryDelayMs = 2_000): SourceAdapter {
  // Tracks whether the most recent fetchCandidates() call gathered every
  // page, or bailed out early on a later-page failure (see the `break`
  // below) — see SourceAdapter.lastFetchWasComplete's own doc comment for
  // why this matters. Starts true; only the partial-failure path below ever
  // sets it false. A fresh fetchCandidates() call always resets it first.
  let lastFetchComplete = true;

  return {
    sourceId: BILLETTO_SOURCE_ID,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      lastFetchComplete = true;
      const accessKeyId = process.env.BILLETTO_ACCESS_KEY_ID;
      const accessKeySecret = process.env.BILLETTO_ACCESS_KEY_SECRET;
      if (!accessKeyId || !accessKeySecret) {
        throw new Error("BILLETTO_ACCESS_KEY_ID / BILLETTO_ACCESS_KEY_SECRET are not configured.");
      }

      const results: RawCandidateEvent[] = [];
      let after: string | null = null;
      let previousAfter: string | null = null;

      for (let page = 1; page <= MAX_PAGES; page++) {
        let response: BillettoEventsResponse;
        try {
          response = await fetchPage(fetchImpl, accessKeyId, accessKeySecret, after, retryDelayMs);
        } catch (err) {
          if (page === 1) throw err; // first-page failure is a genuine source failure
          console.error(`[billetto-adapter] page ${page} failed, returning ${results.length} candidate(s) gathered so far: ${err instanceof Error ? err.message : String(err)}`);
          lastFetchComplete = false;
          break;
        }

        const events = response.data ?? [];
        for (const event of events) {
          try {
            const mapped = mapBillettoEvent(event);
            if (mapped) results.push(mapped);
          } catch (err) {
            console.error(`[billetto-adapter] skipping malformed event ${event?.id ?? "(unknown id)"}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        if (events.length < BILLETTO_PAGE_LIMIT) break; // last page

        const lastId = events[events.length - 1]?.id ?? null;
        if (!lastId || lastId === previousAfter) break; // no cursor to advance, or the API stopped advancing — avoid an infinite loop
        previousAfter = after;
        after = lastId;
      }

      return results;
    },
    lastFetchWasComplete(): boolean {
      return lastFetchComplete;
    },
  };
}
