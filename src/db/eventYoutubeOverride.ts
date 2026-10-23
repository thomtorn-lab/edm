import { fileURLToPath } from "node:url";
import {
  applyVerification,
  clearEventOverride,
  findEvent,
  getArtistCacheRow,
  getArtistCacheRows,
  getOverride,
  hideEventVideo,
  listUpcomingPublishedEvents,
  listVideoOverrides,
  setEventVideo,
  unpinArtistPreviewRow,
  type EventSummary,
} from "./eventYoutubeOverrides";
import { getVideoDetails, getVideoSnippet, type YoutubeVideoSnippet } from "@/lib/enrichment/youtubeClient";
import { cleanArtistDisplayName, normalizeArtistName } from "@/lib/enrichment/youtubePreviewMatching";
import { isVideoPlayable, parseEventRef, parseYoutubeVideoId, planVerification, resolveEventOverride } from "@/lib/eventYoutubeOverride";

/**
 * Confirm-gated admin CLI for per-event YouTube videos (2026-10-23), run by
 * .github/workflows/event-youtube-override.yml. A chosen video applies to ONE
 * event only and never touches the per-artist cache the automated matcher
 * uses — see src/lib/eventYoutubeOverride.ts for the display rules.
 *
 *   --mode=plan   --event=<id|slug|event URL> [--video=<url|id>]   read-only
 *   --mode=set    --event=… --video=… [--artist="Lineup name"] --confirm=SET-EVENT-YOUTUBE-VIDEO
 *   --mode=hide   --event=… --confirm=HIDE-EVENT-YOUTUBE-VIDEO      no video on this event
 *   --mode=clear  --event=… --confirm=CLEAR-EVENT-YOUTUBE-VIDEO     back to automated matching
 *   --mode=verify-plan                                               read-only, no YouTube calls
 *   --mode=verify --confirm=VERIFY-EVENT-YOUTUBE-VIDEOS              weekly availability check
 *   --mode=migrate-artist-pin-plan --artist=… --event=… --video=…    read-only
 *   --mode=migrate-artist-pin --artist=… --event=… --video=… [--assert-blocked="LMN"] --confirm=MIGRATE-ARTIST-PIN
 *
 * YouTube is only ever called through videos.list (1 quota unit per call,
 * up to 50 ids) — never search.list, whose quota the automated matcher and
 * backfill depend on.
 *
 * migrate-artist-pin moves an artist-level pin (artist_youtube_preview_cache
 * row with matchRule "manual", written by the never-merged pin mode of
 * PR #163) onto one event, in an order that never leaves that event without
 * its video: (1) the event override is written and re-read, (2) only then is
 * the artist row handed back to automated matching. Re-running it after a
 * partial failure, or after it completed, is safe.
 */

const CONFIRM_TOKENS = {
  set: "SET-EVENT-YOUTUBE-VIDEO",
  hide: "HIDE-EVENT-YOUTUBE-VIDEO",
  clear: "CLEAR-EVENT-YOUTUBE-VIDEO",
  verify: "VERIFY-EVENT-YOUTUBE-VIDEOS",
  "migrate-artist-pin": "MIGRATE-ARTIST-PIN",
} as const;

/** videos.list accepts at most 50 ids per call. */
const VERIFY_CHUNK = 50;
/** Fail-safe ceiling for one verify run (10 videos.list calls). Far above any realistic number of hand-picked videos. */
export const VERIFY_MAX_OVERRIDES = 500;

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const body = raw.slice(2);
    const eqIdx = body.indexOf("=");
    if (eqIdx === -1) out[body] = "true";
    else out[body.slice(0, eqIdx)] = body.slice(eqIdx + 1);
  }
  return out;
}

function requireConfirm(mode: keyof typeof CONFIRM_TOKENS, args: Record<string, string>): void {
  if (args.confirm !== CONFIRM_TOKENS[mode]) throw new Error(`--mode=${mode} requires --confirm=${CONFIRM_TOKENS[mode]}`);
}

async function requireEvent(args: Record<string, string>): Promise<EventSummary> {
  if (!args.event) throw new Error("--event=<event id, slug or event page URL> is required.");
  const ref = parseEventRef(args.event);
  if (!ref) throw new Error(`--event="${args.event}" is not an event id (e-xxxxxxxx), slug or event page URL.`);
  const event = await findEvent(ref);
  if (!event) throw new Error(`No event found for --event="${args.event}".`);
  return event;
}

function requireVideoId(args: Record<string, string>): string {
  if (!args.video) throw new Error("--video=<YouTube URL or video id> is required.");
  const id = parseYoutubeVideoId(args.video);
  if (!id) throw new Error(`--video="${args.video}" is not a YouTube video URL or id.`);
  return id;
}

/** Looks the video up and refuses anything unknown, private, unlisted or not embeddable. */
async function requirePlayableVideo(videoId: string): Promise<YoutubeVideoSnippet> {
  const video = await getVideoSnippet(videoId);
  if (!video) throw new Error(`YouTube has no video with id ${videoId}.`);
  console.log(`Video ${videoId}: ${JSON.stringify(video)}`);
  if (!isVideoPlayable(video)) {
    throw new Error(`Video ${videoId} is not public and embeddable (privacyStatus=${video.privacyStatus}, embeddable=${video.embeddable}).`);
  }
  return video;
}

/** The exact lineup name a normalized artist name refers to on this event, or null. */
function lineupNameFor(event: EventSummary, artistRaw: string): string | null {
  const wanted = normalizeArtistName(cleanArtistDisplayName(artistRaw));
  return event.artists.find((name) => normalizeArtistName(cleanArtistDisplayName(name)) === wanted) ?? null;
}

async function printEventState(label: string, event: EventSummary): Promise<void> {
  const override = await getOverride(event.id);
  const decision = resolveEventOverride(override);
  console.log(`${label} — event ${event.id} "${event.title}" (${event.slug}), starts ${event.startDatetime.toISOString()}, published=${event.published}`);
  console.log(`  override: ${override ? JSON.stringify(override) : "(none)"}`);
  if (decision.kind === "video") console.log(`  page shows: override video ${decision.videoId} "${decision.videoTitle ?? ""}"`);
  else if (decision.kind === "none") console.log("  page shows: no video (override hides it, or the chosen video is unavailable)");
  else {
    const normalized = event.artists.map((n) => normalizeArtistName(cleanArtistDisplayName(n)));
    const rows = new Map((await getArtistCacheRows(normalized)).map((r) => [r.artistNameNormalized, r]));
    const first = normalized.find((n) => {
      const r = rows.get(n);
      return r && r.status === "accepted" && !r.manualBlock && r.videoId;
    });
    console.log(`  page shows: automated artist match — ${first ? `"${first}" -> ${rows.get(first)!.videoId} "${rows.get(first)!.videoTitle ?? ""}"` : "none"}`);
    for (const n of normalized) {
      const r = rows.get(n);
      console.log(`    ${n}: ${r ? `status=${r.status} rule=${r.matchRule} video=${r.videoId} block=${r.manualBlock}` : "(no cache row)"}`);
    }
  }
}

async function printArtistRow(label: string, normalized: string): Promise<void> {
  const row = await getArtistCacheRow(normalized);
  console.log(
    `${label} artist cache row "${normalized}": ${
      row
        ? JSON.stringify({ status: row.status, matchRule: row.matchRule, videoId: row.videoId, videoTitle: row.videoTitle, manualBlock: row.manualBlock, expiresAt: row.expiresAt })
        : "(none)"
    }`,
  );
}

async function verifyOverrides(write: boolean): Promise<void> {
  const rows = await listVideoOverrides();
  console.log(`${rows.length} video override(s) to check.`);
  if (rows.length > VERIFY_MAX_OVERRIDES) {
    throw new Error(`${rows.length} video overrides exceeds the ${VERIFY_MAX_OVERRIDES} fail-safe ceiling — nothing checked or written.`);
  }
  if (!write) {
    for (const r of rows) console.log(`  ${r.eventId}  ${r.videoId}  available=${r.available}`);
    return;
  }
  if (rows.length === 0) return;
  const ids = [...new Set(rows.map((r) => r.videoId))];
  const statuses = [];
  for (let i = 0; i < ids.length; i += VERIFY_CHUNK) statuses.push(...(await getVideoDetails(ids.slice(i, i + VERIFY_CHUNK))));
  const updates = planVerification(rows, statuses, new Date());
  await applyVerification(updates);
  for (const u of updates) {
    const line = `${u.eventId}  ${u.videoId}  available=${u.available}${u.changed ? " (changed)" : ""}`;
    if (!u.available) console.log(`::warning::Event video unavailable — hidden on the event until it verifies again or is replaced: ${line}`);
    else console.log(`  ${line}`);
  }
  console.log(`${updates.filter((u) => u.changed).length} changed, ${updates.filter((u) => !u.available).length} unavailable.`);
}

async function migrateArtistPin(args: Record<string, string>, write: boolean): Promise<void> {
  if (!args.artist) throw new Error('--artist="Exact lineup name" is required.');
  const event = await requireEvent(args);
  const videoId = requireVideoId(args);
  const normalized = normalizeArtistName(cleanArtistDisplayName(args.artist));
  const lineupName = lineupNameFor(event, args.artist);
  if (!lineupName) throw new Error(`"${args.artist}" is not in the lineup of ${event.id} (${event.artists.join(", ")}).`);

  const artistRow = await getArtistCacheRow(normalized);
  const override = await getOverride(event.id);
  const isPinned = artistRow?.matchRule === "manual";
  const overrideHasVideo = override?.mode === "video" && override.videoId === videoId;

  await printArtistRow("Current", normalized);
  await printEventState("Current", event);
  const others = (await listUpcomingPublishedEvents()).filter((e) => e.id !== event.id && lineupNameFor(e, args.artist!) !== null);
  console.log(`Other upcoming published events with "${args.artist}" in the lineup: ${others.length}`);
  for (const e of others) await printEventState("  other", e);

  if (isPinned && artistRow.videoId !== videoId) {
    throw new Error(`The artist pin is on video ${artistRow.videoId}, not ${videoId} — refusing to move a different video.`);
  }
  if (override && !overrideHasVideo) {
    throw new Error(`Event ${event.id} already has a different override (${override.mode} ${override.videoId ?? ""}) — refusing to overwrite it.`);
  }
  if (!isPinned && overrideHasVideo) {
    console.log("Already migrated: the event has the video and the artist row is not pinned. Nothing to do.");
    return;
  }
  if (!isPinned) throw new Error(`"${normalized}" has no artist-level pin (matchRule=${artistRow?.matchRule ?? "no row"}) — nothing to migrate.`);

  for (const blocked of (args["assert-blocked"] ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const row = await getArtistCacheRow(normalizeArtistName(cleanArtistDisplayName(blocked)));
    if (!row?.manualBlock) throw new Error(`Expected "${blocked}" to be manually blocked, but it is not — stopping before any write.`);
    console.log(`Confirmed still blocked: "${blocked}".`);
  }

  if (!write) {
    console.log(`Plan: (1) set event ${event.id} override to ${videoId} for "${lineupName}"; (2) hand "${normalized}" back to automated matching.`);
    return;
  }

  const video = await requirePlayableVideo(videoId);
  // Step 1: the event gets its own copy of the video first, so it never goes without one.
  if (!overrideHasVideo) await setEventVideo(event.id, video, lineupName);
  const written = await getOverride(event.id);
  if (written?.mode !== "video" || written.videoId !== videoId || !written.available) {
    throw new Error("Event override did not read back as expected — the artist row was left untouched.");
  }
  // Step 2: only now release the artist.
  await unpinArtistPreviewRow(artistRow);

  await printArtistRow("After", normalized);
  await printEventState("After", event);
}

/** Core dispatch, separated from main() so it's unit-testable without argv/process.exit side effects. */
export async function run(args: Record<string, string>): Promise<void> {
  const mode = args.mode;

  if (mode === "plan") {
    const event = await requireEvent(args);
    await printEventState("Current", event);
    if (args.video) await getVideoSnippet(requireVideoId(args)).then((v) => console.log(`Video lookup: ${v ? JSON.stringify(v) : "(unknown id)"}`));
    return;
  }

  if (mode === "set") {
    requireConfirm("set", args);
    const event = await requireEvent(args);
    const videoId = requireVideoId(args);
    let artistName: string | null = null;
    if (args.artist) {
      artistName = lineupNameFor(event, args.artist);
      if (!artistName) throw new Error(`"${args.artist}" is not in the lineup of ${event.id} (${event.artists.join(", ")}).`);
    }
    const video = await requirePlayableVideo(videoId);
    await printEventState("Before", event);
    await setEventVideo(event.id, video, artistName);
    await printEventState("After", event);
    return;
  }

  if (mode === "hide" || mode === "clear") {
    requireConfirm(mode, args);
    const event = await requireEvent(args);
    await printEventState("Before", event);
    if (mode === "hide") await hideEventVideo(event.id);
    else await clearEventOverride(event.id);
    await printEventState("After", event);
    return;
  }

  if (mode === "verify-plan") return verifyOverrides(false);
  if (mode === "verify") {
    requireConfirm("verify", args);
    return verifyOverrides(true);
  }

  if (mode === "migrate-artist-pin-plan") return migrateArtistPin(args, false);
  if (mode === "migrate-artist-pin") {
    requireConfirm("migrate-artist-pin", args);
    return migrateArtistPin(args, true);
  }

  throw new Error("--mode=<plan|set|hide|clear|verify-plan|verify|migrate-artist-pin-plan|migrate-artist-pin> is required.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    await run(args);
  } catch (err) {
    console.error("::error::", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  process.exit(0); // the pooled DB client would otherwise keep the process alive
}

// Only auto-run when executed directly, never on import (keeps run() testable).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("::error::eventYoutubeOverride.ts FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
