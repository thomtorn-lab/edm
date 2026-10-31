import { inArray, sql } from "drizzle-orm";
import { db } from "./client";
import { events, venues } from "./schema";
import { applySourceSyncPatch } from "./writes";
import { planDenAndenSideMigration, type DasEventSnapshot } from "@/lib/denAndenSideMigration";
import { DEN_ANDEN_SIDE_VENUE_ID, isSmallRoomVenueName } from "@/lib/denAndenSideRooms";

/**
 * One-time Den Anden Side room restructuring (2026-10-27), the counterpart
 * of src/db/cultureBoxRoomConsolidation.ts: every stored event at Den Anden
 * Side — published or not, past or upcoming, from any source or added by an
 * admin — plus any event filed under a separate "Den Anden Ende" venue row,
 * reviewed with the same pure logic every future import runs (planning in
 * src/lib/denAndenSideMigration.ts, room reading in
 * src/lib/denAndenSideRooms.ts).
 *
 * The room split is verified against each event's stored source text (the
 * description its source supplied) and title; nothing is inferred from
 * genre, artist or venue. Only title, description, artist order and — for a
 * stray "Den Anden Ende" venue — venueId are written, through
 * applySourceSyncPatch so admin-overridden fields stay untouched and every
 * write lands in event_change_log as "das-room-structure". IDs, slugs, URLs,
 * dates, genre and publish state are never touched; the stray venue row
 * itself is reported, not deleted.
 *
 * Usage (normally via .github/workflows/den-anden-side-rooms.yml):
 *   node --env-file=.env.local --import tsx src/db/denAndenSideRoomStructure.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/denAndenSideRoomStructure.ts --mode=apply --confirm=STRUCTURE-DEN-ANDEN-SIDE-ROOMS
 *
 * --mode=plan is read-only (no write is reachable in that branch) and prints every event's verdict, the exact patch,
 * the events needing manual review, and the same-night pairs to look at.
 */

const CHANGED_BY = "das-room-structure";
const CONFIRM = "STRUCTURE-DEN-ANDEN-SIDE-ROOMS";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const body = raw.slice(2);
    const i = body.indexOf("=");
    if (i === -1) out[body] = "true";
    else out[body.slice(0, i)] = body.slice(i + 1);
  }
  return out;
}

type Reader = Pick<typeof db, "select">;

async function loadSnapshots(q: Reader): Promise<{ snapshots: DasEventSnapshot[]; strayVenueIds: string[] }> {
  const venueRows = await q.select({ id: venues.id, name: venues.name, slug: venues.slug }).from(venues);
  const strayVenueIds = venueRows.filter((v) => v.id !== DEN_ANDEN_SIDE_VENUE_ID && (isSmallRoomVenueName(v.name) || v.slug === "den-anden-ende")).map((v) => v.id);
  const venueName = new Map(venueRows.map((v) => [v.id, v.name]));
  const ids = [DEN_ANDEN_SIDE_VENUE_ID, ...strayVenueIds];
  const rows = await q.select().from(events).where(inArray(events.venueId, ids));
  rows.sort((a, b) => a.startDatetime.getTime() - b.startDatetime.getTime());
  return {
    strayVenueIds,
    snapshots: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description,
      artists: r.artists,
      venueId: r.venueId,
      venueName: venueName.get(r.venueId) ?? null,
      startDatetime: r.startDatetime.toISOString(),
      published: r.published,
      cancelled: r.cancelled,
      overriddenFields: r.overriddenFields,
      canonicalSourceId: r.canonicalSourceId,
      officialEventUrl: r.officialEventUrl,
      residentAdvisorUrl: r.residentAdvisorUrl,
    })),
  };
}

function label(e: DasEventSnapshot): string {
  const day = e.startDatetime.slice(0, 10);
  const flags = [e.published ? "published" : "unpublished", e.cancelled ? "cancelled" : null].filter(Boolean).join(", ");
  return `${day}  ${e.id}  /events/${e.slug}  "${e.title}"  [${flags}; source ${e.canonicalSourceId ?? "admin"}]`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode !== "plan" && mode !== "apply") throw new Error('--mode must be "plan" or "apply"');
  if (mode === "apply" && args.confirm !== CONFIRM) throw new Error(`--mode=apply requires --confirm=${CONFIRM}`);

  // plan reads inside one READ ONLY transaction, verified with SHOW before
  // anything is read — Postgres itself rejects any write there (same guard
  // as the repo's read-only audit workflows). apply reads normally.
  const { snapshots, strayVenueIds } =
    mode === "plan"
      ? await db.transaction(async (tx) => {
          await tx.execute(sql`SET TRANSACTION READ ONLY`);
          const ro = await tx.execute(sql`SHOW transaction_read_only`);
          const value = (ro.rows[0] as { transaction_read_only?: string } | undefined)?.transaction_read_only;
          if (value !== "on") throw new Error(`Refusing to plan: transaction_read_only is "${value}", expected "on".`);
          console.log("Read-only transaction confirmed (transaction_read_only = on).");
          return loadSnapshots(tx);
        })
      : await loadSnapshots(db);
  const plan = planDenAndenSideMigration(snapshots);
  console.log(`Loaded ${snapshots.length} event(s) at Den Anden Side${strayVenueIds.length ? ` (incl. stray "Den Anden Ende" venue row(s): ${strayVenueIds.join(", ")})` : ""}.`);

  console.log("\n=== UPDATES ===");
  for (const p of plan.plans.filter((x) => x.outcome === "update")) {
    console.log("-".repeat(80));
    console.log(label(p.event));
    console.log(`verdict: ${p.verdict} — ${p.reason}`);
    console.log(JSON.stringify(p.patch, null, 2));
    if (mode === "apply") {
      const result = await applySourceSyncPatch(p.event.id, CHANGED_BY, p.patch);
      console.log(`APPLIED: ${result.applied.join(", ") || "(nothing)"}${result.skipped.length ? `; skipped (admin-locked): ${result.skipped.join(", ")}` : ""}`);
    }
  }

  console.log("\n=== NEEDS MANUAL REVIEW (combined lineup kept) ===");
  for (const p of plan.plans.filter((x) => x.outcome === "unresolved")) {
    console.log(`${label(p.event)}\n    ${p.reason}${p.event.residentAdvisorUrl ? `\n    RA: ${p.event.residentAdvisorUrl}` : ""}${p.event.officialEventUrl ? `\n    source: ${p.event.officialEventUrl}` : ""}`);
  }

  console.log("\n=== SAME NIGHT, SEPARATE ROOM EVENTS (left separate — check whether they are one club night) ===");
  for (const g of plan.sameNightGroups) {
    console.log(g.date);
    for (const e of g.events) console.log(`    ${label(e)}`);
  }

  const verdicts = new Map<string, number>();
  for (const p of plan.plans) verdicts.set(p.verdict, (verdicts.get(p.verdict) ?? 0) + 1);
  console.log("\n=== SUMMARY ===");
  console.log(`reviewed:   ${plan.counts.reviewed}`);
  console.log(`updated:    ${plan.counts.update}${mode === "plan" ? " (planned)" : ""}`);
  console.log(`unchanged:  ${plan.counts.unchanged}`);
  console.log(`unresolved: ${plan.counts.unresolved}`);
  console.log(`same-night pairs to check: ${plan.sameNightGroups.length}`);
  console.log(`by verdict: ${[...verdicts].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (strayVenueIds.length) console.log(`stray venue row(s) left in place (now unused once applied): ${strayVenueIds.join(", ")}`);
  if (mode === "plan") console.log(`\nPLAN ONLY — no writes were made. Re-run with --mode=apply --confirm=${CONFIRM} to apply.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
