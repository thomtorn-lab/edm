import { NextRequest, NextResponse } from "next/server";
import { runSourceSync } from "@/db/sync";
import { createHangarenAdapter, HANGAREN_SOURCE_ID } from "@/lib/adapters/hangarenAdapter";

/**
 * Scheduling entry point (task 5): an external scheduler (cron, GitHub
 * Actions, etc.) calls this on `sources.syncFrequency` per source. Only
 * sources with a real, verified adapter are wired here — see
 * src/lib/data/sources.ts's `integrationNote` for why the others aren't.
 */
const ADAPTERS: Record<string, { sourceId: string; displayName: string; create: () => ReturnType<typeof createHangarenAdapter> }> = {
  hangaren: { sourceId: HANGAREN_SOURCE_ID, displayName: "Hangaren", create: createHangarenAdapter },
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
  return NextResponse.json(summary);
}
