import { fileURLToPath } from "node:url";
import { drizzleCacheStore, blockArtistYoutubePreview, unblockArtistYoutubePreview, pinArtistYoutubePreview } from "./youtubePreview";
import { normalizeArtistName, cleanArtistDisplayName } from "@/lib/enrichment/youtubePreviewMatching";
import { getVideoSnippet, type YoutubeVideoSnippet } from "@/lib/enrichment/youtubeClient";

/**
 * Minimal, confirm-gated admin CLI wiring up the existing manualBlock
 * override (src/db/youtubePreview.ts::blockArtistYoutubePreview /
 * unblockArtistYoutubePreview, added 2026-09-25 — "cheap admin override,
 * no dedicated admin screen in V1") to something actually invocable: no
 * route, script, or workflow ever reached those two functions before this
 * file. This is a thin wrapper only — no new business logic, no new write
 * path. Sets/clears manualBlock on exactly ONE artist's
 * artist_youtube_preview_cache row; never touches `events` or
 * `discovery_queue`, and never calls YouTube (block/unblock are pure
 * cache-table writes — see both functions' own bodies). Fully reversible:
 * --mode=unblock exactly undoes --mode=block. The public query path
 * (src/lib/queries.ts::hasUsableYoutubePreview) already excludes any row
 * with manualBlock=true, so blocking an artist removes their preview from
 * the public site immediately without deleting the underlying match
 * evidence — a later corrected re-match can still land in the same row
 * once unblocked and the artist is naturally re-looked-up (cache expiry or
 * a fresh createEvent/Discovery-enrichment pass).
 *
 * Root cause this exists to correct (2026-09-29 investigation): Rule A's
 * exact-title-phrase check can match a short artist name that is merely a
 * strict PREFIX of a different, longer stage name in a video title (e.g.
 * "Benji" matching inside "Benji B | Boiler Room London") — a false-positive
 * class distinct from the existing multi-billing and generic-name-collision
 * guards. See this repo's own YouTube-preview investigation notes for the
 * concrete case this tool was built to correct. The matching-logic fix
 * itself is a separate, not-yet-approved change — this tool only corrects
 * the resulting cache row.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/youtubePreviewBlock.ts --mode=plan --artist="Exact Artist Name"
 *   node --env-file=.env.local --import tsx src/db/youtubePreviewBlock.ts --mode=block --artist="Exact Artist Name" --confirm=BLOCK-YOUTUBE-PREVIEW
 *   node --env-file=.env.local --import tsx src/db/youtubePreviewBlock.ts --mode=unblock --artist="Exact Artist Name" --confirm=UNBLOCK-YOUTUBE-PREVIEW
 *
 * --mode=plan is entirely read-only: prints the current cache row (or "no
 * cache row") for the named artist and exits — no write statement is even
 * reachable in that branch. --mode=block/unblock require the literal
 * --confirm token (this codebase's established one-time-script safety
 * convention — see src/db/tonserCleanup.ts) and print the row both before
 * and after the write, so the effect is visible in the same log.
 *
 * --mode=pin (2026-10-23) replaces the artist's preview with a hand-picked
 * video (src/db/youtubePreview.ts::pinArtistYoutubePreview) — for when
 * blocking a wrong match should leave a right one in its place:
 *   node --env-file=.env.local --import tsx src/db/youtubePreviewBlock.ts --mode=pin --artist="Exact Artist Name" --video="https://youtu.be/<id>" --confirm=PIN-YOUTUBE-PREVIEW
 * It looks the video up first (one videos.list call, needs YOUTUBE_API_KEY)
 * and refuses an unknown, private or non-embeddable one. --mode=plan with
 * --video prints that same lookup without writing anything, so the video's
 * title/channel can be checked before pinning.
 */

const CONFIRM_TOKENS = { block: "BLOCK-YOUTUBE-PREVIEW", unblock: "UNBLOCK-YOUTUBE-PREVIEW", pin: "PIN-YOUTUBE-PREVIEW" } as const;

/** Video id from a bare id or a youtu.be / youtube.com watch, embed, shorts or live URL; null if none. */
export function parseYoutubeVideoId(input: string): string | null {
  const raw = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = url.pathname.split("/");
    id = first === "watch" ? url.searchParams.get("v") : ["embed", "shorts", "live", "v"].includes(first) ? (second ?? null) : null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

async function lookUpVideo(videoArg: string): Promise<YoutubeVideoSnippet> {
  const videoId = parseYoutubeVideoId(videoArg);
  if (!videoId) throw new Error(`--video="${videoArg}" is not a YouTube video URL or id.`);
  const video = await getVideoSnippet(videoId);
  if (!video) throw new Error(`YouTube has no video with id ${videoId}.`);
  console.log(`Video ${videoId}:`);
  console.log(JSON.stringify(video, null, 2));
  return video;
}

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

async function printRow(label: string, artistRaw: string): Promise<void> {
  const normalized = normalizeArtistName(cleanArtistDisplayName(artistRaw));
  const row = await drizzleCacheStore.get(normalized);
  console.log(`${label} (normalized: "${normalized}"):`);
  console.log(
    row
      ? JSON.stringify(
          { status: row.status, videoId: row.videoId, videoTitle: row.videoTitle, channelTitle: row.channelTitle, manualBlock: row.manualBlock, expiresAt: row.expiresAt },
          null,
          2,
        )
      : "  (no cache row)",
  );
}

/** Core dispatch, separated from main() so it's unit-testable without argv/process.exit side effects. */
export async function run(args: Record<string, string>): Promise<void> {
  const mode = args.mode;
  const artist = typeof args.artist === "string" ? args.artist : null;
  if (!artist) throw new Error('--artist="Exact Artist Name" is required.');

  if (mode === "plan") {
    await printRow("Current cache row", artist);
    if (typeof args.video === "string" && args.video) await lookUpVideo(args.video);
    return;
  }

  if (mode === "pin") {
    if (args.confirm !== CONFIRM_TOKENS.pin) throw new Error(`--mode=pin requires --confirm=${CONFIRM_TOKENS.pin}`);
    if (typeof args.video !== "string" || !args.video) throw new Error('--mode=pin requires --video="<YouTube URL or id>".');
    const video = await lookUpVideo(args.video);
    if (video.privacyStatus !== "public" || !video.embeddable) {
      throw new Error(`Video ${video.videoId} is not public and embeddable (privacyStatus=${video.privacyStatus}, embeddable=${video.embeddable}) — not pinned.`);
    }
    await printRow("Before", artist);
    await pinArtistYoutubePreview(artist, video);
    await printRow("After", artist);
    return;
  }

  if (mode === "block" || mode === "unblock") {
    const expectedToken = CONFIRM_TOKENS[mode];
    if (args.confirm !== expectedToken) {
      throw new Error(`--mode=${mode} requires --confirm=${expectedToken}`);
    }
    await printRow("Before", artist);
    if (mode === "block") await blockArtistYoutubePreview(artist);
    else await unblockArtistYoutubePreview(artist);
    await printRow("After", artist);
    return;
  }

  throw new Error("--mode=<plan|block|unblock|pin> is required.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    await run(args);
  } catch (err) {
    console.error("::error::", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// Only auto-run when this file is executed directly, never on import — lets
// run()/parseArgs() be unit-tested without triggering the CLI's argv parsing.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("::error::youtubePreviewBlock.ts FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
