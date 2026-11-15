import { NextRequest, NextResponse } from "next/server";
import {
  EventSoundcloudAdminError,
  getEventSoundcloudAdminState,
  setEventSoundcloudLinks,
  type EventSoundcloudAdminState,
} from "@/db/eventSoundcloudAdmin";

/**
 * Admin-entered artist SoundCloud links for one event (2026-11-15) — see
 * src/db/eventSoundcloudAdmin.ts. Gated by the same Basic Auth proxy as every
 * other /api/admin/* route (src/proxy.ts).
 *
 *   GET                                        lineup + saved admin links
 *   PUT  { links: [{ artistName, url }] }      replace this event's admin links (empty url clears one)
 *
 * Every answer that succeeds carries the state after the change.
 */

type Context = { params: Promise<{ id: string }> };

async function respond(action: () => Promise<EventSoundcloudAdminState>, failure: string) {
  try {
    return NextResponse.json({ ok: true, state: await action() });
  } catch (err) {
    if (err instanceof EventSoundcloudAdminError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(`[soundcloud-admin] ${failure}: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: failure }, { status: 500 });
  }
}

export async function GET(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  return respond(() => getEventSoundcloudAdminState(id), "Couldn't load this event's SoundCloud links.");
}

export async function PUT(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  return respond(() => setEventSoundcloudLinks(id, body?.links), "Saving the SoundCloud links failed — reload to see the current state.");
}
