import { NextRequest, NextResponse } from "next/server";
import {
  EventYoutubeAdminError,
  getEventYoutubeAdminState,
  hideEventYoutubeVideo,
  resetEventYoutubeToAuto,
  setEventYoutubeVideo,
  type EventYoutubeAdminState,
} from "@/db/eventYoutubeAdmin";

/**
 * Per-event YouTube video from the admin UI (2026-10-24) — the in-admin
 * counterpart of the event-youtube-override workflow (see
 * src/db/eventYoutubeAdmin.ts). Gated by the same Basic Auth proxy as every
 * other /api/admin/* route (src/proxy.ts).
 *
 *   GET                                  current state (shown video, override, automated match)
 *   PUT  { mode: "video", video: "…" }   choose/replace this event's video (validated with YouTube first)
 *   PUT  { mode: "hidden" }              show no video on this event
 *   DELETE                               remove the override — back to automated matching
 *
 * Every answer that succeeds carries the state after the change.
 */

type Context = { params: Promise<{ id: string }> };

async function respond(action: () => Promise<EventYoutubeAdminState>, failure: string) {
  try {
    return NextResponse.json({ ok: true, state: await action() });
  } catch (err) {
    if (err instanceof EventYoutubeAdminError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(`[youtube-override] ${failure}: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: failure }, { status: 500 });
  }
}

export async function GET(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  return respond(() => getEventYoutubeAdminState(id), "Couldn't load this event's YouTube video.");
}

export async function PUT(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (body?.mode === "video") return respond(() => setEventYoutubeVideo(id, body.video), "Saving the video failed — reload to see the current state.");
  if (body?.mode === "hidden") return respond(() => hideEventYoutubeVideo(id), "Hiding the video failed — reload to see the current state.");
  return NextResponse.json({ error: 'Body must be { mode: "video", video: "<YouTube link or id>" } or { mode: "hidden" }.' }, { status: 400 });
}

export async function DELETE(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  return respond(() => resetEventYoutubeToAuto(id), "Switching back to automatic failed — reload to see the current state.");
}
