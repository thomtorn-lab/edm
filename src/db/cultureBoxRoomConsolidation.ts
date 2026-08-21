import { eq } from "drizzle-orm";
import { db } from "./client";
import { events } from "./schema";
import { applySourceSyncPatch, setEventPublished, updateSourceLinkUrl } from "./writes";
import { buildConsolidationPatch, findCultureBoxRoomPairs, type CultureBoxEventSnapshot } from "@/lib/cultureBoxConsolidation";

/**
 * One-time, Culture-Box-only transition (partner-ready polish pass, task
 * "Culture Box — transition cleanup"): before the room-consolidated adapter
 * went live, some Culture Box nights had both rooms published as separate
 * canonical events. This script finds any such pair still live (pure
 * detection/patch logic in src/lib/cultureBoxConsolidation.ts, independently
 * unit-tested) and, in --mode=apply, merges each pair down to the single
 * survivor event the new adapter would itself produce, then hides the
 * obsolete sibling — never a general rooms/stages architecture change, never
 * touching dedup.ts/pipeline.ts, never touching any other night or source.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/cultureBoxRoomConsolidation.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/cultureBoxRoomConsolidation.ts --mode=apply --confirm=CONSOLIDATE-CULTURE-BOX-ROOMS
 *
 * --mode=plan is entirely read-only (no write statement is even reachable in
 * that branch) and prints the exact pairs found and the patch each would
 * receive, for review before ever running --mode=apply. --mode=apply
 * requires the exact confirmation string, matching this repo's existing
 * confirm-gate convention for one-time Production actions.
 */

const SOURCE_ID = "src-culture-box";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const body = raw.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) out[body] = "true";
    else out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return out;
}

async function loadSnapshots(): Promise<CultureBoxEventSnapshot[]> {
  const rows = await db.select().from(events).where(eq(events.canonicalSourceId, SOURCE_ID));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    artists: r.artists,
    venueId: r.venueId,
    startDatetime: r.startDatetime.toISOString(),
    officialEventUrl: r.officialEventUrl,
    ticketUrl: r.ticketUrl,
    residentAdvisorUrl: r.residentAdvisorUrl,
    facebookUrl: r.facebookUrl,
    imageUrl: r.imageUrl,
    priceFrom: r.priceFrom,
    published: r.published,
    cancelled: r.cancelled,
    manualOverride: r.manualOverride,
    overriddenFields: r.overriddenFields,
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode !== "plan" && mode !== "apply") {
    throw new Error('--mode must be "plan" or "apply"');
  }

  const snapshots = await loadSnapshots();
  console.log(`Loaded ${snapshots.length} src-culture-box events.`);

  const pairs = findCultureBoxRoomPairs(snapshots);
  console.log(`\nFound ${pairs.length} room pair(s) to consolidate.\n`);

  for (const pair of pairs) {
    const patch = buildConsolidationPatch(pair);
    console.log("=".repeat(80));
    console.log(`Survivor (kept):    ${pair.survivor.id}  "${pair.survivor.title}"`);
    console.log(`Obsolete (hidden):  ${pair.obsolete.id}  "${pair.obsolete.title}"`);
    console.log(`Reason:             ${pair.reason}`);
    console.log("-- patch applied to survivor --");
    console.log(JSON.stringify(patch, null, 2));
    console.log("-- other effects --");
    console.log(`source_event_links: (${SOURCE_ID}, official) for ${pair.survivor.id} -> "${patch.officialEventUrl}"`);
    console.log(`${pair.obsolete.id}: published set to false (setEventPublished, logged as "unpublish")`);
    console.log(`${pair.obsolete.id}'s own source_event_links row (its original per-room URL) is left untouched — provenance preserved.`);

    if (mode === "apply") {
      if (args.confirm !== "CONSOLIDATE-CULTURE-BOX-ROOMS") {
        throw new Error('--mode=apply requires --confirm=CONSOLIDATE-CULTURE-BOX-ROOMS');
      }
      await applySourceSyncPatch(pair.survivor.id, SOURCE_ID, {
        title: patch.title,
        description: patch.description,
        artists: patch.artists,
        officialEventUrl: patch.officialEventUrl,
        ticketUrl: patch.ticketUrl,
        residentAdvisorUrl: patch.residentAdvisorUrl,
        facebookUrl: patch.facebookUrl,
        imageUrl: patch.imageUrl,
        priceFrom: patch.priceFrom,
      });
      await updateSourceLinkUrl(pair.survivor.id, SOURCE_ID, "official", patch.officialEventUrl);
      await setEventPublished(pair.obsolete.id, false);
      console.log(`APPLIED: ${pair.survivor.id} consolidated, ${pair.obsolete.id} hidden.`);
    }
  }

  if (pairs.length === 0) {
    console.log("Nothing to do — no qualifying room pair found.");
  } else if (mode === "plan") {
    console.log("\nPLAN ONLY — no writes were made. Re-run with --mode=apply --confirm=CONSOLIDATE-CULTURE-BOX-ROOMS to apply.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
