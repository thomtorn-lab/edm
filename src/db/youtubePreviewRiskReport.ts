import { classifyArtistName, type NameRule, type NameVerdict } from "@/lib/enrichment/artistNameClassification";
import { cleanArtistDisplayName, normalizeArtistName } from "@/lib/enrichment/genreEnrichment";
import {
  PROPOSED_RULES,
  replayAcceptedRow,
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

export const CACHE_SQL = `SELECT artist_name_normalized, status, video_id, video_title, channel_title, manual_block, evidence
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

export interface CacheRow {
  artist_name_normalized: string;
  status: string;
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

export interface RiskReport {
  generatedAt: string;
  rules: RuleReplaySection;
  names: NameSection;
}

export function buildRuleReplaySection(rows: CacheRow[]): RuleReplaySection {
  const accepted = rows.filter((r) => r.status === "accepted");
  const replays = accepted.map((r) =>
    replayAcceptedRow({
      artistNameNormalized: r.artist_name_normalized,
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
    return {
      generatedAt: now.toISOString(),
      rules: buildRuleReplaySection(cacheRows),
      names: buildNameSection(eventNames, discoveryNames, cacheRows),
    };
  } finally {
    await client.query(READ_ONLY_TX_STATEMENTS.rollback);
  }
}
