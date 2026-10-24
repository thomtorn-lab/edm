import { classifyArtistName, type NameRule, type NameVerdict } from "@/lib/enrichment/artistNameClassification";
import { fold, identifyHeadliners, type HeadlinerResult } from "@/lib/enrichment/eventHeadliners";
import { cleanArtistDisplayName, normalizeArtistName } from "@/lib/enrichment/genreEnrichment";
import {
  billedPartners,
  PROPOSED_RULES,
  replayAcceptedRow,
  verifiedAlternatives,
  type AcceptedReplay,
  type ProposedRule,
  type ReplayOutcome,
} from "@/lib/enrichment/youtubePreviewRuleReplay";

/**
 * Read-only YouTube preview risk report (enrichment plan, 2026-10-14):
 *
 * 1. Offline replay of PROPOSED identity rules against every accepted
 *    artist_youtube_preview_cache row's stored evidence — lists every
 *    accepted match a rule would touch. Nothing is blocked or replaced.
 * 2. Report-only classification of every lineup name in events and
 *    discovery_queue — lists what each narrow non-artist rule would flag,
 *    and which flagged names currently hold an accepted match (each one a
 *    potential false positive to review before any rule is enforced).
 *
 * Never calls YouTube. Runs inside BEGIN READ ONLY (verified with SHOW
 * transaction_read_only before any query; refuses to continue otherwise),
 * issues only SELECTs, and always ROLLBACKs — same discipline as
 * src/db/auditEventsWindow.ts.
 */

export type QueryClient = {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
};

export const READ_ONLY_TX_STATEMENTS = {
  begin: "BEGIN READ ONLY",
  timeout: "SET LOCAL statement_timeout = '25s'",
  verify: "SHOW transaction_read_only",
  rollback: "ROLLBACK",
} as const;

export const CACHE_SQL = `SELECT artist_name_normalized, status, match_rule, video_id, video_title, channel_title, manual_block, evidence
FROM artist_youtube_preview_cache
ORDER BY artist_name_normalized`;

/** "Visible" approximates src/lib/datetime.ts::isPastEvent the same way audit-production-baseline-readonly.yml does. */
export const EVENT_NAMES_SQL = `SELECT a.name AS name,
  count(*)::int AS events_total,
  (count(*) FILTER (WHERE e.published AND COALESCE(e.end_datetime, e.start_datetime + interval '1 day') > now()))::int AS events_visible
FROM events e CROSS JOIN LATERAL unnest(e.artists) AS a(name)
GROUP BY a.name`;

export const DISCOVERY_NAMES_SQL = `SELECT l.name AS name,
  count(*)::int AS discovery_total,
  (count(*) FILTER (WHERE d.status = 'pending'))::int AS discovery_pending
FROM discovery_queue d CROSS JOIN LATERAL unnest(d.detected_lineup) AS l(name)
GROUP BY l.name`;

/**
 * Event-level manual video choices (draft PR #166's event_youtube_preview_overrides,
 * migration 0023 — not in Production yet). Read defensively: the table is
 * looked up with to_regclass first and only then selected from. Any override
 * row, whatever its mode, means "a person decided": the event is kept out of
 * the headliner simulation. resolveEventOverride (#166) is deliberately NOT
 * re-implemented here.
 */
export const OVERRIDES_TABLE_SQL = "SELECT to_regclass('public.event_youtube_preview_overrides') AS t";
export const OVERRIDES_SQL = "SELECT event_id, mode, video_id, available FROM event_youtube_preview_overrides";

export interface OverrideRow {
  event_id: string;
  mode: string;
  video_id: string | null;
  available: boolean;
}

/** Upcoming published events (same "visible" approximation as EVENT_NAMES_SQL), with every source that links to them. */
export const EVENTS_SQL = `SELECT e.id, e.slug, e.title, e.description, e.artists, e.image_url, e.start_datetime, e.canonical_source_id,
  COALESCE((SELECT array_agg(DISTINCT l.source_id ORDER BY l.source_id) FROM source_event_links l WHERE l.event_id = e.id), '{}') AS source_ids
FROM events e
WHERE e.published AND COALESCE(e.end_datetime, e.start_datetime + interval '1 day') > now()
ORDER BY e.start_datetime, e.id`;

export interface CacheRow {
  artist_name_normalized: string;
  status: string;
  /** "A" for Rule A, "manual" for a hand-picked video (draft PR #163), null for abstain. */
  match_rule?: string | null;
  video_id: string | null;
  video_title: string | null;
  channel_title: string | null;
  manual_block: boolean;
  evidence: unknown;
}

interface EventNameRow {
  name: string;
  events_total: number;
  events_visible: number;
}

interface DiscoveryNameRow {
  name: string;
  discovery_total: number;
  discovery_pending: number;
}

export interface RuleReplaySection {
  proposedRules: Record<ProposedRule, string>;
  cacheRows: number;
  acceptedRows: number;
  abstainRows: number;
  manuallyBlockedRows: number;
  outcomeCounts: Record<ReplayOutcome, number>;
  /** Accepted matches the current production rules would no longer accept (matched under an older rule version). */
  failingCurrentRules: AcceptedReplay[];
  /** Every accepted match at least one proposed rule would touch. */
  affectedByProposedRules: AcceptedReplay[];
  notReplayable: AcceptedReplay[];
}

export interface NameEntry {
  name: string;
  verdict: NameVerdict;
  rules: NameRule[];
  eventsTotal: number;
  eventsVisible: number;
  discoveryTotal: number;
  discoveryPending: number;
  cacheStatus: "accepted" | "abstain" | "blocked" | "none";
}

export interface NameSection {
  distinctNames: number;
  verdictCounts: Record<NameVerdict, number>;
  ruleCounts: Partial<Record<NameRule, number>>;
  notArtist: NameEntry[];
  cleanable: NameEntry[];
  /** Flagged names that currently hold an accepted (unblocked) match — each is a potential false positive to review. */
  flaggedWithAcceptedMatch: NameEntry[];
}

export interface EventRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  artists: string[];
  image_url: string | null;
  start_datetime: Date | string;
  canonical_source_id: string | null;
  source_ids: string[] | null;
}

type CacheStatus = "accepted" | "abstain" | "blocked" | "none";

export interface VideoView {
  artist: string;
  videoId: string;
  videoTitle: string | null;
  channelTitle: string | null;
  solo: boolean;
  partners: string[];
  /** Partners billed in the video who are not in this event's lineup. */
  outsiders: string[];
  /** Proposed identity rules this video would fail (report only). */
  proposedFailures: ProposedRule[];
}

export interface HeadlinerView {
  artist: string;
  cacheStatus: CacheStatus;
  video: VideoView | null;
  /** Stored, already-verified candidates passing every rule — no YouTube call needed to use them. */
  verifiedAlternatives: { videoId: string; title: string; channelTitle: string; solo: boolean; partners: string[] }[];
}

export type SimulatedReason =
  | "headliner_solo"
  | "headliner_solo_from_evidence"
  | "headliner_b2b_in_lineup"
  | "headliner_b2b_outsider_no_alt"
  | "fallback_strong"
  | "no_prioritized_headliner"
  | "manual_choice_kept"
  | "none";

export type EventOutcome =
  | "ok_headliner_shown"
  | "headliner_has_video_not_shown"
  | "headliner_no_match"
  | "headliner_b2b_outsider_with_verified_solo"
  | "headliner_b2b_outsider_no_alt"
  | "no_prioritized_headliner"
  /** The event has a manual override (#166): left out of the simulation, never "auto". */
  | "manual_event_override"
  /** The video shown today is a hand-picked artist pin (match_rule "manual", #163): never replaced in the simulation. */
  | "manual_artist_pin";

export interface EventEntry {
  id: string;
  slug: string;
  title: string;
  start: string;
  sourceIds: string[];
  lineup: string[];
  headliner: Pick<HeadlinerResult, "headliners" | "confidence" | "signals" | "candidates" | "flags">;
  /** What the event page shows today: first lineup artist with an accepted, unblocked match. */
  shownToday: (VideoView & { isHeadliner: boolean; manualPin: boolean }) | null;
  /** Set when the event has an override row (#166): the page shows that manual choice, not shownToday. */
  manualOverride: { mode: string; videoId: string | null; available: boolean } | null;
  headliners: HeadlinerView[];
  /** Other performers with a strong, verified match (passes today's and the proposed rules; solo or partners in the lineup). */
  strongFallbacks: string[];
  simulated: {
    artist: string | null;
    videoId: string | null;
    reason: SimulatedReason;
    changesFromToday: boolean;
    /** Owner decision 3: a video of a performer other than the headliner must name that artist visibly. True only for fallback_strong. */
    requiresVisibleArtistName: boolean;
  };
  outcome: EventOutcome;
  /** no_prioritized_headliner only: why (festival_like / multi_room / other). */
  outcomeDetail: string | null;
  shownVideoFailsProposedRules: boolean;
}

export interface EventSection {
  skipped?: false;
  /** Whether #166's override table exists in this database, and how many rows it holds. */
  eventOverrides: "table_not_present" | { rows: number };
  visibleEvents: number;
  outcomeCounts: Record<EventOutcome, number>;
  confidenceCounts: Record<HeadlinerResult["confidence"], number>;
  /** Owner decision 6 (2026-10-16): evidence for or against a safe_alternates column. */
  safeAlternatesNeed: {
    /** A verified solo exists ONLY in stored evidence — today's render path cannot read it cheaply. */
    solvableOnlyFromEvidence: number;
    /** Headliner has only a B2B video with a non-performer and no stored solo — needs a new search. */
    b2bOutsiderNoAlternative: number;
    /** Headliner has no usable match at all — needs a search (priority 0 in a future budget). */
    headlinerWithoutMatch: number;
  };
  /** Prose/order dependency check: of events whose prose names a performer first, how many name the lineup's first entry. */
  proseOrderAgreement: { eventsWithProse: number; proseFirstEqualsLineupFirst: number };
  /** Documented only because the title was copied into the lineup as its first entry (e.g. a series name) — review by hand. */
  titleCopyNeedsReview: string[];
  events: EventEntry[];
}

/** Fail closed: when the override table cannot be read, no event is simulated at all. */
export interface EventSectionSkipped {
  skipped: true;
  reason: string;
}

export interface RiskReport {
  generatedAt: string;
  rules: RuleReplaySection;
  names: NameSection;
  events: EventSection | EventSectionSkipped;
}

export function buildRuleReplaySection(rows: CacheRow[]): RuleReplaySection {
  const accepted = rows.filter((r) => r.status === "accepted");
  const replays = accepted.map((r) =>
    replayAcceptedRow({
      artistNameNormalized: r.artist_name_normalized,
      matchRule: r.match_rule ?? null,
      videoId: r.video_id,
      videoTitle: r.video_title,
      channelTitle: r.channel_title,
      manualBlock: r.manual_block,
      evidence: r.evidence,
    }),
  );
  const outcomeCounts: Record<ReplayOutcome, number> = {
    unchanged: 0,
    other_candidate_available: 0,
    needs_fallback_query: 0,
    would_abstain: 0,
    not_replayable: 0,
    manual_pin: 0,
  };
  for (const r of replays) outcomeCounts[r.outcome]++;
  return {
    proposedRules: PROPOSED_RULES,
    cacheRows: rows.length,
    acceptedRows: accepted.length,
    abstainRows: rows.filter((r) => r.status === "abstain").length,
    manuallyBlockedRows: rows.filter((r) => r.manual_block).length,
    outcomeCounts,
    failingCurrentRules: replays.filter((r) => r.failsCurrentRules),
    affectedByProposedRules: replays.filter((r) => r.proposedFailures.length > 0),
    notReplayable: replays.filter((r) => r.outcome === "not_replayable"),
  };
}

function cacheStatusFor(row: CacheRow | undefined): NameEntry["cacheStatus"] {
  if (!row) return "none";
  if (row.manual_block) return "blocked";
  return row.status === "accepted" && row.video_id ? "accepted" : "abstain";
}

export function buildNameSection(eventNames: EventNameRow[], discoveryNames: DiscoveryNameRow[], cacheRows: CacheRow[]): NameSection {
  const byName = new Map<string, { eventsTotal: number; eventsVisible: number; discoveryTotal: number; discoveryPending: number }>();
  const entryFor = (name: string) => {
    let entry = byName.get(name);
    if (!entry) {
      entry = { eventsTotal: 0, eventsVisible: 0, discoveryTotal: 0, discoveryPending: 0 };
      byName.set(name, entry);
    }
    return entry;
  };
  for (const r of eventNames) {
    const e = entryFor(r.name);
    e.eventsTotal += Number(r.events_total);
    e.eventsVisible += Number(r.events_visible);
  }
  for (const r of discoveryNames) {
    const e = entryFor(r.name);
    e.discoveryTotal += Number(r.discovery_total);
    e.discoveryPending += Number(r.discovery_pending);
  }
  const cacheByKey = new Map(cacheRows.map((r) => [r.artist_name_normalized, r]));

  const verdictCounts: Record<NameVerdict, number> = { ok: 0, not_artist: 0, cleanable: 0 };
  const ruleCounts: Partial<Record<NameRule, number>> = {};
  const notArtist: NameEntry[] = [];
  const cleanable: NameEntry[] = [];
  const flaggedWithAcceptedMatch: NameEntry[] = [];

  for (const [name, counts] of [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const classification = classifyArtistName(name);
    verdictCounts[classification.verdict]++;
    if (classification.verdict === "ok") continue;
    for (const rule of classification.rules) ruleCounts[rule] = (ruleCounts[rule] ?? 0) + 1;
    const entry: NameEntry = {
      name,
      verdict: classification.verdict,
      rules: classification.rules,
      ...counts,
      cacheStatus: cacheStatusFor(cacheByKey.get(normalizeArtistName(cleanArtistDisplayName(name)))),
    };
    (classification.verdict === "not_artist" ? notArtist : cleanable).push(entry);
    if (entry.cacheStatus === "accepted") flaggedWithAcceptedMatch.push(entry);
  }
  return { distinctNames: byName.size, verdictCounts, ruleCounts, notArtist, cleanable, flaggedWithAcceptedMatch };
}

const keyOf = (name: string) => normalizeArtistName(cleanArtistDisplayName(name));

function isShowable(row: CacheRow | undefined): row is CacheRow & { video_id: string } {
  return !!row && row.status === "accepted" && !row.manual_block && !!row.video_id;
}

/**
 * Exactly the event page's choice (src/lib/queries.ts::getArtistYoutubePreviewForLineup):
 * the first lineup entry, by first occurrence of its normalized name, whose
 * cache row is accepted, not manually blocked, and has a video id.
 */
export function shownPreviewArtist(lineup: string[], cacheByKey: Map<string, CacheRow>): { artist: string; row: CacheRow & { video_id: string } } | null {
  const rawByKey = new Map(lineup.map((name) => [keyOf(name), name]));
  for (const key of rawByKey.keys()) {
    const row = cacheByKey.get(key);
    if (isShowable(row)) return { artist: rawByKey.get(key) ?? key, row };
  }
  return null;
}

function cacheStatusOf(row: CacheRow | undefined): CacheStatus {
  if (!row) return "none";
  if (row.manual_block) return "blocked";
  return row.status === "accepted" && row.video_id ? "accepted" : "abstain";
}

function inLineup(name: string, lineup: string[]): boolean {
  const f = fold(cleanArtistDisplayName(name));
  return lineup.some((a) => fold(cleanArtistDisplayName(a)) === f);
}

export function buildEventSection(eventRows: EventRow[], cacheRows: CacheRow[], overrides: OverrideRow[] | "table_not_present" = "table_not_present"): EventSection {
  const overrideByEvent = new Map(overrides === "table_not_present" ? [] : overrides.map((o) => [o.event_id, o]));
  const cacheByKey = new Map(cacheRows.map((r) => [r.artist_name_normalized, r]));
  const replayByKey = new Map<string, AcceptedReplay>();
  const replayOf = (row: CacheRow): AcceptedReplay => {
    let r = replayByKey.get(row.artist_name_normalized);
    if (!r) {
      r = replayAcceptedRow({
        artistNameNormalized: row.artist_name_normalized,
        matchRule: row.match_rule ?? null,
        videoId: row.video_id,
        videoTitle: row.video_title,
        channelTitle: row.channel_title,
        manualBlock: row.manual_block,
        evidence: row.evidence,
      });
      replayByKey.set(row.artist_name_normalized, r);
    }
    return r;
  };
  const videoView = (artist: string, row: CacheRow & { video_id: string }, lineup: string[]): VideoView => {
    const { solo, partners } = billedPartners(row.video_title ?? "", cleanArtistDisplayName(artist), row.channel_title ?? "");
    return {
      artist,
      videoId: row.video_id,
      videoTitle: row.video_title,
      channelTitle: row.channel_title,
      solo,
      partners,
      outsiders: partners.filter((p) => !inLineup(p, lineup)),
      proposedFailures: replayOf(row).proposedFailures,
    };
  };

  const outcomeCounts: Record<EventOutcome, number> = {
    ok_headliner_shown: 0,
    headliner_has_video_not_shown: 0,
    headliner_no_match: 0,
    headliner_b2b_outsider_with_verified_solo: 0,
    headliner_b2b_outsider_no_alt: 0,
    no_prioritized_headliner: 0,
    manual_event_override: 0,
    manual_artist_pin: 0,
  };
  const confidenceCounts: Record<HeadlinerResult["confidence"], number> = { documented: 0, supported_prioritized: 0, supported_insufficient: 0, none: 0 };
  const proseOrderAgreement = { eventsWithProse: 0, proseFirstEqualsLineupFirst: 0 };
  const titleCopyNeedsReview: string[] = [];
  const events: EventEntry[] = [];

  for (const e of eventRows) {
    const lineup = e.artists ?? [];
    const sourceIds = e.source_ids ?? [];
    const result = identifyHeadliners({ title: e.title, description: e.description, artists: lineup, imageUrl: e.image_url, canonicalSourceId: e.canonical_source_id, sourceIds });
    confidenceCounts[result.confidence]++;
    if (result.proseFirstMention && lineup.length > 1) {
      proseOrderAgreement.eventsWithProse++;
      if (fold(result.proseFirstMention) === fold(lineup[0])) proseOrderAgreement.proseFirstEqualsLineupFirst++;
    }
    const strongTypes = new Set(result.signals.filter((s) => s.group === "strong").map((s) => s.type));
    if (result.confidence === "documented" && result.flags.includes("title_is_lineup_entry") && strongTypes.size === 1 && strongTypes.has("title_names_artist")) {
      titleCopyNeedsReview.push(`${e.slug} — "${e.title}"`);
    }

    const shown = shownPreviewArtist(lineup, cacheByKey);
    const headlinerKeys = new Set(result.headliners.map(keyOf));
    const override = overrideByEvent.get(e.id) ?? null;
    const manualOverride = override ? { mode: override.mode, videoId: override.video_id, available: override.available } : null;
    const shownToday =
      shown && !override
        ? { ...videoView(shown.artist, shown.row, lineup), isHeadliner: headlinerKeys.has(keyOf(shown.artist)), manualPin: shown.row.match_rule === "manual" }
        : null;

    const headliners: HeadlinerView[] = result.headliners.map((artist) => {
      const row = cacheByKey.get(keyOf(artist));
      const usable = isShowable(row) && !replayOf(row).failsCurrentRules;
      return {
        artist,
        cacheStatus: cacheStatusOf(row),
        video: usable ? videoView(artist, row, lineup) : null,
        verifiedAlternatives: row
          ? verifiedAlternatives(row.evidence, row.artist_name_normalized, row.video_id).map((a) => {
              const bp = billedPartners(a.title, cleanArtistDisplayName(artist), a.channelTitle);
              return { videoId: a.videoId, title: a.title, channelTitle: a.channelTitle, solo: bp.solo, partners: bp.partners };
            })
          : [],
      };
    });

    const strongFallbacks = lineup.filter((artist) => {
      if (headlinerKeys.has(keyOf(artist))) return false;
      const row = cacheByKey.get(keyOf(artist));
      if (!isShowable(row)) return false;
      const replay = replayOf(row);
      if (replay.failsCurrentRules || replay.proposedFailures.length > 0) return false;
      const v = videoView(artist, row, lineup);
      return v.solo || v.outsiders.length === 0;
    });

    // Owner principles (2026-10-16): documented or supported_prioritized
    // headliners first; solo before a B2B with a non-performer when a
    // verified solo already exists; otherwise a strong, clearly identified
    // match of another performer; otherwise nothing changes.
    type Option = { rank: number; artist: string; videoId: string; reason: SimulatedReason };
    const options: Option[] = [];
    const prioritized = result.confidence === "documented" || result.confidence === "supported_prioritized";
    if (prioritized) {
      for (const h of headliners) {
        if (h.video) {
          if (h.video.solo) options.push({ rank: 0, artist: h.artist, videoId: h.video.videoId, reason: "headliner_solo" });
          else if (h.video.outsiders.length === 0) options.push({ rank: 2, artist: h.artist, videoId: h.video.videoId, reason: "headliner_b2b_in_lineup" });
          else {
            const soloAlt = h.verifiedAlternatives.find((a) => a.solo);
            if (soloAlt) options.push({ rank: 1, artist: h.artist, videoId: soloAlt.videoId, reason: "headliner_solo_from_evidence" });
            else options.push({ rank: 3, artist: h.artist, videoId: h.video.videoId, reason: "headliner_b2b_outsider_no_alt" });
          }
        } else {
          const soloAlt = h.verifiedAlternatives.find((a) => a.solo);
          if (soloAlt && h.cacheStatus !== "blocked") options.push({ rank: 1, artist: h.artist, videoId: soloAlt.videoId, reason: "headliner_solo_from_evidence" });
        }
      }
    }
    options.sort((a, b) => a.rank - b.rank);
    let simulated: Omit<EventEntry["simulated"], "requiresVisibleArtistName">;
    if (override) {
      // A person chose this event's video (or chose none): keep it, untouched.
      simulated = { artist: null, videoId: override.video_id, reason: "manual_choice_kept", changesFromToday: false };
    } else if (shownToday?.manualPin) {
      simulated = { artist: shownToday.artist, videoId: shownToday.videoId, reason: "manual_choice_kept", changesFromToday: false };
    } else if (!prioritized) {
      simulated = { artist: shownToday?.artist ?? null, videoId: shownToday?.videoId ?? null, reason: "no_prioritized_headliner", changesFromToday: false };
    } else if (options.length > 0) {
      const o = options[0];
      simulated = { artist: o.artist, videoId: o.videoId, reason: o.reason, changesFromToday: o.videoId !== (shownToday?.videoId ?? null) };
    } else if (strongFallbacks.length > 0) {
      const artist = strongFallbacks[0];
      const videoId = cacheByKey.get(keyOf(artist))?.video_id ?? null;
      simulated = { artist, videoId, reason: "fallback_strong", changesFromToday: videoId !== (shownToday?.videoId ?? null) };
    } else {
      simulated = { artist: null, videoId: null, reason: "none", changesFromToday: shownToday !== null };
    }

    let outcome: EventOutcome;
    let outcomeDetail: string | null = null;
    if (override) {
      outcome = "manual_event_override";
      outcomeDetail = `mode ${override.mode}${override.available ? "" : " (unavailable)"}`;
    } else if (shownToday?.manualPin) {
      outcome = "manual_artist_pin";
    } else if (!prioritized) {
      outcome = "no_prioritized_headliner";
      outcomeDetail = result.flags.includes("festival_like") ? "festival_like" : result.flags.includes("multi_room") ? "multi_room" : "other";
    } else if (simulated.reason === "headliner_solo_from_evidence") {
      outcome = "headliner_b2b_outsider_with_verified_solo";
    } else if (simulated.reason === "headliner_b2b_outsider_no_alt") {
      outcome = "headliner_b2b_outsider_no_alt";
    } else if (simulated.reason === "headliner_solo" || simulated.reason === "headliner_b2b_in_lineup") {
      outcome = shownToday?.isHeadliner && !simulated.changesFromToday ? "ok_headliner_shown" : "headliner_has_video_not_shown";
    } else {
      outcome = "headliner_no_match";
      outcomeDetail = headliners.map((h) => `${h.artist}: ${h.cacheStatus}`).join("; ");
    }
    outcomeCounts[outcome]++;

    events.push({
      id: e.id,
      slug: e.slug,
      title: e.title,
      start: new Date(e.start_datetime).toISOString(),
      sourceIds,
      lineup,
      headliner: { headliners: result.headliners, confidence: result.confidence, signals: result.signals, candidates: result.candidates, flags: result.flags },
      shownToday,
      manualOverride,
      headliners,
      strongFallbacks,
      simulated: { ...simulated, requiresVisibleArtistName: simulated.reason === "fallback_strong" },
      outcome,
      outcomeDetail,
      shownVideoFailsProposedRules: (shownToday?.proposedFailures.length ?? 0) > 0,
    });
  }

  return {
    eventOverrides: overrides === "table_not_present" ? "table_not_present" : { rows: overrides.length },
    visibleEvents: eventRows.length,
    outcomeCounts,
    confidenceCounts,
    safeAlternatesNeed: {
      solvableOnlyFromEvidence: outcomeCounts.headliner_b2b_outsider_with_verified_solo,
      b2bOutsiderNoAlternative: outcomeCounts.headliner_b2b_outsider_no_alt,
      headlinerWithoutMatch: outcomeCounts.headliner_no_match,
    },
    proseOrderAgreement,
    titleCopyNeedsReview,
    events,
  };
}

/** Runs every query inside a verified read-only transaction that is ALWAYS rolled back. */
export async function runYoutubePreviewRiskReport(client: QueryClient, now: Date = new Date()): Promise<RiskReport> {
  await client.query(READ_ONLY_TX_STATEMENTS.begin);
  try {
    await client.query(READ_ONLY_TX_STATEMENTS.timeout);
    const ro = (await client.query(READ_ONLY_TX_STATEMENTS.verify)).rows[0] as { transaction_read_only?: string } | undefined;
    if (ro?.transaction_read_only !== "on") {
      throw new Error(`Refusing to run: transaction_read_only is "${ro?.transaction_read_only}", expected "on".`);
    }
    const cacheRows = (await client.query(CACHE_SQL)).rows as CacheRow[];
    const eventNames = (await client.query(EVENT_NAMES_SQL)).rows as EventNameRow[];
    const discoveryNames = (await client.query(DISCOVERY_NAMES_SQL)).rows as DiscoveryNameRow[];
    const eventRows = (await client.query(EVENTS_SQL)).rows as EventRow[];
    // Last, so a failure here cannot lose the sections already read: an
    // unreadable override table skips the event section (fail closed) —
    // events are never simulated as if no manual choice existed.
    let events: EventSection | EventSectionSkipped;
    try {
      const table = (await client.query(OVERRIDES_TABLE_SQL)).rows[0] as { t: string | null } | undefined;
      const overrides = table?.t ? ((await client.query(OVERRIDES_SQL)).rows as OverrideRow[]) : "table_not_present";
      events = buildEventSection(eventRows, cacheRows, overrides);
    } catch (err) {
      events = { skipped: true, reason: `event_youtube_preview_overrides could not be read: ${err instanceof Error ? err.message : String(err)}` };
    }
    return {
      generatedAt: now.toISOString(),
      rules: buildRuleReplaySection(cacheRows),
      names: buildNameSection(eventNames, discoveryNames, cacheRows),
      events,
    };
  } finally {
    await client.query(READ_ONLY_TX_STATEMENTS.rollback);
  }
}
