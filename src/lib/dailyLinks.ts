import { cleanArtistDisplayName, isPlaceholderArtistName, normalizeArtistName } from "./enrichment/genreEnrichment";
import { cachedVideoMeetsContentRules } from "./enrichment/youtubePreviewMatching";
import { discogsCacheKey, discogsLookupCandidates } from "./soundcloudEvidence/discogsSoundcloud";

/**
 * Daily SoundCloud/YouTube links job (2026-11-20) — the pure half. The I/O
 * lives in src/db/dailyLinks.ts; the route is /api/enrichment/daily-links
 * (Vercel Cron, once a day).
 *
 * Nothing here matches anything: the job only decides WHICH artists of
 * upcoming published events still lack a link worth looking up, then hands
 * them to the existing rule-based matchers (Discogs -> SoundCloud,
 * YouTube Rule A), which abstain when unsure. What the pages show is still
 * decided by the existing read paths, so manual links, blocks, hidden
 * videos and event overrides keep winning; this module additionally keeps
 * them out of the selection so no lookup is spent on them.
 */

export interface DailyLinksConfig {
  /** Off unless DAILY_LINKS_YOUTUBE_ENABLED is exactly "true": the project's search.list quota is not confirmed. */
  youtubeEnabled: boolean;
  /** Artists sent to the YouTube matcher per run (each costs 1-2 search.list calls). */
  youtubeMaxArtists: number;
  /** Artists sent to Discogs per run. */
  soundcloudMaxLookups: number;
  /** Report recipient; undefined falls back to sendEmail's default (CONTACT_RECIPIENT_EMAIL). */
  reportEmail: string | undefined;
}

export const DEFAULT_YOUTUBE_MAX_ARTISTS = 10; // <= 20 search.list calls of the default 100/day, leaving the rest to live ingestion
export const DEFAULT_SOUNDCLOUD_MAX_LOOKUPS = 10;

function boundedInt(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}

export function dailyLinksConfig(env: Record<string, string | undefined> = process.env): DailyLinksConfig {
  return {
    youtubeEnabled: env.DAILY_LINKS_YOUTUBE_ENABLED === "true",
    youtubeMaxArtists: boundedInt(env.DAILY_LINKS_YOUTUBE_MAX_ARTISTS, DEFAULT_YOUTUBE_MAX_ARTISTS, 40),
    soundcloudMaxLookups: boundedInt(env.DAILY_LINKS_SOUNDCLOUD_MAX_LOOKUPS, DEFAULT_SOUNDCLOUD_MAX_LOOKUPS, 30),
    reportEmail: env.DAILY_LINKS_REPORT_EMAIL?.trim() || undefined,
  };
}

export interface DailyLinksEvent {
  id: string;
  title: string;
  startDatetime: string;
  artists: string[];
}

/**
 * Performers worth a Discogs -> SoundCloud lookup, earliest event first:
 * per event, only lineup names its page shows no SoundCloud link for (a
 * manual link, a venue link or a reused/verified profile all count), then
 * the sync's own candidate rule (discogsLookupCandidates: distinct single
 * performers). Distinct by Discogs cache key. The caller still drops the
 * ones the Discogs cache already answers (needsDiscogsSoundcloudLookup).
 */
export function soundcloudCandidates(eventsByDate: readonly DailyLinksEvent[], shownLinks: ReadonlyMap<string, readonly { name: string }[]>): string[] {
  const out = new Map<string, string>();
  for (const e of eventsByDate) {
    const linked = new Set((shownLinks.get(e.id) ?? []).map((l) => l.name));
    for (const name of discogsLookupCandidates([e], linked)) {
      const key = discogsCacheKey(name);
      if (key && !out.has(key)) out.set(key, name);
    }
  }
  return [...out.values()];
}

export interface YoutubeCacheState {
  status: string;
  manualBlock: boolean;
  expiresAt: Date;
  videoTitle: string | null;
  channelTitle: string | null;
}

export function youtubeKey(name: string): string {
  return normalizeArtistName(cleanArtistDisplayName(name));
}

/**
 * Per event (earliest first), the lineup names to try on YouTube, in lineup
 * order. An event is skipped outright when it has any admin override
 * (chosen video, hidden, or chosen-but-unavailable) or already shows a
 * video. A name is skipped when it is a placeholder, manually blocked, or
 * has a fresh cache row (the same freshness rule as the backfill: an
 * accepted row that fails today's content rules is not fresh). The caller
 * stops an event at its first accepted match: one video per event page.
 */
export function youtubeCandidateGroups(
  eventsByDate: readonly DailyLinksEvent[],
  overrideEventIds: ReadonlySet<string>,
  eventIdsWithVideo: ReadonlySet<string>,
  cache: ReadonlyMap<string, YoutubeCacheState>,
  now: Date,
): { eventId: string; artists: string[] }[] {
  const groups: { eventId: string; artists: string[] }[] = [];
  for (const e of eventsByDate) {
    if (overrideEventIds.has(e.id) || eventIdsWithVideo.has(e.id)) continue;
    const artists: string[] = [];
    const seen = new Set<string>();
    for (const name of e.artists) {
      if (isPlaceholderArtistName(name)) continue;
      const key = youtubeKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const row = cache.get(key);
      if (row?.manualBlock) continue;
      const fresh = row && row.expiresAt.getTime() > now.getTime() && (row.status !== "accepted" || cachedVideoMeetsContentRules(row.videoTitle, row.channelTitle, key));
      if (fresh) continue;
      artists.push(name);
    }
    if (artists.length > 0) groups.push({ eventId: e.id, artists });
  }
  return groups;
}

export interface NewSoundcloudLink {
  eventId: string;
  artistName: string;
  url: string;
}

/** Links a page shows now that it did not show before the run (by lineup name). */
export function newSoundcloudLinks(
  before: ReadonlyMap<string, readonly { name: string; url: string }[]>,
  after: ReadonlyMap<string, readonly { name: string; url: string }[]>,
): NewSoundcloudLink[] {
  const out: NewSoundcloudLink[] = [];
  for (const [eventId, links] of after) {
    const had = new Set((before.get(eventId) ?? []).map((l) => l.name));
    for (const l of links) if (!had.has(l.name)) out.push({ eventId, artistName: l.name, url: l.url });
  }
  return out;
}

export interface NewYoutubeVideo {
  eventId: string;
  artistName: string | null;
  videoId: string;
}

export interface DailyLinksReport {
  eventsChecked: number;
  soundcloud: { lookedUp: number; remaining: number; added: NewSoundcloudLink[] };
  youtube: { enabled: boolean; artistsLookedUp: number; remaining: number; added: NewYoutubeVideo[] };
  errors: string[];
}

/** The report is emailed only when a link was added or something failed; otherwise it is logged only. */
export function shouldEmailDailyLinksReport(report: DailyLinksReport): boolean {
  return report.soundcloud.added.length > 0 || report.youtube.added.length > 0 || report.errors.length > 0;
}

const MAX_LISTED = 15;

/** The short daily email: counts first, then the actual new links (capped), then errors. */
export function formatDailyLinksReport(report: DailyLinksReport, events: ReadonlyMap<string, DailyLinksEvent>): { subject: string; text: string } {
  const label = (eventId: string) => {
    const e = events.get(eventId);
    return e ? `${e.startDatetime.slice(0, 10)} ${e.title}` : eventId;
  };
  const sc = report.soundcloud.added;
  const yt = report.youtube.added;
  const lines: string[] = [
    `Kontrollerede events: ${report.eventsChecked}`,
    `Nye SoundCloud-links: ${sc.length}`,
    `Nye YouTube-videoer: ${report.youtube.enabled ? yt.length : "– (YouTube-delen er slået fra)"}`,
    `Fejl: ${report.errors.length}`,
  ];
  if (sc.length > 0) {
    lines.push("", "SoundCloud:");
    for (const l of sc.slice(0, MAX_LISTED)) lines.push(`- ${label(l.eventId)}: ${l.artistName} → ${l.url}`);
    if (sc.length > MAX_LISTED) lines.push(`- … og ${sc.length - MAX_LISTED} mere`);
  }
  if (yt.length > 0) {
    lines.push("", "YouTube:");
    for (const v of yt.slice(0, MAX_LISTED)) lines.push(`- ${label(v.eventId)}: ${v.artistName ?? "?"} → https://www.youtube.com/watch?v=${v.videoId}`);
    if (yt.length > MAX_LISTED) lines.push(`- … og ${yt.length - MAX_LISTED} mere`);
  }
  if (report.errors.length > 0) {
    lines.push("", "Fejl:");
    for (const e of report.errors.slice(0, MAX_LISTED)) lines.push(`- ${e}`);
  }
  lines.push(
    "",
    `Opslag: Discogs ${report.soundcloud.lookedUp} (${report.soundcloud.remaining} venter), YouTube ${report.youtube.artistsLookedUp} (${report.youtube.remaining} venter).`,
  );
  const subject = `Electronic CPH links: +${sc.length} SoundCloud, +${report.youtube.enabled ? yt.length : 0} YouTube${report.errors.length > 0 ? `, ${report.errors.length} fejl` : ""}`;
  return { subject, text: lines.join("\n") };
}
