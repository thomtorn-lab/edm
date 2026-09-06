import { eq } from "drizzle-orm";
import { db } from "./client";
import { events } from "./schema";
import { adminUnpublishEvent } from "./writes";

/**
 * One-time Production admin-unpublish of the reference case for the admin
 * unpublish/cancellation safety work package, 2026-09-06: "Jasho Club //
 * Poolen Outside" (e-c098bf44, KultuNaut-sourced, Poolen). Uses the exact
 * same sanctioned adminUnpublishEvent() write path the new admin UI's
 * UNPUBLISH button calls — this script only exists because that UI isn't
 * directly reachable from this environment; it performs no write the UI
 * itself couldn't. Never deletes the event, never touches
 * source_event_links or any other record.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/jashoClubUnpublish.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/jashoClubUnpublish.ts --mode=apply --confirm=JASHO-CLUB-UNPUBLISH-2026-09-06
 */

const EVENT_ID = "e-c098bf44";
const EXPECTED_TITLE = "Jasho Club // Poolen Outside";

function parseArgs(argv: string[]): Record<string, string> {
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

async function loadEvent(id: string) {
  const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return row ?? null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode !== "plan" && mode !== "apply") {
    throw new Error('--mode must be "plan" or "apply"');
  }
  if (mode === "apply" && args.confirm !== "JASHO-CLUB-UNPUBLISH-2026-09-06") {
    throw new Error("--mode=apply requires --confirm=JASHO-CLUB-UNPUBLISH-2026-09-06");
  }

  console.log("\n" + "=".repeat(80));
  console.log(`ADMIN UNPUBLISH: ${EVENT_ID}`);
  console.log("=".repeat(80));

  const before = await loadEvent(EVENT_ID);
  if (!before) {
    console.log(`SKIP: event ${EVENT_ID} not found.`);
    return;
  }
  console.log("Before:", {
    id: before.id,
    title: before.title,
    published: before.published,
    adminUnpublishReason: before.adminUnpublishReason,
    adminUnpublishedAt: before.adminUnpublishedAt,
  });

  if (before.title !== EXPECTED_TITLE) {
    throw new Error(`Refusing: title mismatch. Expected "${EXPECTED_TITLE}", found "${before.title}".`);
  }
  if (!before.published) {
    console.log("SKIP: already published=false — nothing to do (re-run adminRepublishEvent first if this needs to change).");
    return;
  }

  console.log(`Intended: adminUnpublishEvent("${EVENT_ID}", "cancelled")`);
  if (mode === "apply") {
    await adminUnpublishEvent(EVENT_ID, "cancelled");
    const after = await loadEvent(EVENT_ID);
    console.log("  APPLIED. Read-back:", after
      ? {
          id: after.id,
          title: after.title,
          published: after.published,
          adminUnpublishReason: after.adminUnpublishReason,
          adminUnpublishedAt: after.adminUnpublishedAt,
          manualOverride: after.manualOverride,
          overriddenFields: after.overriddenFields,
        }
      : null);
  }

  console.log("\n" + (mode === "plan" ? "PLAN ONLY — no writes were made." : "APPLY complete — see APPLIED/read-back line above for what actually changed."));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
