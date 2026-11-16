import { NextRequest, NextResponse } from "next/server";
import {
  EventSoundcloudAdminError,
  getEventSoundcloudAdminState,
  removeManualSoundcloudLink,
  setManualSoundcloudLink,
  type EventSoundcloudAdminState,
} from "@/db/eventSoundcloudAdmin";

/**
 * Manual SoundCloud profile links for one event's lineup (2026-11-16), used
 * by the event's admin edit view (EventSoundcloudPanel). Admin-only: /api/admin
 * is gated by src/proxy.ts. Rules live in src/db/eventSoundcloudAdmin.ts.
 *   GET                                  -> the lineup with manual and automatic links
 *   PUT    { artistName, url }           -> add or change the manual link
 *   DELETE { artistName }                -> remove the manual link
 */

type Context = { params: Promise<{ id: string }> };

async function respond(action: () => Promise<EventSoundcloudAdminState>, failure: string) {
  try {
    return NextResponse.json({ ok: true, state: await action() });
  } catch (err) {
    if (err instanceof EventSoundcloudAdminError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(`[soundcloud-manual] ${failure}: ${err instanceof Error ? err.message : String(err)}`);
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
  return respond(() => setManualSoundcloudLink(id, body?.artistName, body?.url), "Saving the SoundCloud link failed — reload to see the current state.");
}

export async function DELETE(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  return respond(() => removeManualSoundcloudLink(id, body?.artistName), "Removing the SoundCloud link failed — reload to see the current state.");
}
