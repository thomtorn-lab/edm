import { fileURLToPath } from "node:url";
import { blockSoundcloudProfile, describeSoundcloudProfile, unblockSoundcloudProfile } from "./soundcloudLinks";
import { soundcloudProfileUrl } from "@/lib/adapters/cultureBoxSoundcloudLinks";

/**
 * Confirm-gated admin CLI for removing a wrong venue-provided SoundCloud link
 * without a code deploy (2026-10-13), run by
 * .github/workflows/soundcloud-link-block.yml. Blocks are keyed by the
 * normalized profile URL and live in soundcloud_link_blocks, which the sync
 * never touches — so a block hides that profile on every event and survives
 * every later sync, until unblocked. Pages read the block on every request,
 * so the effect is immediate.
 *
 *   node --env-file=.env.local --import tsx src/db/soundcloudLinkBlock.ts --mode=plan --url=https://soundcloud.com/handle
 *   node --env-file=.env.local --import tsx src/db/soundcloudLinkBlock.ts --mode=block --url=https://soundcloud.com/handle --reason="wrong artist" --confirm=BLOCK-SOUNDCLOUD-LINK
 *   node --env-file=.env.local --import tsx src/db/soundcloudLinkBlock.ts --mode=unblock --url=https://soundcloud.com/handle --confirm=UNBLOCK-SOUNDCLOUD-LINK
 *
 * --mode=plan (the workflow's default) only reads. --url accepts any form of
 * the profile link (www./m., trailing slash, query string) and is normalized
 * exactly like the adapter normalizes stored links.
 */

const CONFIRM_TOKENS = { block: "BLOCK-SOUNDCLOUD-LINK", unblock: "UNBLOCK-SOUNDCLOUD-LINK" } as const;

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

async function printState(label: string, url: string): Promise<void> {
  const { block, links } = await describeSoundcloudProfile(url);
  console.log(`${label} (${url}):`);
  console.log(`  block: ${block ? JSON.stringify(block) : "(none)"}`);
  console.log(`  stored links using this profile: ${links.length}`);
  for (const l of links) console.log(`    ${l.eventId}  ${l.sourceId}  ${l.artistName}`);
}

/** Core dispatch, separated from main() so it's unit-testable without argv/process.exit side effects. */
export async function run(args: Record<string, string>): Promise<void> {
  const mode = args.mode;
  if (!args.url) throw new Error("--url=https://soundcloud.com/<handle> is required.");
  const normalized = soundcloudProfileUrl(args.url);
  if (!("url" in normalized)) throw new Error(`--url is not a SoundCloud profile URL (${normalized.rejected}).`);
  const url = normalized.url;

  if (mode === "plan") {
    await printState("Current state", url);
    return;
  }

  if (mode === "block" || mode === "unblock") {
    const expectedToken = CONFIRM_TOKENS[mode];
    if (args.confirm !== expectedToken) {
      throw new Error(`--mode=${mode} requires --confirm=${expectedToken}`);
    }
    await printState("Before", url);
    if (mode === "block") await blockSoundcloudProfile(url, args.reason?.trim() || null);
    else await unblockSoundcloudProfile(url);
    await printState("After", url);
    return;
  }

  throw new Error("--mode=<plan|block|unblock> is required.");
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

// Only auto-run when executed directly, never on import (keeps run() testable).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("::error::soundcloudLinkBlock.ts FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
