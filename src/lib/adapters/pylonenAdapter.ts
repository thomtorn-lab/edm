import { copenhagenWallClockToUtc, type DateKey } from "../datetime";
import { genreConfidenceForEvidence } from "../classification";
import { deterministicGenreFromText } from "./deterministicGenreMapping";
import { decodeHtmlEntities, isSameHost } from "./htmlExtraction";
import type { RawCandidateEvent, SourceAdapter } from "./types";

/**
 * Discovery-only first-party adapter for Pylonen (src-pylonen in
 * src/lib/data/sources.ts) — Pylonen source-gap audit, 2026-09-13.
 *
 * WHY DISCOVERY-ONLY: pylonen.horse is a genuine first-party venue site
 * (WordPress, robots.txt fully permissive, server-rendered, no JS execution
 * needed) but its programme is NOT structured data — `wp-json/wp/v2/types`
 * confirms no custom "event" post type exists, `wp-sitemap.xml` lists only
 * posts/pages/categories/users (no events sitemap), and neither the
 * homepage nor a real event page carries any JSON-LD/schema.org Event
 * markup. The entire upcoming programme is a plain `<ol>` embedded directly
 * in the homepage, and only a minority of items ever get their own real
 * page (`/wp-json/wp/v2/types` + a live sample confirmed 1 of 24 items had
 * one at audit time) — the rest are bare `<li><div>...<time>...<strong>
 * TITLE</strong></div></li>` entries with no URL, no description, no
 * genre/artist evidence at all. Electronic relevance genuinely cannot be
 * determined from a bare title alone for most of these (see the audit's own
 * classification: DJ DOPAMINA X NORA ASTEROID is obviously electronic;
 * "Frizone Fredag" or "Threshold" are not determinable from the title).
 * `autoPublish: false` (enforced in src/db/sync.ts, same gate every other
 * discovery-only source uses) means every candidate here can only ever
 * create/refresh a Discovery Queue row for a human to review — never a
 * published event, regardless of what the shared pipeline would otherwise
 * decide.
 *
 * IDENTITY (no stable per-event id for most items): every other first-party
 * adapter uses the source's own real per-event URL as both `sourceUrl` and
 * the pipeline/sync dedup key (`raw.officialEventUrl ?? raw.sourceUrl`,
 * src/db/sync.ts). Pylonen mostly has no such URL, so — uniquely among the
 * first-party adapters — `sourceUrl` here is a SYNTHETIC, deterministic
 * identity: `${PYLONEN_BASE_URL}/#pylonen-<local-date>-<slugified-title>`.
 * It is a real, clickable, same-origin URL (a bare `#fragment` simply loads
 * the live homepage, which is exactly the right "go verify this" target for
 * an admin reviewing the Discovery Queue row) — never a fabricated
 * officialEventUrl. Deliberately keyed on the LOCAL DATE only, not time:
 * most list items carry no explicit time at all (see parseProgrammeItem's
 * own comment), and a bare date item can legitimately gain a specific time
 * between syncs as its date approaches — keying identity to date+title
 * keeps that transition from looking like a different event and spawning a
 * duplicate Discovery Queue row. Two distinct items with the same title on
 * different dates (Pylonen's own recurring "Summer isn't over yet" day
 * party runs three times in the current programme) correctly get three
 * distinct identities.
 *
 * IDENTITY STABILITY ACROSS THE BARE -> DETAIL-PAGE LIFECYCLE (Pylonen DQ
 * identity stabilization, 2026-09-13 — supersedes an earlier documented
 * limitation here): a bare item genuinely can gain its own real event page
 * between syncs, and Pylonen's own publishing model makes this a routine,
 * expected transition rather than a rare edge case. Every candidate below
 * sets `stableSourceUrl: true` (see RawCandidateEvent.stableSourceUrl's own
 * doc comment) specifically so src/db/sync.ts's dedup key formula keeps
 * trusting THIS synthetic `sourceUrl` as identity even once a real
 * `officialEventUrl` appears — the same real-world event's Discovery Queue
 * row never re-keys, never orphans, and never spawns a duplicate. The real
 * URL is not lost: it still reaches the row as admin-visible "Official
 * Event" metadata (discoveryQueue.probableOfficialEventUrl) via a dedicated
 * self-heal in src/lib/sync.ts's buildDiscoveryQueueClassificationPatch,
 * exactly once it's first seen, and stays protected by that row's own
 * overriddenFields like every other admin-editable field.
 *
 * LINK ROLES: an item's own real detail page (`<a href>` in the programme
 * list, same-host-checked) becomes `officialEventUrl` — a genuine first-
 * party record, exactly like Hangaren/Pumpehuset/Poolen (src/lib/links.ts's
 * classifySourceRole renders "Official event" for `official-venue` sources
 * — moot here anyway since autoPublish:false means these never reach a
 * public page, but the field is still populated correctly for whenever an
 * admin manually publishes one). The homepage/programme page itself is
 * NEVER set as officialEventUrl for an item with no page of its own — it is
 * only ever the fetch origin (and, via the synthetic sourceUrl above,
 * provenance an admin can click through to the live programme).
 *
 * TICKET URL / DESCRIPTION / GENRE: never invented. A bare list item (no
 * detail page) gets `ticketUrl: null`, `description: null`, `genreHint:
 * null` — the shared pipeline's own title-keyword fallback
 * (deterministicGenreFromText, "deterministic-mapping" tier) still runs on
 * the title exactly as it does for every other source's candidates; this
 * adapter adds no extra title-only inference on top of that shared,
 * already-conservative behavior. When a real detail page exists, its own
 * `<meta name="description">` (first-party editorial text, "official-
 * description" evidence tier — same tier hangarenAdapter.ts credits its own
 * bio text with) is used for description/genre evidence, and a genuine RA/
 * Billetto ticket link found on that page (same extraction precedent as
 * hangarenAdapter.ts) becomes `ticketUrl`. A detail-page fetch failure
 * leaves description/genre/ticket null rather than blocking the candidate —
 * the list item itself (title/date/officialEventUrl) is still queued.
 *
 * CANCELLATION: unsupported. Pylonen's markup carries no cancelled/
 * postponed signal of any kind, so `cancelledHint`/`soldOutHint` are never
 * set (omitted, matching RawCandidateEvent's own documented default for
 * every source with no such signal) and `cancellationPolicy: "none"` in the
 * registry means src/db/sync.ts's cancellation-safety gate never acts on
 * this source at all — an item silently disappearing from the homepage is
 * never treated as a cancellation signal, per explicit product instruction.
 *
 * TIME PARSING (Europe/Copenhagen): every `<time datetime="…">` on the
 * page carries a `+00:00` suffix that is NOT real UTC — it is the
 * Copenhagen wall-clock number with a hardcoded, incorrect offset (verified
 * against two real items straddling the DST boundary: a September item
 * states "22:00" both in its visible label and in `datetime`, and a
 * December item states "20:00" in both — if the offset were genuine UTC,
 * CEST vs CET would shift the visible-label time by an hour relative to the
 * `datetime` value in at least one of those two cases; it never does).
 * parseProgrammeItem therefore extracts only the raw Y-M-D/H:M digits from
 * the attribute and feeds them to copenhagenWallClockToUtc — never trusts
 * the attribute's own offset. A bare-date item (no time shown in the
 * visible label, e.g. "Sun 13 Sep") carries `00:00:00+00:00` as a
 * placeholder; that is treated as this item's best-known start instant
 * (00:00 Copenhagen local) rather than withheld — an admin reviewing the
 * Discovery Queue can see the date is real and the time unconfirmed from
 * the row itself, and no downstream field (this is never auto-published)
 * depends on the time being exact.
 */

export const PYLONEN_SOURCE_ID = "src-pylonen";
export const PYLONEN_BASE_URL = "https://pylonen.horse";
const PYLONEN_VENUE_NAME = "Pylonen";

/** First RA (Resident Advisor) or Billetto ticket link found on a real event page — same priority/precedent as hangarenAdapter.ts's extractTicketUrl. */
function extractTicketUrl(html: string): { ticketUrl: string | null; residentAdvisorUrl: string | null } {
  const ra = html.match(/href="(https:\/\/ra\.co\/events\/\d+[^"]*)"/i);
  if (ra) return { ticketUrl: ra[1], residentAdvisorUrl: ra[1] };
  const billetto = html.match(/href="(https:\/\/billetto\.[^"]+)"/i);
  if (billetto) return { ticketUrl: billetto[1], residentAdvisorUrl: null };
  return { ticketUrl: null, residentAdvisorUrl: null };
}

/** The real first-party event description, when the detail page provides one — never a generic site-wide description. */
function extractMetaDescription(html: string): string | null {
  const match = html.match(/<meta name="description" content="([^"]*)"\s*\/?>/i);
  if (!match) return null;
  const text = decodeHtmlEntities(match[1]).trim();
  return text || null;
}

/**
 * Deterministic slug for the synthetic identity — see this module's own
 * doc comment for why identity is title+date rather than a real event id.
 * NFKD-normalizes to fold accented/stylized characters (Mëtro -> Metro,
 * BØLLEBAS keeps its Ø since Danish/Norwegian Ø has no ASCII decomposition
 * — harmless, it still round-trips identically run to run) before
 * collapsing to lowercase ASCII-ish hyphenated text.
 */
function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9øæå]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface ParsedProgrammeItem {
  href: string | null;
  title: string;
  startDatetime: string;
  dateKey: DateKey;
}

/** Parses one `<li>…</li>` block from the programme list. Returns null for a malformed block — never throws. */
function parseProgrammeItem(block: string): ParsedProgrammeItem | null {
  const timeMatch = block.match(/<time datetime="(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}[^"]*">/);
  const titleMatch = block.match(/<strong>([^<]*)<\/strong>/);
  if (!timeMatch || !titleMatch) return null;

  const title = decodeHtmlEntities(titleMatch[1]).trim();
  if (!title) return null;

  const [, y, mo, d, h, mi] = timeMatch;
  const dateKey: DateKey = { year: Number(y), month: Number(mo), day: Number(d) };
  // See this module's own "TIME PARSING" doc comment — the attribute's own
  // offset is never trusted, only its raw digits, read as Copenhagen local.
  const startDatetime = copenhagenWallClockToUtc(dateKey, Number(h), Number(mi)).toISOString();

  const hrefMatch = block.match(/<a href="([^"]+)"/);
  const href = hrefMatch && isSameHost(hrefMatch[1], PYLONEN_BASE_URL) ? hrefMatch[1] : null;

  return { href, title, startDatetime, dateKey };
}

/**
 * Parses the full programme list out of the homepage's own HTML.
 * `fetchDetail` is injected (defaults to a real fetch) so a linked item's
 * detail-page description/ticket-link extraction is independently testable
 * without a network call, mirroring pumpehusetAdapter.ts's listing+detail
 * pattern. Scoped strictly to the `<ol class="pylonen-programme-list">`
 * block — never the whole page — so the "Submit a signal" form link or any
 * other homepage anchor can never be mistaken for a programme item.
 */
export async function parsePylonenHomepage(
  html: string,
  fetchDetail: (url: string) => Promise<string | null>,
): Promise<RawCandidateEvent[]> {
  const listMatch = html.match(/<ol class="pylonen-programme-list">([\s\S]*?)<\/ol>/);
  if (!listMatch) return [];

  const blocks = listMatch[1].match(/<li>[\s\S]*?<\/li>/g) ?? [];
  const results: RawCandidateEvent[] = [];

  for (const block of blocks) {
    try {
      const parsed = parseProgrammeItem(block);
      if (!parsed) continue;

      const dateSlug = `${parsed.dateKey.year}-${String(parsed.dateKey.month).padStart(2, "0")}-${String(parsed.dateKey.day).padStart(2, "0")}`;
      const sourceUrl = `${PYLONEN_BASE_URL}/#pylonen-${dateSlug}-${slugify(parsed.title)}`;

      let description: string | null = null;
      let genreHint: RawCandidateEvent["genreHint"] = null;
      let genreConfidenceHint: RawCandidateEvent["genreConfidenceHint"] = null;
      let ticketUrl: string | null = null;
      let residentAdvisorUrl: string | null = null;

      // Real event-level evidence, only when a real page exists — never
      // invented for a bare list item (see this module's own doc comment).
      if (parsed.href) {
        try {
          const detailHtml = await fetchDetail(parsed.href);
          if (detailHtml) {
            description = extractMetaDescription(detailHtml);
            if (description) {
              const relevanceText = `${parsed.title} ${description}`;
              const genre = deterministicGenreFromText(relevanceText);
              if (genre) {
                genreHint = genre;
                genreConfidenceHint = genreConfidenceForEvidence("official-description");
              }
            }
            ({ ticketUrl, residentAdvisorUrl } = extractTicketUrl(detailHtml));
          }
        } catch {
          // A single detail-page fetch failure must never drop the list
          // item itself — it's still queued with title/date/officialEventUrl.
        }
      }

      results.push({
        sourceId: PYLONEN_SOURCE_ID,
        sourceUrl,
        title: parsed.title,
        description,
        artists: [],
        startDatetime: parsed.startDatetime,
        endDatetime: null,
        venueName: PYLONEN_VENUE_NAME,
        officialEventUrl: parsed.href,
        ticketUrl,
        facebookUrl: null,
        residentAdvisorUrl,
        imageUrl: null,
        priceFrom: null,
        genreHint,
        genreConfidenceHint,
        // See this module's own "IDENTITY STABILITY ACROSS THE BARE ->
        // DETAIL-PAGE LIFECYCLE" doc comment — this synthetic sourceUrl is
        // this candidate's stable identity even once officialEventUrl above
        // becomes non-null on a later sync.
        stableSourceUrl: true,
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

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      "user-agent": "NattefrekvensBot/1.0 (+https://nattefrekvens.dk/about; first-party sync)",
      accept: "text/html",
    },
  });
  if (!res.ok) return null;
  return res.text();
}

/**
 * Real HTTP fetch against the unrestricted homepage (robots.txt places no
 * disallow on it — only `/wp/wp-admin/`). Retries once after a short delay
 * on a transient failure, same policy as hangarenAdapter.ts. A per-item
 * detail-page fetch (fetchText, reused for both) failing never aborts the
 * whole sync — see parsePylonenHomepage's own try/catch around it.
 */
export function createPylonenAdapter(fetchImpl: typeof fetch = fetch, retryDelayMs = 2_000): SourceAdapter {
  return {
    sourceId: PYLONEN_SOURCE_ID,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      let lastError: string | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const html = await fetchText(PYLONEN_BASE_URL, fetchImpl);
          if (html) {
            return parsePylonenHomepage(html, (url) => fetchText(url, fetchImpl));
          }
          lastError = "Pylonen homepage responded with a non-OK HTTP status";
        } catch (err) {
          lastError = `Pylonen fetch failed: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (attempt === 1) {
          console.error(`[pylonen-adapter] attempt 1 failed (${lastError}), retrying once in ${retryDelayMs}ms`);
          await delay(retryDelayMs);
        }
      }
      throw new Error(`${lastError} (after retry)`);
    },
  };
}
