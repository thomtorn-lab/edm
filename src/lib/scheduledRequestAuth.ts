import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Shared auth for the scheduled endpoints (/api/sync/[source] and
 * /api/artist-alerts/run). Two accepted callers, nothing else:
 *   - Vercel Cron: `Authorization: Bearer <CRON_SECRET>` (Vercel sends this
 *     header automatically when the CRON_SECRET env var is set).
 *   - Manual GitHub Actions runs (workflow_dispatch): `x-sync-token:
 *     <SYNC_TRIGGER_TOKEN>`, unchanged.
 * Returns null when authorized, otherwise the error response to send.
 */
export function rejectUnauthorizedScheduledRequest(request: Request): NextResponse | null {
  const syncToken = process.env.SYNC_TRIGGER_TOKEN;
  const cronSecret = process.env.CRON_SECRET;
  if (!syncToken && !cronSecret) {
    return NextResponse.json({ error: "Neither CRON_SECRET nor SYNC_TRIGGER_TOKEN is configured." }, { status: 500 });
  }
  const bearer = request.headers.get("authorization");
  if (cronSecret && bearer && safeEqual(bearer, `Bearer ${cronSecret}`)) return null;
  const token = request.headers.get("x-sync-token");
  if (syncToken && token && safeEqual(token, syncToken)) return null;
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
