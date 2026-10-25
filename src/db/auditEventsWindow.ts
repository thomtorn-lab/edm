/**
 * Read-only editorial audit: every PUBLISHED event taking place in a
 * Copenhagen-local date window, with only the fields an editorial screening
 * needs, plus duplicate candidates. Backs
 * .github/workflows/audit-events-window-readonly.yml (CLI:
 * src/db/auditEventsWindowCli.ts).
 *
 * Why this exists instead of the per-source "Audit Event Forensics"
 * workflow: that one filters by canonical_source_id, so admin-pasted events
 * (canonical_source_id IS NULL — see src/app/api/admin/extract/route.ts) are
 * unreachable, and it dumps change histories and Discovery Queue rows. This
 * audit has NO source filter and selects an explicit, minimal column list —
 * never admin notes, override fields or change logs. The one exception
 * (genre QA, 2026-10-17) is two booleans saying whether an admin has
 * manually set the genre (primaryGenre/subgenres in overridden_fields).
 * They are computed in SQL, so the override list itself is never read or
 * printed. Genre suggestions must not override an editorial decision, and
 * genre_confidence is not updated when an admin edits the genre, so the
 * reviewer needs this flag. Second exception (language QA, 2026-10-25): the
 * latest withheld source description per event — a Danish Poolen/Pumpehuset
 * text the public site does not show (src/lib/withheldDescriptions.ts) —
 * read by WITHHELD_DESCRIPTIONS_SQL, which selects only that row type's
 * text and never any other change history.
 *
 * Window semantics (nightlife-aware, see src/lib/datetime.ts): for
 * from..to inclusive, the window is [from 00:00, (to + 1) 06:00) Copenhagen
 * local time, so the last night's after-midnight starts are included. Also
 * included: multi-day events that started earlier and are still running
 * inside the window (end_datetime >= window start). Rows whose start falls
 * on the edges — before 06:00 on the first day (i.e. the previous night) or
 * after midnight on the morning after the last day — or that started before
 * the window are flagged rather than silently dropped, so the reviewer
 * decides.
 *
 * Safety: BEGIN READ ONLY (verified via SHOW transaction_read_only before
 * any query runs), SELECT-only, ROLLBACK — always, including on success.
 * Note `SET LOCAL default_transaction_read_only = on` after a plain BEGIN
 * does NOT make the already-open transaction read-only (it only sets the
 * default for later transactions), so it is deliberately not relied on here.
 * See runEventsWindowAudit.
 */
import { readsAsDanish } from "@/lib/languageDetection";
import { latestWithheldByEvent, WITHHELD_DESCRIPTION_CHANGE_TYPE } from "@/lib/withheldDescriptions";
import {
  addDaysToDateKey,
  copenhagenWallClockToUtc,
  dateKeyToString,
  getCopenhagenParts,
  nightlifeDateKey,
  NIGHT_CUTOFF_HOUR,
  type DateKey,
} from "@/lib/datetime";
import { assessDuplicate, normalizeUrl, type DuplicateConfidence } from "@/lib/dedup";
import { SITE_URL } from "@/lib/siteUrl";
import { ARTIST_CACHE_SQL, cacheKeyForArtist, recheckRelevance, toCacheEntry, type ArtistCacheRow, type RelevanceRecheck } from "./auditRelevance";

/** Longest window one run may cover — keeps the log readable and the query cheap. */
export const MAX_WINDOW_DAYS = 31;
/** Description is shortened to this many characters (whitespace collapsed). */
export const DESCRIPTION_MAX_CHARS = 400;

export interface AuditWindow {
  from: DateKey;
  to: DateKey;
  /** Inclusive lower bound: `from` at 00:00 Copenhagen local time. */
  startUtc: Date;
  /** Exclusive upper bound: the day after `to` at NIGHT_CUTOFF_HOUR Copenhagen local time. */
  endUtc: Date;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateKey(value: string): DateKey {
  const m = DATE_RE.exec(value.trim());
  if (!m) throw new Error(`Invalid date "${value}" — expected YYYY-MM-DD.`);
  const key = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  // Round-trip through a real date to reject e.g. 2026-02-30.
  const roundTrip = addDaysToDateKey(key, 0);
  if (dateKeyToString(roundTrip) !== value.trim()) throw new Error(`Invalid calendar date "${value}".`);
  return key;
}

export function buildAuditWindow(fromInput: string, toInput: string): AuditWindow {
  const from = parseDateKey(fromInput);
  const to = parseDateKey(toInput);
  const days = Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000,
  );
  if (days < 0) throw new Error(`to_date (${toInput}) is before from_date (${fromInput}).`);
  if (days + 1 > MAX_WINDOW_DAYS) throw new Error(`Window is ${days + 1} days; the maximum is ${MAX_WINDOW_DAYS}.`);
  return {
    from,
    to,
    startUtc: copenhagenWallClockToUtc(from, 0, 0),
    endUtc: copenhagenWallClockToUtc(addDaysToDateKey(to, 1), NIGHT_CUTOFF_HOUR, 0),
  };
}

/**
 * Shared WHERE clause — used by both the row query and the completeness
 * count, so the two can never drift apart. Deliberately NO
 * canonical_source_id predicate: source-less (admin-pasted) events are in
 * scope. $1 = window start (inclusive), $2 = window end (exclusive).
 */
export const WINDOW_PREDICATE_SQL = `e.published = true
  AND e.start_datetime < $2
  AND (e.start_datetime >= $1 OR (e.end_datetime IS NOT NULL AND e.end_datetime >= $1))`;

/** Explicit column list — only what editorial screening needs. */
export const WINDOW_EVENTS_SQL = `SELECT e.id, e.slug, e.title, e.artists, e.description,
       e.start_datetime, e.end_datetime, e.venue_id, v.name AS venue_name, e.sub_venue,
       e.primary_genre, e.subgenres, e.genre_confidence,
       e.cancelled, e.postponed, e.sold_out, e.date_changed, e.time_changed,
       e.canonical_source_id, e.official_event_url, e.ticket_url, e.resident_advisor_url,
       e.facebook_url, e.other_source_urls,
       ('primaryGenre' = ANY(e.overridden_fields)) AS primary_genre_overridden,
       ('subgenres' = ANY(e.overridden_fields)) AS subgenres_overridden
FROM events e LEFT JOIN venues v ON v.id = e.venue_id
WHERE ${WINDOW_PREDICATE_SQL}
ORDER BY e.start_datetime, e.id`;

export const WINDOW_COUNT_SQL = `SELECT e.canonical_source_id AS source_id, count(*)::int AS n
FROM events e
WHERE ${WINDOW_PREDICATE_SQL}
GROUP BY e.canonical_source_id
ORDER BY e.canonical_source_id NULLS FIRST`;

/**
 * The withheld source descriptions of the window's events, newest first —
 * only rows of that one change type, only their event id and text.
 */
export const WITHHELD_DESCRIPTIONS_SQL = `SELECT l.event_id, l.note
FROM event_change_log l
WHERE l.change_type = '${WITHHELD_DESCRIPTION_CHANGE_TYPE}' AND l.event_id = ANY($1)
ORDER BY l.created_at DESC`;

/** Row shape returned by WINDOW_EVENTS_SQL (pg returns timestamptz as Date). */
export interface WindowEventRow {
  id: string;
  slug: string;
  title: string;
  artists: string[] | null;
  description: string | null;
  start_datetime: Date | string;
  end_datetime: Date | string | null;
  venue_id: string | null;
  venue_name: string | null;
  sub_venue: string | null;
  primary_genre: string;
  subgenres: string[] | null;
  genre_confidence: string;
  cancelled: boolean;
  postponed: boolean;
  sold_out: boolean;
  date_changed: boolean;
  time_changed: boolean;
  canonical_source_id: string | null;
  official_event_url: string | null;
  ticket_url: string | null;
  resident_advisor_url: string | null;
  facebook_url: string | null;
  other_source_urls: string[] | null;
  /** primaryGenre is in overridden_fields (computed in SQL; the list itself is never selected). */
  primary_genre_overridden: boolean | null;
  /** subgenres is in overridden_fields (computed in SQL; the list itself is never selected). */
  subgenres_overridden: boolean | null;
}

export type EdgeFlag = "previous_night_early_start" | "after_midnight_last_night" | "started_before_window";

export interface ScreeningEvent {
  id: string;
  title: string;
  nightOf: string;
  startLocal: string;
  endLocal: string | null;
  venue: string;
  subVenue: string | null;
  primaryGenre: string;
  subgenres: string[];
  genreConfidence: string;
  /**
   * Which genre fields an admin set by hand ([] when none). An editorial
   * decision: never propose an automatic change to it. genreConfidence is
   * not updated by admin edits, so read it as stale when this is non-empty.
   */
  genreManuallySet: ("primaryGenre" | "subgenres")[];
  /**
   * Electronic-relevance recheck (editorial screening, 2026-10-17): a
   * CURRENT recomputation with assessRelevance from the full stored text,
   * the stored RA link and cached Discogs data, never using the stored genre
   * as evidence. It is not the historical publish decision and changes
   * nothing. See src/db/auditRelevance.ts. Absent when the audit is built
   * without it (toScreeningEvent alone).
   */
  relevanceRecheck?: RelevanceRecheck;
  artists: string[];
  status: string[];
  sourceId: string | null;
  publicUrl: string;
  sourceUrls: string[];
  description: string | null;
  /**
   * Language reporting for the daily QA (2026-10-25). Computed from the
   * FULL stored description, not the shortened one above.
   * - descriptionReadsDanish: the text reads as Danish by its grammar
   *   (src/lib/languageDetection.ts readsAsDanish) — any source, shown
   *   publicly or not. A report signal only; it hides nothing.
   * - withheldSourceDescription: the source's own Danish text that the
   *   public site does not show (shortened like description) — kept for
   *   admin and QA, see src/lib/withheldDescriptions.ts. Null when none.
   */
  descriptionReadsDanish: boolean;
  withheldSourceDescription: string | null;
  edgeFlags: EdgeFlag[];
}

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

export function formatCopenhagenLocal(date: Date): string {
  const p = getCopenhagenParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function shortenDescription(text: string | null, max = DESCRIPTION_MAX_CHARS): string | null {
  if (!text) return null;
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

export function edgeFlagsFor(start: Date, window: AuditWindow): EdgeFlag[] {
  const flags: EdgeFlag[] = [];
  if (start.getTime() < window.startUtc.getTime()) flags.push("started_before_window");
  const firstNightStart = copenhagenWallClockToUtc(window.from, NIGHT_CUTOFF_HOUR, 0);
  if (start.getTime() >= window.startUtc.getTime() && start.getTime() < firstNightStart.getTime()) {
    flags.push("previous_night_early_start");
  }
  const lastMidnight = copenhagenWallClockToUtc(addDaysToDateKey(window.to, 1), 0, 0);
  if (start.getTime() >= lastMidnight.getTime() && start.getTime() < window.endUtc.getTime()) {
    flags.push("after_midnight_last_night");
  }
  return flags;
}

export function toScreeningEvent(row: WindowEventRow, window: AuditWindow, withheld: string | null = null): ScreeningEvent {
  const start = toDate(row.start_datetime);
  const urls = [
    row.official_event_url,
    row.ticket_url,
    row.resident_advisor_url,
    row.facebook_url,
    ...(row.other_source_urls ?? []),
  ].filter((u): u is string => typeof u === "string" && u.trim() !== "");
  const status = (["cancelled", "postponed", "sold_out", "date_changed", "time_changed"] as const).filter(
    (k) => row[k] === true,
  );
  return {
    id: row.id,
    title: row.title,
    nightOf: dateKeyToString(nightlifeDateKey(start)),
    startLocal: formatCopenhagenLocal(start),
    endLocal: row.end_datetime ? formatCopenhagenLocal(toDate(row.end_datetime)) : null,
    venue: row.venue_name ?? row.venue_id ?? "(unknown venue)",
    subVenue: row.sub_venue,
    primaryGenre: row.primary_genre,
    subgenres: row.subgenres ?? [],
    genreConfidence: row.genre_confidence,
    genreManuallySet: [
      ...(row.primary_genre_overridden === true ? (["primaryGenre"] as const) : []),
      ...(row.subgenres_overridden === true ? (["subgenres"] as const) : []),
    ],
    artists: row.artists ?? [],
    status,
    sourceId: row.canonical_source_id,
    publicUrl: `${SITE_URL}/events/${row.slug}`,
    sourceUrls: Array.from(new Set(urls)),
    description: shortenDescription(row.description),
    descriptionReadsDanish: row.description ? readsAsDanish(row.description) : false,
    withheldSourceDescription: shortenDescription(withheld),
    edgeFlags: edgeFlagsFor(start, window),
  };
}

export interface DuplicateCandidatePair {
  a: string;
  b: string;
  aTitle: string;
  bTitle: string;
  confidence: DuplicateConfidence | "shared_url";
  reasons: string[];
}

/**
 * Pairs worth a human look: anything the site's own dedup logic
 * (assessDuplicate — same-night is required there) rates above "none", plus
 * pairs sharing a normalized official/ticket URL on ANY night (a common
 * sign of one event listed twice with a wrong date).
 */
export function findDuplicateCandidates(rows: WindowEventRow[]): DuplicateCandidatePair[] {
  const pairs: DuplicateCandidatePair[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      const assessment = assessDuplicate(
        {
          title: a.title,
          artists: a.artists ?? [],
          venueId: a.venue_id,
          startDatetime: toDate(a.start_datetime).toISOString(),
          subVenue: a.sub_venue,
        },
        {
          title: b.title,
          artists: b.artists ?? [],
          venueId: b.venue_id,
          startDatetime: toDate(b.start_datetime).toISOString(),
          subVenue: b.sub_venue,
        },
      );
      const urlsA = new Set([a.official_event_url, a.ticket_url].map(normalizeUrl).filter(Boolean));
      const sharedUrl = [b.official_event_url, b.ticket_url].map(normalizeUrl).find((u) => u && urlsA.has(u));
      if (assessment.confidence !== "none") {
        pairs.push({
          a: a.id,
          b: b.id,
          aTitle: a.title,
          bTitle: b.title,
          confidence: assessment.confidence,
          reasons: sharedUrl ? [...assessment.reasons, `shared URL ${sharedUrl}`] : assessment.reasons,
        });
      } else if (sharedUrl) {
        pairs.push({
          a: a.id,
          b: b.id,
          aTitle: a.title,
          bTitle: b.title,
          confidence: "shared_url",
          reasons: [`shared URL ${sharedUrl}`, ...assessment.reasons],
        });
      }
    }
  }
  return pairs;
}

/** Minimal pg client surface used here — lets tests inject a recording fake. */
export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface EventsWindowReport {
  window: { from: string; to: string; startUtc: string; endUtc: string };
  totalPublishedInWindow: number;
  countBySource: { sourceId: string | null; count: number }[];
  completenessCheck: "ok" | "mismatch";
  events: ScreeningEvent[];
  duplicateCandidates: DuplicateCandidatePair[];
}

export const READ_ONLY_TX_STATEMENTS = {
  begin: "BEGIN READ ONLY",
  timeout: "SET LOCAL statement_timeout = '25s'",
  verify: "SHOW transaction_read_only",
  rollback: "ROLLBACK",
} as const;

/**
 * Runs the audit inside a read-only transaction that is ALWAYS rolled back.
 * The only statements ever sent are BEGIN READ ONLY, a statement timeout, a
 * SHOW that proves the transaction is read-only (aborting otherwise), the
 * two SELECTs above, the read-only artist_genre_cache SELECT for the
 * relevance recheck (src/db/auditRelevance.ts), WITHHELD_DESCRIPTIONS_SQL,
 * and ROLLBACK.
 */
export async function runEventsWindowAudit(client: QueryClient, window: AuditWindow): Promise<EventsWindowReport> {
  await client.query(READ_ONLY_TX_STATEMENTS.begin);
  let report: EventsWindowReport;
  try {
    await client.query(READ_ONLY_TX_STATEMENTS.timeout);
    const ro = (await client.query(READ_ONLY_TX_STATEMENTS.verify)).rows[0] as { transaction_read_only?: string } | undefined;
    if (ro?.transaction_read_only !== "on") {
      throw new Error(`Refusing to run: transaction_read_only is "${ro?.transaction_read_only}", expected "on".`);
    }
    const params = [window.startUtc, window.endUtc];
    const rows = (await client.query(WINDOW_EVENTS_SQL, params)).rows as WindowEventRow[];
    // Read-only Discogs cache rows for every lineup name in the window (one
    // SELECT, same read-only transaction) — the relevance recheck's only
    // lineup evidence. Nothing is looked up or written.
    const artistKeys = [...new Set(rows.flatMap((r) => (r.artists ?? []).map(cacheKeyForArtist)).filter(Boolean))];
    const cacheRows = artistKeys.length > 0 ? ((await client.query(ARTIST_CACHE_SQL, [artistKeys])).rows as ArtistCacheRow[]) : [];
    const artistCache = new Map(cacheRows.map((c) => [c.artist_name_normalized, toCacheEntry(c)]));
    const withheldRows =
      rows.length > 0 ? ((await client.query(WITHHELD_DESCRIPTIONS_SQL, [rows.map((r) => r.id)])).rows as { event_id: string; note: string | null }[]) : [];
    const withheldByEvent = latestWithheldByEvent(withheldRows.map((w) => ({ eventId: w.event_id, note: w.note })));
    const counts = (await client.query(WINDOW_COUNT_SQL, params)).rows as { source_id: string | null; n: number }[];
    const countBySource = counts.map((c) => ({ sourceId: c.source_id, count: Number(c.n) }));
    const counted = countBySource.reduce((sum, c) => sum + c.count, 0);
    report = {
      window: {
        from: dateKeyToString(window.from),
        to: dateKeyToString(window.to),
        startUtc: window.startUtc.toISOString(),
        endUtc: window.endUtc.toISOString(),
      },
      totalPublishedInWindow: rows.length,
      countBySource,
      completenessCheck: counted === rows.length ? "ok" : "mismatch",
      events: await Promise.all(
        rows.map(async (r) => ({ ...toScreeningEvent(r, window, withheldByEvent[r.id] ?? null), relevanceRecheck: await recheckRelevance(r, artistCache) })),
      ),
      duplicateCandidates: findDuplicateCandidates(rows),
    };
  } catch (err) {
    try {
      await client.query(READ_ONLY_TX_STATEMENTS.rollback);
    } catch {
      /* connection may already be broken — surface the original error */
    }
    throw err;
  }
  // Always roll back, even on success — nothing is ever committed.
  await client.query(READ_ONLY_TX_STATEMENTS.rollback);
  return report;
}
