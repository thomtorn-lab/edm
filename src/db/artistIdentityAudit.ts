import { cleanArtistDisplayName, isShortGenericArtistName, normalizeArtistName as normalizeCacheKey } from "../lib/enrichment/genreEnrichment";
import { normalizeArtistName } from "../lib/normalize";
import {
  artistIdentityKey,
  classifyAppearance,
  hasStrongSeparator,
  hasWeakSeparator,
  splitLineupEntry,
  weakSeparatorParts,
  type AppearanceBucket,
  type AppearanceConfidence,
} from "../lib/artistIdentity/lineupIdentity";
import type { ReadOnlyQueryClient } from "./readOnlyTransaction";
import type { ReportTable } from "./reportReadOnlyGuard";

/**
 * Artist Alerts identity audit (Phase A, step 1; report-only, 2026-10-24).
 *
 * Answers, read-only, how far Production's lineup data can support Artist
 * Alerts before any table, job or alert exists: lineup coverage, event
 * titles stored as artists, events without usable lineups, name collisions,
 * B2B and "&"/"x" entries, the expected review workload and historical
 * lineup changes. Nothing here writes, calls an external service or touches
 * subscriber data (none exists).
 *
 * Every figure carries a `basis`:
 * - "observed": counted directly from stored rows;
 * - "estimated": derived from observed rows through a stated assumption;
 * - "undeterminable": cannot be decided from stored data — listed so it is
 *   never mistaken for a zero.
 *
 * buildArtistIdentityAudit is pure (unit-tested with synthetic rows);
 * loadArtistIdentityAuditData is the only part that queries, and only with
 * SELECTs inside the caller's verified read-only transaction.
 */

export type Basis = "observed" | "estimated" | "undeterminable";

export interface AuditEventRow {
  id: string;
  title: string;
  artists: string[];
  startDatetime: Date;
  endDatetime: Date | null;
  published: boolean;
  cancelled: boolean;
  postponed: boolean;
  adminUnpublishReason: string | null;
  sourceCancelledAt: Date | null;
  venueId: string;
  canonicalSourceId: string | null;
  createdAt: Date;
}

export interface AuditVenueRow {
  id: string;
  name: string;
  aliases: string[];
  rooms: unknown;
}

export interface AuditSoundcloudLinkRow {
  eventId: string;
  artistName: string;
  url: string;
}

export interface AuditGenreCacheRow {
  key: string;
  lookupStatus: string;
  identityConfidence: string | null;
}

export interface AuditChangeLogRow {
  eventId: string;
  changedBy: string;
  changeType: string;
  fieldsChanged: string[];
  createdAt: Date;
}

export interface AuditData {
  events: AuditEventRow[];
  venues: AuditVenueRow[];
  sources: { id: string; sourceName: string }[];
  soundcloudLinks: AuditSoundcloudLinkRow[];
  blockedSoundcloudUrls: string[];
  genreCache: AuditGenreCacheRow[];
  changeLog: AuditChangeLogRow[];
  pendingDiscoveryLineups: string[][];
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const HISTORY_DAYS = 365;
export const CHANGE_WINDOW_DAYS = 91;
const EXAMPLE_LIMIT = 60;

function effectiveEnd(e: AuditEventRow): Date {
  return e.endDatetime ?? new Date(e.startDatetime.getTime() + DAY_MS);
}

/** Publicly listed and still upcoming — the only events an alert could ever point at. */
export function isPublicUpcoming(e: AuditEventRow, now: Date): boolean {
  return (
    e.published &&
    !e.cancelled &&
    e.adminUnpublishReason === null &&
    e.sourceCancelledAt === null &&
    effectiveEnd(e).getTime() > now.getTime()
  );
}

/** ISO week label (YYYY-Www) in UTC — good enough for weekly volume buckets. */
export function isoWeekLabel(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function venueKeys(venues: AuditVenueRow[]): Set<string> {
  const keys = new Set<string>();
  const add = (n: unknown) => {
    if (typeof n === "string" && n.trim()) keys.add(artistIdentityKey(n));
  };
  for (const v of venues) {
    add(v.name);
    for (const a of v.aliases ?? []) add(a);
    if (Array.isArray(v.rooms)) {
      for (const room of v.rooms as { name?: unknown; aliases?: unknown }[]) {
        add(room?.name);
        if (Array.isArray(room?.aliases)) for (const a of room.aliases) add(a);
      }
    }
  }
  return keys;
}

export interface Appearance {
  eventId: string;
  sourceId: string;
  venueId: string;
  title: string;
  entry: string;
  name: string;
  key: string;
  bucket: AppearanceBucket;
  confidence: AppearanceConfidence;
  fromB2bSplit: boolean;
  upcoming: boolean;
  createdAt: Date;
  handleUrl: string | null;
}

function examples<T>(items: T[], limit = EXAMPLE_LIMIT): { total: number; examples: T[] } {
  return { total: items.length, examples: items.slice(0, limit) };
}

function countBy<T>(items: T[], keyOf: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = keyOf(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const NO_SOURCE = "(no canonical source)";

export function buildArtistIdentityAudit(data: AuditData, now: Date) {
  const sourceName = new Map(data.sources.map((s) => [s.id, s.sourceName]));
  const venues = venueKeys(data.venues);
  const blocked = new Set(data.blockedSoundcloudUrls);
  const handlesByEvent = new Map<string, Map<string, string>>();
  for (const link of data.soundcloudLinks) {
    if (blocked.has(link.url)) continue;
    if (!handlesByEvent.has(link.eventId)) handlesByEvent.set(link.eventId, new Map());
    const m = handlesByEvent.get(link.eventId)!;
    m.set(link.artistName, link.url);
    m.set(artistIdentityKey(link.artistName), link.url);
  }

  const historyStart = now.getTime() - HISTORY_DAYS * DAY_MS;
  const windowEvents = data.events.filter((e) => e.published && effectiveEnd(e).getTime() > historyStart);
  const upcomingEvents = data.events.filter((e) => isPublicUpcoming(e, now));
  const upcomingIds = new Set(upcomingEvents.map((e) => e.id));

  // ---- every appearance (published, last 12 months + upcoming) ----
  const appearances: Appearance[] = [];
  for (const e of windowEvents) {
    const handles = handlesByEvent.get(e.id);
    for (const entry of e.artists) {
      for (const part of splitLineupEntry(entry)) {
        const handle = handles?.get(part.name) ?? handles?.get(artistIdentityKey(part.name)) ?? null;
        const c = classifyAppearance({
          entry,
          part,
          eventTitle: e.title,
          lineupSize: e.artists.length,
          hasSourceHandle: handle !== null,
          venueKeys: venues,
        });
        appearances.push({
          eventId: e.id,
          sourceId: e.canonicalSourceId ?? NO_SOURCE,
          venueId: e.venueId,
          title: e.title,
          entry,
          name: part.name,
          key: c.key,
          bucket: c.bucket,
          confidence: c.confidence,
          fromB2bSplit: part.fromB2bSplit,
          upcoming: upcomingIds.has(e.id),
          createdAt: e.createdAt,
          handleUrl: handle,
        });
      }
    }
  }
  const upcomingApps = appearances.filter((a) => a.upcoming);
  const appsByEvent = new Map<string, Appearance[]>();
  for (const a of upcomingApps) {
    if (!appsByEvent.has(a.eventId)) appsByEvent.set(a.eventId, []);
    appsByEvent.get(a.eventId)!.push(a);
  }

  // ---- 1. coverage per source (observed) ----
  type Coverage = { events: number; withLineup: number; withHighAppearance: number; appearances: number; high: number; review: number; pendingDecision: number; excluded: number };
  const coverage: Record<string, Coverage> = {};
  const blank = (): Coverage => ({ events: 0, withLineup: 0, withHighAppearance: 0, appearances: 0, high: 0, review: 0, pendingDecision: 0, excluded: 0 });
  for (const e of upcomingEvents) {
    const label = sourceName.get(e.canonicalSourceId ?? "") ?? e.canonicalSourceId ?? NO_SOURCE;
    const c = (coverage[label] ??= blank());
    const apps = appsByEvent.get(e.id) ?? [];
    c.events++;
    if (e.artists.length > 0) c.withLineup++;
    if (apps.some((a) => a.confidence === "high")) c.withHighAppearance++;
    for (const a of apps) {
      c.appearances++;
      if (a.confidence === "high") c.high++;
      else if (a.confidence === "review") c.review++;
      else if (a.confidence === "pending_decision") c.pendingDecision++;
      else c.excluded++;
    }
  }

  // ---- 2. event titles stored as artists (observed by rule) ----
  const titleKey = (e: AuditEventRow) => artistIdentityKey(e.title);
  const titleAsArtist = upcomingEvents.flatMap((e) =>
    e.artists
      .filter((entry) => artistIdentityKey(entry) === titleKey(e))
      .map((entry) => {
        const app = (appsByEvent.get(e.id) ?? []).find((a) => a.entry === entry);
        return {
          source: sourceName.get(e.canonicalSourceId ?? "") ?? NO_SOURCE,
          title: e.title,
          entry,
          onlyEntry: e.artists.length === 1,
          bucket: app?.bucket ?? null,
          /** Same key billed with a handle or alongside other acts elsewhere — evidence it is a real performer. */
          seenAsPerformerElsewhere: appearances.some((o) => o.key === artistIdentityKey(entry) && o.eventId !== e.id && (o.handleUrl !== null || o.bucket === "distinct")),
        };
      }),
  );

  // ---- 3. events without sufficient lineup data (observed) ----
  const insufficientReasons = upcomingEvents.map((e) => {
    const apps = appsByEvent.get(e.id) ?? [];
    let reason: string;
    if (e.artists.length === 0) reason = "no_lineup";
    else if (apps.some((a) => a.confidence === "high")) reason = "sufficient";
    else if (apps.every((a) => a.confidence === "excluded")) reason = "only_non_artists";
    else if (apps.some((a) => a.confidence === "pending_decision") && apps.every((a) => a.confidence !== "review")) reason = "only_title_as_artist";
    else reason = "only_review_names";
    return { e, reason };
  });
  const insufficient = insufficientReasons.filter((r) => r.reason !== "sufficient");

  // ---- 4. bucket totals over upcoming appearances (observed by rule) ----
  const bucketTotals = countBy(upcomingApps, (a) => a.bucket);
  const distinctKeysByBucket: Record<string, number> = {};
  for (const [bucket] of Object.entries(bucketTotals)) {
    distinctKeysByBucket[bucket] = new Set(upcomingApps.filter((a) => a.bucket === bucket).map((a) => a.key)).size;
  }
  const bucketExamples = Object.fromEntries(
    (["event_marker", "title_copy_marker", "weak_split", "short_generic", "title_copy", "not_artist", "venue_name"] as AppearanceBucket[]).map((b) => {
      const seen = new Map<string, string>();
      for (const a of upcomingApps) if (a.bucket === b && !seen.has(a.key)) seen.set(a.key, `${a.name} [${sourceName.get(a.sourceId) ?? a.sourceId}]`);
      return [b, examples([...seen.values()])];
    }),
  );

  // ---- 5. key normalisation fixes (observed) ----
  const keyFixes = new Map<string, { name: string; plainKey: string; key: string; plainKeyAlsoSeenAs: boolean }>();
  const allPlainKeys = new Set(appearances.map((a) => normalizeArtistName(a.name)));
  for (const a of appearances) {
    const plainKey = normalizeArtistName(a.name);
    if (plainKey !== a.key && !keyFixes.has(a.name)) {
      keyFixes.set(a.name, { name: a.name, plainKey, key: a.key, plainKeyAlsoSeenAs: allPlainKeys.has(a.key) });
    }
  }
  const keyFixList = [...keyFixes.values()];

  // ---- 6. collisions ----
  const handlesByKey = new Map<string, Set<string>>();
  for (const a of appearances) {
    if (!a.handleUrl) continue;
    if (!handlesByKey.has(a.key)) handlesByKey.set(a.key, new Set());
    handlesByKey.get(a.key)!.add(a.handleUrl);
  }
  const handleConflicts = [...handlesByKey.entries()].filter(([, urls]) => urls.size > 1).map(([key, urls]) => ({ key, handles: [...urls] }));

  const displayByKey = new Map<string, Set<string>>();
  for (const a of appearances) {
    if (!displayByKey.has(a.key)) displayByKey.set(a.key, new Set());
    displayByKey.get(a.key)!.add(a.name);
  }
  const spellingVariants = [...displayByKey.entries()]
    .map(([key, names]) => ({ key, names: [...names] }))
    .filter((v) => new Set(v.names.map((n) => cleanArtistDisplayName(n).toLowerCase())).size > 1);

  const stripMarks = (k: string) => k.normalize("NFKD").replace(/\p{M}/gu, "");
  const keysByFolded = new Map<string, Set<string>>();
  for (const key of displayByKey.keys()) {
    const folded = stripMarks(key);
    if (!keysByFolded.has(folded)) keysByFolded.set(folded, new Set());
    keysByFolded.get(folded)!.add(key);
  }
  const diacriticVariants = [...keysByFolded.values()].filter((keys) => keys.size > 1).map((keys) => [...keys].flatMap((k) => [...(displayByKey.get(k) ?? [])]));

  const cacheByKey = new Map(data.genreCache.map((r) => [r.key, r]));
  const upcomingKeys = new Set(upcomingApps.filter((a) => a.confidence !== "excluded").map((a) => a.key));
  const discogsAmbiguous = [...new Set(upcomingApps.filter((a) => a.confidence !== "excluded").map((a) => a.name))]
    .map((name) => ({ name, row: cacheByKey.get(normalizeCacheKey(cleanArtistDisplayName(name))) }))
    .filter((x) => x.row && (x.row.lookupStatus === "ambiguous" || x.row.identityConfidence === "low"))
    .map((x) => ({ name: x.name, lookupStatus: x.row!.lookupStatus, identityConfidence: x.row!.identityConfidence }));

  const venuesByKey = new Map<string, Set<string>>();
  const sourcesByKey = new Map<string, Set<string>>();
  for (const a of appearances) {
    if (a.confidence === "excluded") continue;
    if (!venuesByKey.has(a.key)) venuesByKey.set(a.key, new Set());
    venuesByKey.get(a.key)!.add(a.venueId);
    if (!sourcesByKey.has(a.key)) sourcesByKey.set(a.key, new Set());
    sourcesByKey.get(a.key)!.add(a.sourceId);
  }
  const shortMultiContext = [...upcomingKeys]
    .filter((key) => upcomingApps.some((a) => a.key === key && a.bucket === "short_generic"))
    .map((key) => ({ key, venues: venuesByKey.get(key)?.size ?? 0, sources: sourcesByKey.get(key)?.size ?? 0 }))
    .filter((x) => x.venues > 1);
  const multiVenueDistinct = [...upcomingKeys].filter((key) => (venuesByKey.get(key)?.size ?? 0) > 1).length;

  // ---- 7. B2B and possible multi-act entries (observed) ----
  const b2bEntries = [...new Set(upcomingEvents.flatMap((e) => e.artists.filter(hasStrongSeparator)))];
  const knownSoloKeys = new Set(appearances.filter((a) => a.confidence === "high").map((a) => a.key));
  const weakEntries = [...new Set(upcomingApps.filter((a) => a.bucket === "weak_split" || (a.confidence !== "excluded" && hasWeakSeparator(cleanArtistDisplayName(a.name)))).map((a) => a.name))].map((name) => {
    const parts = weakSeparatorParts(name);
    const known = parts.filter((p) => knownSoloKeys.has(artistIdentityKey(p)));
    return { name, parts, partsKnownAsSoloArtists: known.length, wholeKnownAsArtist: knownSoloKeys.has(artistIdentityKey(name)) };
  });

  // ---- 8. review workload (estimated) ----
  const reviewApps = upcomingApps.filter((a) => a.confidence === "review");
  const shortPairs = new Set(upcomingApps.filter((a) => a.bucket === "short_generic").map((a) => `${a.key}|${a.sourceId}`));
  const keysWithHandle = new Set(appearances.filter((a) => a.handleUrl).map((a) => a.key));
  const shortPairsWithHandleElsewhere = [...shortPairs].filter((p) => keysWithHandle.has(p.split("|")[0])).length;
  const initialReviewItems = new Set(reviewApps.filter((a) => a.bucket !== "short_generic").map((a) => a.key)).size + shortPairs.size;

  const changeStart = now.getTime() - CHANGE_WINDOW_DAYS * DAY_MS;
  const firstSeenByPair = new Map<string, Date>();
  for (const a of appearances) {
    const pair = `${a.key}|${a.sourceId}`;
    const prev = firstSeenByPair.get(pair);
    if (!prev || a.createdAt < prev) firstSeenByPair.set(pair, a.createdAt);
  }
  const recentApps = appearances.filter((a) => a.createdAt.getTime() >= changeStart);
  const weekly: Record<string, { newEvents: number; newHighAppearances: number; newReviewItems: number; lineupChangeEvents: number }> = {};
  const wk = (d: Date) => (weekly[isoWeekLabel(d)] ??= { newEvents: 0, newHighAppearances: 0, newReviewItems: 0, lineupChangeEvents: 0 });
  for (const e of windowEvents) if (e.createdAt.getTime() >= changeStart) wk(e.createdAt).newEvents++;
  const countedReview = new Set<string>();
  for (const a of recentApps) {
    if (a.confidence === "high") wk(a.createdAt).newHighAppearances++;
    if (a.confidence === "review") {
      const pair = `${a.key}|${a.sourceId}`;
      const item = a.bucket === "short_generic" ? pair : a.key;
      if (!countedReview.has(item) && firstSeenByPair.get(pair)?.getTime() === a.createdAt.getTime()) {
        countedReview.add(item);
        wk(a.createdAt).newReviewItems++;
      }
    }
  }

  // ---- 9. historical lineup changes (observed) ----
  const artistChanges = data.changeLog.filter((r) => r.createdAt.getTime() >= changeStart && r.changeType !== "create" && r.fieldsChanged.includes("artists"));
  const changeEventsByWeek = new Map<string, Set<string>>();
  for (const r of artistChanges) {
    const label = isoWeekLabel(r.createdAt);
    if (!changeEventsByWeek.has(label)) changeEventsByWeek.set(label, new Set());
    changeEventsByWeek.get(label)!.add(r.eventId);
  }
  for (const [label, ids] of changeEventsByWeek) {
    (weekly[label] ??= { newEvents: 0, newHighAppearances: 0, newReviewItems: 0, lineupChangeEvents: 0 }).lineupChangeEvents = ids.size;
  }
  const weeks = Object.keys(weekly).sort();
  const mean = (f: (w: (typeof weekly)[string]) => number) => (weeks.length ? Math.round((weeks.reduce((s, w) => s + f(weekly[w]), 0) / weeks.length) * 10) / 10 : 0);

  // ---- 10. what can realistically support alerts (estimated) ----
  const highUpcoming = upcomingApps.filter((a) => a.confidence === "high");
  const pendingUpcoming = upcomingApps.filter((a) => a.confidence === "pending_decision");

  return {
    generatedAt: now.toISOString(),
    rulesVersion: "artist-identity-rules@2026-10-24",
    rowsRead: {
      events: data.events.length,
      venues: data.venues.length,
      sources: data.sources.length,
      eventSoundcloudLinks: data.soundcloudLinks.length,
      soundcloudLinkBlocks: data.blockedSoundcloudUrls.length,
      artistGenreCache: data.genreCache.length,
      eventChangeLog: data.changeLog.length,
      pendingDiscoveryRows: data.pendingDiscoveryLineups.length,
    },
    definitions: {
      upcomingPublicEvent: "published, not cancelled, not admin- or source-unpublished, effective end (end, or start + 1 day) after the report time",
      historyWindowDays: HISTORY_DAYS,
      changeWindowDays: CHANGE_WINDOW_DAYS,
      confidence: {
        high: "could trigger an alert under the proposed rules (source SoundCloud handle, or a distinctive name)",
        review: "needs an admin before it could trigger anything",
        pending_decision: "event title stored as the only artist, no event word — the rule is decided at G1",
        excluded: "not a performer (shared non-artist classification, or a venue name)",
      },
    },
    coverage: { basis: "observed" as Basis, upcomingPublicEvents: upcomingEvents.length, bySource: coverage },
    titleAsArtist: {
      basis: "observed" as Basis,
      note: "A lineup entry with the same identity key as the event title. Whether such a name is a performer or a series cannot always be decided automatically; seenAsPerformerElsewhere is supporting evidence only.",
      total: titleAsArtist.length,
      onlyEntry: titleAsArtist.filter((t) => t.onlyEntry).length,
      withEventWord: titleAsArtist.filter((t) => t.bucket === "title_copy_marker").length,
      seenAsPerformerElsewhere: titleAsArtist.filter((t) => t.seenAsPerformerElsewhere).length,
      bySource: countBy(titleAsArtist, (t) => t.source),
      examples: examples(titleAsArtist).examples,
    },
    insufficientLineup: {
      basis: "observed" as Basis,
      total: insufficient.length,
      byReason: countBy(insufficient, (r) => r.reason),
      bySourceAndReason: countBy(insufficient, (r) => `${sourceName.get(r.e.canonicalSourceId ?? "") ?? NO_SOURCE} :: ${r.reason}`),
      examples: examples(insufficient.map((r) => ({ title: r.e.title, source: sourceName.get(r.e.canonicalSourceId ?? "") ?? NO_SOURCE, reason: r.reason, artists: r.e.artists }))).examples,
    },
    appearanceBuckets: { basis: "observed" as Basis, appearances: upcomingApps.length, byBucket: bucketTotals, distinctKeysByBucket, examples: bucketExamples },
    keyNormalisation: {
      basis: "observed" as Basis,
      note: "Names whose identity key differs from today's normalizeArtistName (trailing [label] brackets, stacked brackets, cleanable country codes/status tails). plainKeyAlsoSeenAs: the cleaned key is also billed plainly elsewhere — a match today's key would miss.",
      total: keyFixList.length,
      wouldOtherwiseMissAMatch: keyFixList.filter((k) => k.plainKeyAlsoSeenAs).length,
      examples: examples(keyFixList).examples,
    },
    collisions: {
      handleConflicts: { basis: "observed" as Basis, note: "Same identity key linked by sources to different SoundCloud profiles: likely different artists, or one artist with two profiles.", total: handleConflicts.length, examples: examples(handleConflicts).examples },
      diacriticVariants: { basis: "observed" as Basis, note: "Names that differ only by accents (Âme / Ame) get different keys today — probably one artist, a match the rules would miss. Not merged automatically.", total: diacriticVariants.length, examples: examples(diacriticVariants).examples },
      spellingVariants: { basis: "observed" as Basis, note: "One key, several spellings beyond letter case (brackets, country codes). Expected to be the same artist; listed for review.", total: spellingVariants.length, examples: examples(spellingVariants).examples },
      discogsAmbiguousOrLowIdentity: { basis: "observed" as Basis, note: "Upcoming lineup names the Discogs genre cache found ambiguous or matched with low identity confidence.", total: discogsAmbiguous.length, examples: examples(discogsAmbiguous).examples },
      shortNamesAtSeveralVenues: { basis: "estimated" as Basis, note: "Short/generic names billed at more than one venue in 12 months: each new venue/source would need one admin confirmation under the continuity rule.", total: shortMultiContext.length, examples: examples(shortMultiContext).examples },
      distinctNamesAtSeveralVenues: { basis: "observed" as Basis, total: multiVenueDistinct },
      sameNameDifferentArtists: { basis: "undeterminable" as Basis, note: "Two different artists with the same distinctive name and no source handle cannot be told apart from stored data. Only handle conflicts, Discogs ambiguity and admin review can surface them." },
    },
    splits: {
      b2bEntries: { basis: "observed" as Basis, note: "Upcoming lineup entries that still contain b2b/b3b/back to back (split into individually followable performers).", total: b2bEntries.length, examples: examples(b2bEntries).examples },
      possibleMultiActEntries: {
        basis: "observed" as Basis,
        note: "Entries with &, x, +, comma, vs, and/og. Never split automatically; partsKnownAsSoloArtists counts parts already billed alone with high confidence.",
        total: weakEntries.length,
        allPartsKnown: weakEntries.filter((w) => w.parts.length > 1 && w.partsKnownAsSoloArtists === w.parts.length).length,
        wholeKnownAsArtist: weakEntries.filter((w) => w.wholeKnownAsArtist).length,
        examples: examples(weakEntries).examples,
      },
    },
    reviewWorkload: {
      basis: "estimated" as Basis,
      note: "Initial backlog: one item per distinct review name, except short names, which count once per (name, source) under the continuity rule. Weekly figures assume a name's first billing at a source is when it first needs review.",
      initialBacklogItems: initialReviewItems,
      shortNameSourcePairs: shortPairs.size,
      shortNameSourcePairsWithAHandleElsewhere: shortPairsWithHandleElsewhere,
      pendingDiscoveryRowsWithLineup: data.pendingDiscoveryLineups.filter((l) => l.length > 0).length,
      weeklyMean: { newEvents: mean((w) => w.newEvents), newHighAppearances: mean((w) => w.newHighAppearances), newReviewItems: mean((w) => w.newReviewItems), lineupChangeEvents: mean((w) => w.lineupChangeEvents) },
      byWeek: Object.fromEntries(weeks.map((w) => [w, weekly[w]])),
    },
    lineupChanges: {
      basis: "observed" as Basis,
      note: "event_change_log rows (not 'create') whose fields_changed includes artists. The log does not store old/new values, so additions cannot be told apart from removals or reorderings (undeterminable).",
      rows: artistChanges.length,
      distinctEvents: new Set(artistChanges.map((r) => r.eventId)).size,
      byChangedBy: countBy(artistChanges, (r) => (r.changedBy === "admin" ? "admin" : sourceName.get(r.changedBy) ?? r.changedBy)),
      additionsVersusRemovals: { basis: "undeterminable" as Basis },
    },
    alertSupport: {
      basis: "estimated" as Basis,
      note: "Under the proposed rules, before any admin review. 'withPendingDecision' adds events whose only usable name is the event title stored as the artist.",
      upcomingPublicEvents: upcomingEvents.length,
      eventsWithAHighAppearance: new Set(highUpcoming.map((a) => a.eventId)).size,
      eventsAlsoWithPendingDecision: new Set([...highUpcoming, ...pendingUpcoming].map((a) => a.eventId)).size,
      highAppearances: highUpcoming.length,
      distinctHighArtists: new Set(highUpcoming.map((a) => a.key)).size,
      followableArtistsIncludingReview: new Set(upcomingApps.filter((a) => a.confidence !== "excluded").map((a) => a.key)).size,
      weeklyNewHighAppearancesMean: mean((w) => w.newHighAppearances),
    },
    shortGenericCheck: { basis: "observed" as Basis, upcomingShortNames: new Set(upcomingApps.filter((a) => isShortGenericArtistName(cleanArtistDisplayName(a.name))).map((a) => a.key)).size },
  };
}

export type ArtistIdentityAudit = ReturnType<typeof buildArtistIdentityAudit>;

/** Tables the report reads — the guard proves SELECT access (and no write access anywhere) before any query. */
export const AUDIT_TABLE_NAMES = [
  "events",
  "venues",
  "sources",
  "event_soundcloud_links",
  "soundcloud_link_blocks",
  "artist_genre_cache",
  "event_change_log",
  "discovery_queue",
] as const;

export const AUDIT_TABLES: ReportTable[] = AUDIT_TABLE_NAMES.map((name) => ({ schema: "public", name, optional: false }));

/** SELECT-only queries; the caller must already be inside a verified read-only transaction. */
export const AUDIT_QUERIES = {
  events: `
    SELECT id, title, artists, start_datetime, end_datetime, published, cancelled, postponed,
           admin_unpublish_reason, source_cancelled_at, venue_id, canonical_source_id, created_at
    FROM events
    WHERE COALESCE(end_datetime, start_datetime + interval '1 day') > now() - interval '${HISTORY_DAYS} days'`,
  venues: `SELECT id, name, aliases, rooms FROM venues`,
  sources: `SELECT id, source_name FROM sources`,
  soundcloudLinks: `SELECT event_id, artist_name, url FROM event_soundcloud_links`,
  blockedSoundcloudUrls: `SELECT url FROM soundcloud_link_blocks`,
  genreCache: `SELECT artist_name_normalized, lookup_status, identity_confidence FROM artist_genre_cache`,
  changeLog: `
    SELECT event_id, changed_by, change_type, fields_changed, created_at
    FROM event_change_log
    WHERE created_at > now() - interval '${CHANGE_WINDOW_DAYS} days'
      AND (change_type = 'create' OR 'artists' = ANY(fields_changed))`,
  pendingDiscovery: `SELECT detected_lineup FROM discovery_queue WHERE status = 'pending'`,
} as const;

const date = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const dateOrNull = (v: unknown): Date | null => (v === null || v === undefined ? null : date(v));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function loadArtistIdentityAuditData(client: ReadOnlyQueryClient): Promise<AuditData> {
  const rows = async (sql: string) => (await client.query(sql)).rows as Record<string, unknown>[];
  return {
    events: (await rows(AUDIT_QUERIES.events)).map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      artists: strings(r.artists),
      startDatetime: date(r.start_datetime),
      endDatetime: dateOrNull(r.end_datetime),
      published: r.published === true,
      cancelled: r.cancelled === true,
      postponed: r.postponed === true,
      adminUnpublishReason: (r.admin_unpublish_reason as string | null) ?? null,
      sourceCancelledAt: dateOrNull(r.source_cancelled_at),
      venueId: String(r.venue_id),
      canonicalSourceId: (r.canonical_source_id as string | null) ?? null,
      createdAt: date(r.created_at),
    })),
    venues: (await rows(AUDIT_QUERIES.venues)).map((r) => ({ id: String(r.id), name: String(r.name), aliases: strings(r.aliases), rooms: r.rooms })),
    sources: (await rows(AUDIT_QUERIES.sources)).map((r) => ({ id: String(r.id), sourceName: String(r.source_name) })),
    soundcloudLinks: (await rows(AUDIT_QUERIES.soundcloudLinks)).map((r) => ({ eventId: String(r.event_id), artistName: String(r.artist_name), url: String(r.url) })),
    blockedSoundcloudUrls: (await rows(AUDIT_QUERIES.blockedSoundcloudUrls)).map((r) => String(r.url)),
    genreCache: (await rows(AUDIT_QUERIES.genreCache)).map((r) => ({
      key: String(r.artist_name_normalized),
      lookupStatus: String(r.lookup_status),
      identityConfidence: (r.identity_confidence as string | null) ?? null,
    })),
    changeLog: (await rows(AUDIT_QUERIES.changeLog)).map((r) => ({
      eventId: String(r.event_id),
      changedBy: String(r.changed_by),
      changeType: String(r.change_type),
      fieldsChanged: strings(r.fields_changed),
      createdAt: date(r.created_at),
    })),
    pendingDiscoveryLineups: (await rows(AUDIT_QUERIES.pendingDiscovery)).map((r) => strings(r.detected_lineup)),
  };
}
