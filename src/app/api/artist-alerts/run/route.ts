import { NextRequest, NextResponse } from "next/server";
import { runArtistAlerts } from "@/db/artistAlerts";
import { artistAlertsMode } from "@/lib/artistAlerts/config";
import { sendListEmail } from "@/lib/email";

/**
 * Scheduled Artist Alerts run (artist-alerts.yml): reconcile lineups, plan
 * deliveries, send, retention. Same x-sync-token auth as every sync
 * endpoint. Does nothing in mode "off"; reconciles only in "observe". The
 * response holds counts only — never an email address.
 */
export async function POST(request: NextRequest) {
  const token = process.env.SYNC_TRIGGER_TOKEN;
  if (!token) return NextResponse.json({ error: "SYNC_TRIGGER_TOKEN is not configured." }, { status: 500 });
  if (request.headers.get("x-sync-token") !== token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const summary = await runArtistAlerts(artistAlertsMode(), sendListEmail);
  return NextResponse.json(summary);
}
