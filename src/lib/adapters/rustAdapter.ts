import { copenhagenWallClockToUtc, type DateKey } from "../datetime";
import { genreConfidenceForEvidence } from "../classification";
import { deterministicGenreFromText } from "./deterministicGenreMapping";
import { decodeHtmlEntities, htmlToText, isLikelyDanish, truncateAtBoundary } from "./htmlExtraction";
import type { RawCandidateEvent, SourceAdapter } from "./types";

/**
 * Real first-party adapter for RUST (src-rust in src/lib/data/sources.ts), a
 * three-floor Nørrebro venue running a concert stage alongside weekend club
 * floors (source-expansion work package, 2026-08-30).
 *
 * Technical discovery (real, live audit): rust.dk/robots.txt disallows only
 * /wp-admin/ (not the homepage or anything under it). There is no dedicated
 * /program/ or /events listing page — that path 404s. Instead the homepage
 * itself (https://rust.dk/) IS the live events listing: a fully
 * server-rendered feed of `<article itemtype="https://schema.org/MusicEvent">`
 * blocks (schema.org MusicEvent microdata — title, startDate, doorTime,
 * performer, venue, ticket offer, and a first-party event-specific
 * description), with no JS execution required to fetch real content. This
 * adapter therefore fetches only the homepage, never a separate detail page.
 *
 * RUST is deliberately NOT a trusted-electronic source (unlike Hangaren/
 * Culture Box) — it runs concerts, hip-hop nights, salsa ("conga") and other
 * non-electronic programming alongside its house/techno nights (real
 * evidence: the generic recurring "RUST Natklub" Friday/Saturday slot is
 * itself branded "Nørrebro's hip hop nightclub" in its own copy; "SheFunk" is
 * a funk concert). Every candidate goes through the normal genre/relevance
 * pipeline exactly like Pumpehuset — no source-level auto-publish trust, and
 * no changes to relevance.ts/pipeline.ts were needed or made for this source.
 */

export const RUST_SOURCE_ID = "src-rust";
export const RUST_BASE_URL = "https://rust.dk";
const RUST_VENUE_NAME = "RUST";

// Deliberately NOT `<article\b[^>]*itemtype="..."[^>]*>` — real evidence:
// every article's OPENING tag carries Alpine.js attributes first
// (`@click="open=true; $nextTick( () => ... )"`), and that arrow function's
// own literal `=>` contains a `>` character, which would prematurely end a
// `[^>]*` match partway through the opening tag, well before reaching the
// real `itemtype` attribute. Splitting on `<article` / `</article>` instead
// sidesteps that entirely — confirmed live against a real captured page.
const ARTICLE_BLOCK_RE = /<article\b[\s\S]*?<\/article>/g;
const MUSIC_EVENT_MARKER = 'itemtype="https://schema.org/MusicEvent"';

/** "20260828" / "20260828 20:00" -> { date, hour, minute } (hour/minute null when no time is embedded in startDate). */
function parseStartDateMeta(content: string): { date: DateKey; hour: number | null; minute: number | null } | null {
  const m = content.trim().match(/^(\d{4})(\d{2})(\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const date: DateKey = { year: Number(y), month: Number(mo), day: Number(d) };
  if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) return null;
  return { date, hour: h ? Number(h) : null, minute: h ? Number(mi) : null };
}

/** "19:00" / "23:00" -> { hour, minute }, or null when unparseable. */
function parseDoorTimeMeta(content: string): { hour: number; minute: number } | null {
  const m = content.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * The event's own start instant: an explicit concert-start time embedded in
 * `startDate` (e.g. concerts, where doors and start differ) takes priority
 * over `doorTime` — matching the page's own "Døre: 19:00 / Koncertstart:
 * 20:00" copy, where the concert start (not the door time) is the event's
 * real start. For club nights with no separate concert-start time, doors
 * opening IS the event start, same as every other venue adapter's own
 * door-time convention.
 */
function resolveStartInstant(startDateMeta: string, doorTimeMeta: string | null): string | null {
  const parsedStart = parseStartDateMeta(startDateMeta);
  if (!parsedStart) return null;
  if (parsedStart.hour != null && parsedStart.minute != null) {
    return copenhagenWallClockToUtc(parsedStart.date, parsedStart.hour, parsedStart.minute).toISOString();
  }
  const door = doorTimeMeta ? parseDoorTimeMeta(doorTimeMeta) : null;
  if (!door) return null; // no reliable time evidence at all — never guessed
  return copenhagenWallClockToUtc(parsedStart.date, door.hour, door.minute).toISOString();
}

function metaContent(block: string, itemprop: string): string | null {
  const m = block.match(new RegExp(`<meta itemprop="${itemprop}" content="([^"]*)"`));
  return m ? m[1] : null;
}

export function parseRustEventsHtml(html: string, sourceUrl = `${RUST_BASE_URL}/`): RawCandidateEvent[] {
  const blocks = (html.match(ARTICLE_BLOCK_RE) ?? []).filter((b) => b.includes(MUSIC_EVENT_MARKER));
  const results: RawCandidateEvent[] = [];

  for (const block of blocks) {
    try {
      const titleMatch = block.match(/<h2 class="event-title" itemprop="name">\s*([^<]*?)\s*<\/h2>/);
      if (!titleMatch) continue; // malformed block — skip, never take down the whole sync
      const title = decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim();
      if (!title) continue;

      const startDateMeta = metaContent(block, "startDate");
      if (!startDateMeta) continue;
      const doorTimeMeta = metaContent(block, "doorTime");
      const startDatetime = resolveStartInstant(startDateMeta, doorTimeMeta);
      if (!startDatetime) continue; // no title/date/time evidence — real per-adapter contract, skip and continue

      // Stable per-event identity: the homepage's own feed never links out to
      // a separate detail-page URL (confirmed live — no rust.dk/event/...
      // hrefs anywhere in the listing markup, only Ticketmaster/Facebook
      // links), but each article carries its own real WordPress post ID
      // (class="event post-6793 ..."), which is what the page's own
      // in-page toggle anchors against. Used as a stable #event-<id> anchor
      // on the homepage itself — a real, source-derived identity, not
      // invented, and stable across syncs since post IDs don't change.
      const postIdMatch = block.match(/\bevent post-(\d+)\b/);
      const officialEventUrl = postIdMatch ? `${RUST_BASE_URL}/#event-${postIdMatch[1]}` : sourceUrl;

      const descMatch = block.match(/<div class="event-description" itemprop="description">([\s\S]*?)<\/div>/);
      const fullDescriptionText = descMatch ? htmlToText(descMatch[1]).replace(/\n+/g, " ").trim() : "";

      // relevanceText always keeps the full original text regardless of the
      // Danish-language display guard below — same reasoning as Pumpehuset/
      // Poolen (see RawCandidateEvent.relevanceText's doc comment): a
      // negative-relevance signal in a Danish-only bio must never be lost to
      // the shared pipeline's genre/relevance check just because it isn't
      // shown publicly.
      const relevanceText = `${title} ${fullDescriptionText}`.trim();
      const description =
        fullDescriptionText && !isLikelyDanish(fullDescriptionText) ? truncateAtBoundary(fullDescriptionText, 600) : null;

      const genreHint = fullDescriptionText ? deterministicGenreFromText(relevanceText) : null;

      const ticketMatch = block.match(/<a class="event-ticket-link[^"]*" href="([^"]+)"/);
      const fbMatch = block.match(/<a class="fb-event" href="([^"]+)"/);

      results.push({
        sourceId: RUST_SOURCE_ID,
        sourceUrl,
        title,
        description,
        relevanceText,
        artists: [title],
        startDatetime,
        endDatetime: null, // never stated on this site — left null, matching Hangaren's own convention
        venueName: RUST_VENUE_NAME,
        officialEventUrl,
        ticketUrl: ticketMatch ? ticketMatch[1] : null,
        facebookUrl: fbMatch ? fbMatch[1] : null,
        residentAdvisorUrl: null,
        imageUrl: null,
        priceFrom: null,
        genreHint,
        genreConfidenceHint: genreHint ? genreConfidenceForEvidence("official-description") : null,
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

async function fetchOnce(fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(`${RUST_BASE_URL}/`, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      "user-agent": "NattefrekvensBot/1.0 (+https://nattefrekvens.dk/about; first-party sync)",
      accept: "text/html",
    },
  });
}

/**
 * Real HTTP fetch against the plain homepage (never a JSON/AJAX endpoint —
 * none is documented, and none was needed: the homepage's own server-rendered
 * microdata is already sufficient). Retries once after a short delay on a
 * transient failure, same contract as every other first-party adapter.
 */
export function createRustAdapter(fetchImpl: typeof fetch = fetch, retryDelayMs = 2_000): SourceAdapter {
  return {
    sourceId: RUST_SOURCE_ID,
    async fetchCandidates(): Promise<RawCandidateEvent[]> {
      let lastError: string | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await fetchOnce(fetchImpl);
          if (res.ok) {
            const html = await res.text();
            return parseRustEventsHtml(html, `${RUST_BASE_URL}/`);
          }
          lastError = `RUST responded with HTTP ${res.status}`;
          if (res.status < 500) break; // a 4xx won't fix itself on retry
        } catch (err) {
          lastError = `RUST fetch failed: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (attempt === 1) {
          console.error(`[rust-adapter] attempt 1 failed (${lastError}), retrying once in ${retryDelayMs}ms`);
          await delay(retryDelayMs);
        }
      }
      throw new Error(`${lastError} (after retry)`);
    },
  };
}
