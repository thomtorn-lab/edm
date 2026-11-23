import { and, eq, inArray } from "drizzle-orm";
import { db } from "./client";
import { artistGenreCache, artistYoutubePreviewCache, events } from "./schema";
import { resolveDiscogsSoundcloud } from "./discogsSoundcloud";
import { drizzleCacheStore as youtubeCacheStore } from "./youtubePreview";
import * as youtubeClient from "@/lib/enrichment/youtubeClient";
import { getOrMatchArtistYoutubePreview } from "@/lib/enrichment/youtubePreviewMatching";
import { discogsCacheKey, needsDiscogsSoundcloudLookup } from "@/lib/soundcloudEvidence/discogsSoundcloud";
import { getEventYoutubePreview, getPreviewAvailabilityForEvents, getSoundcloudLinksForEvents, readEventOverrides, upcomingCandidateCondition } from "@/lib/queries";
import { isPastEvent } from "@/lib/datetime";
import { sendEmail } from "@/lib/email";
import {
  dailyLinksConfig,
  formatDailyLinksReport,
  newSoundcloudLinks,
  shouldEmailDailyLinksReport,
  soundcloudCandidates,
  youtubeCandidateGroups,
  youtubeKey,
  type DailyLinksConfig,
  type DailyLinksEvent,
  type DailyLinksReport,
  type YoutubeCacheState,
} from "@/lib/dailyLinks";

/**
 * Daily SoundCloud/YouTube links job (2026-11-20), run once a day by Vercel
 * Cron through /api/enrichment/daily-links. See src/lib/dailyLinks.ts for
 * the selection rules. Writes only to the two existing per-artist caches,
 * through the existing matchers:
 *   - SoundCloud: resolveDiscogsSoundcloud (artist_genre_cache.evidence),
 *     the same Discogs path the source syncs use, just with a larger daily
 *     allowance than their two lookups per run;
 *   - YouTube (off unless DAILY_LINKS_YOUTUBE_ENABLED=true):
 *     getOrMatchArtistYoutubePreview (artist_youtube_preview_cache).
 * Never writes events, event links, blocks or overrides. "Added" in the
 * report is measured, not inferred: what the existing page read paths show
 * after the run minus what they showed before it.
 *
 * Time: stops starting new lookups well inside the route's maxDuration
 * (300s). Whatever is left is simply still missing next day and is picked
 * up then — selection is always "still missing and not answered by the
 * cache", so no state has to be carried between runs.
 */

/** No new Discogs lookup starts after this (a lookup is ~6 Discogs requests at an 8s timeout each). */
const SOUNDCLOUD_PHASE_END_MS = 150_000;
/** No new YouTube artist starts after this (worst case ~4 calls at 8s plus two short 429 retries). */
const YOUTUBE_PHASE_END_MS = 230_000;
/** Pause after each real Discogs lookup: ~6 requests per 15s stays under even the unauthenticated 25/min limit, leaving room for syncs. */
const DISCOGS_PACE_MS = 15_000;
const YOUTUBE_PACE_MS = 1_000;
const YOUTUBE_CONSECUTIVE_FAILURE_LIMIT = 3;

export interface DailyLinksDeps {
  config?: DailyLinksConfig;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  send?: typeof sendEmail;
}

export interface DailyLinksResult extends DailyLinksReport {
  emailSent: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function upcomingEvents(now: Date): Promise<DailyLinksEvent[]> {
  const rows = await db
    .select({ id: events.id, title: events.title, startDatetime: events.startDatetime, endDatetime: events.endDatetime, artists: events.artists })
    .from(events)
    .where(and(eq(events.published, true), upcomingCandidateCondition(now)));
  return rows
    .filter((r) => !isPastEvent({ startDatetime: r.startDatetime.toISOString(), endDatetime: r.endDatetime?.toISOString() ?? null }, now))
    .sort((a, b) => a.startDatetime.getTime() - b.startDatetime.getTime() || a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, title: r.title, startDatetime: r.startDatetime.toISOString(), artists: r.artists }));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runDailyLinks(deps: DailyLinksDeps = {}): Promise<DailyLinksResult> {
  const config = deps.config ?? dailyLinksConfig();
  const clock = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const started = clock().getTime();
  const elapsed = () => clock().getTime() - started;
  const now = clock();

  const list = await upcomingEvents(now);
  const report: DailyLinksReport = {
    eventsChecked: list.length,
    soundcloud: { lookedUp: 0, remaining: 0, added: [] },
    youtube: { enabled: config.youtubeEnabled, artistsLookedUp: 0, remaining: 0, added: [] },
    errors: [],
  };

  // ---- SoundCloud (Discogs) ----
  try {
    const before = await getSoundcloudLinksForEvents(list);
    const candidates = soundcloudCandidates(list, before);
    const keys = [...new Set(candidates.map(discogsCacheKey))];
    const cached =
      keys.length === 0
        ? []
        : await db
            .select({ key: artistGenreCache.artistNameNormalized, lookupStatus: artistGenreCache.lookupStatus, evidence: artistGenreCache.evidence, expiresAt: artistGenreCache.expiresAt })
            .from(artistGenreCache)
            .where(inArray(artistGenreCache.artistNameNormalized, keys));
    const byKey = new Map(cached.map((r) => [r.key, r]));
    const pending = candidates.filter((name) => needsDiscogsSoundcloudLookup(byKey.get(discogsCacheKey(name)), now));

    let index = 0;
    for (; index < pending.length; index++) {
      if (report.soundcloud.lookedUp >= config.soundcloudMaxLookups || elapsed() >= SOUNDCLOUD_PHASE_END_MS) break;
      const summary = await resolveDiscogsSoundcloud([pending[index]], 1, clock());
      report.soundcloud.lookedUp += summary.lookedUp;
      if (summary.failed > 0) {
        // Usually Discogs' rate limit: stop and leave the rest for tomorrow.
        report.errors.push(`Discogs-opslag fejlede for "${pending[index]}" — resten tages i næste kørsel`);
        index++;
        break;
      }
      if (summary.lookedUp > 0 && index < pending.length - 1) await sleep(DISCOGS_PACE_MS);
    }
    report.soundcloud.remaining = pending.length - index;

    if (report.soundcloud.lookedUp > 0) {
      report.soundcloud.added = newSoundcloudLinks(before, await getSoundcloudLinksForEvents(list));
    }
  } catch (err) {
    report.errors.push(`SoundCloud-delen fejlede: ${message(err)}`);
  }

  // ---- YouTube (Rule A), only when enabled ----
  if (config.youtubeEnabled) {
    try {
      const overrides = await readEventOverrides(list.map((e) => e.id));
      // A failed override read must never let automation work around an admin's choice.
      if (!overrides) throw new Error("kunne ikke læse event-overrides — YouTube springes over");
      const availability = await getPreviewAvailabilityForEvents(list);
      const withVideo = new Set(list.filter((_, i) => availability[i]).map((e) => e.id));
      const keys = [...new Set(list.flatMap((e) => e.artists.map(youtubeKey)).filter(Boolean))];
      const cacheRows =
        keys.length === 0
          ? []
          : await db
              .select({
                key: artistYoutubePreviewCache.artistNameNormalized,
                status: artistYoutubePreviewCache.status,
                manualBlock: artistYoutubePreviewCache.manualBlock,
                expiresAt: artistYoutubePreviewCache.expiresAt,
                videoTitle: artistYoutubePreviewCache.videoTitle,
                channelTitle: artistYoutubePreviewCache.channelTitle,
              })
              .from(artistYoutubePreviewCache)
              .where(inArray(artistYoutubePreviewCache.artistNameNormalized, keys));
      const cache = new Map<string, YoutubeCacheState>(cacheRows.map((r) => [r.key, r]));
      const groups = youtubeCandidateGroups(list, new Set(overrides.keys()), withVideo, cache, now);

      const tried = new Set<string>();
      const touchedEvents = new Set<string>();
      let consecutiveFailures = 0;
      let stopped = false;
      for (const group of groups) {
        if (stopped) break;
        for (const name of group.artists) {
          const key = youtubeKey(name);
          if (tried.has(key)) continue;
          if (report.youtube.artistsLookedUp >= config.youtubeMaxArtists || elapsed() >= YOUTUBE_PHASE_END_MS) {
            stopped = true;
            break;
          }
          if (report.youtube.artistsLookedUp > 0) await sleep(YOUTUBE_PACE_MS);
          tried.add(key);
          report.youtube.artistsLookedUp++;
          touchedEvents.add(group.eventId);
          try {
            const entry = await getOrMatchArtistYoutubePreview(name, youtubeCacheStore, youtubeClient, clock());
            consecutiveFailures = 0;
            if (entry.status === "accepted") break; // one video per event page
          } catch (err) {
            if (err instanceof youtubeClient.YoutubeDailyQuotaExhaustedError) {
              report.errors.push("YouTube-kvoten for search.list er opbrugt — resten tages i næste kørsel");
              stopped = true;
              break;
            }
            report.errors.push(`YouTube-opslag fejlede for "${name}": ${message(err)}`);
            if (++consecutiveFailures >= YOUTUBE_CONSECUTIVE_FAILURE_LIMIT) {
              stopped = true;
              break;
            }
          }
        }
      }
      report.youtube.remaining = new Set(groups.flatMap((g) => g.artists.map(youtubeKey)).filter((k) => !tried.has(k))).size;

      // Measured on the page's own read path, for the events this run touched.
      for (const e of list) {
        if (!touchedEvents.has(e.id) || withVideo.has(e.id)) continue;
        const shown = await getEventYoutubePreview(e);
        if (shown) report.youtube.added.push({ eventId: e.id, artistName: shown.artistName, videoId: shown.videoId });
      }
    } catch (err) {
      report.errors.push(`YouTube-delen fejlede: ${message(err)}`);
    }
  }

  const { subject, text } = formatDailyLinksReport(report, new Map(list.map((e) => [e.id, e])));
  console.log(`[daily-links] ${subject}\n${text}`);
  // Email only when there is something to act on: a new link or an error.
  // A quiet day is in the log only.
  let emailSent = false;
  if (shouldEmailDailyLinksReport(report)) {
    try {
      await (deps.send ?? sendEmail)({ subject, text, to: config.reportEmail });
      emailSent = true;
    } catch (err) {
      console.error(`[daily-links] report email failed: ${message(err)}`);
    }
  }
  return { ...report, emailSent };
}
