import { NextRequest, NextResponse } from "next/server";
import { runSourceSync } from "@/db/sync";
import { createHangarenAdapter, HANGAREN_SOURCE_ID } from "@/lib/adapters/hangarenAdapter";
import { createCultureBoxAdapter, CULTURE_BOX_SOURCE_ID } from "@/lib/adapters/cultureBoxAdapter";
import { createPoolenAdapter, POOLEN_SOURCE_ID } from "@/lib/adapters/poolenAdapter";
import type { SourceAdapter } from "@/lib/adapters/types";

/**
 * Scheduling entry point (task 5): an external scheduler (cron, GitHub
 * Actions, etc.) calls this on `sources.syncFrequency` per source. Only
 * sources with a real, verified adapter are wired here — see
 * src/lib/data/sources.ts's `integrationNote` for why the others aren't.
 */
const ADAPTERS: Record<string, { sourceId: string; displayName: string; create: () => SourceAdapter }> = {
  hangaren: { sourceId: HANGAREN_SOURCE_ID, displayName: "Hangaren", create: createHangarenAdapter },
  "culture-box": { sourceId: CULTURE_BOX_SOURCE_ID, displayName: "Culture Box", create: createCultureBoxAdapter },
  poolen: { sourceId: POOLEN_SOURCE_ID, displayName: "Poolen", create: createPoolenAdapter },
};

export async function POST(request: NextRequest, context: { params: Promise<{ source: string }> }) {
  const token = process.env.SYNC_TRIGGER_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "SYNC_TRIGGER_TOKEN is not configured." }, { status: 500 });
  }
  if (request.headers.get("x-sync-token") !== token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { source } = await context.params;
  const entry = ADAPTERS[source];
  if (!entry) {
    return NextResponse.json({ error: `No adapter wired for source "${source}".` }, { status: 404 });
  }

  const summary = await runSourceSync(entry.sourceId, entry.displayName, entry.create());

  // ok/skipped_concurrent are 200s — a concurrent-run skip is expected,
  // benign behavior, not something a scheduler should alert on. failed/
  // zero_events return non-2xx so the calling workflow's own failure
  // handling (a red GitHub Actions run, retries, notifications) surfaces
  // them — this endpoint's response is the "failure logging" a plain
  // console.error inside the process wouldn't otherwise expose externally.
  const status = summary.outcome === "failed" ? 502 : summary.outcome === "zero_events" ? 503 : 200;
  return NextResponse.json(summary, { status });
}
