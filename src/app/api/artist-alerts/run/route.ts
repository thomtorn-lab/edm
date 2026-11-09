import { NextRequest, NextResponse } from "next/server";
import { runArtistAlerts } from "@/db/artistAlerts";
import { artistAlertsMode } from "@/lib/artistAlerts/config";
import { sendListEmail } from "@/lib/email";
import { rejectUnauthorizedScheduledRequest } from "@/lib/scheduledRequestAuth";

/**
 * Scheduled Artist Alerts run: reconcile lineups, plan deliveries, send,
 * retention. GET is Vercel Cron's call (vercel.json); POST is a manual
 * artist-alerts.yml run. Auth via rejectUnauthorizedScheduledRequest. An
 * overlapping run skips (advisory lock in runArtistAlerts) and sends are
 * idempotency-keyed, so a double trigger never double-sends. Does nothing in
 * mode "off"; reconciles only in "observe". The response holds counts only
 * — never an email address.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  const rejected = rejectUnauthorizedScheduledRequest(request);
  if (rejected) return rejected;
  const summary = await runArtistAlerts(artistAlertsMode(), sendListEmail);
  return NextResponse.json(summary);
}
