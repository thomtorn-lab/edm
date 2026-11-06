import { NextRequest, NextResponse } from "next/server";
import { confirmArtistAlerts } from "@/db/artistAlerts";
import { artistAlertsMode, subscriptionsEnabled } from "@/lib/artistAlerts/config";
import { notifyAdminOfRequests } from "@/lib/artistAlerts/notify";
import { isWellFormedToken } from "@/lib/artistAlerts/tokens";

/** Double opt-in: only an explicit button press (POST) confirms — never a GET a link scanner could trigger. */
export async function POST(request: NextRequest) {
  if (!subscriptionsEnabled(artistAlertsMode())) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const form = await request.formData();
  const token = form.get("token");
  const result = isWellFormedToken(token) ? await confirmArtistAlerts(token) : null;
  if (!result) return NextResponse.redirect(new URL("/artists/confirm?invalid=1", request.url), 303);
  await notifyAdminOfRequests(result.newRequests);
  return NextResponse.redirect(new URL(`/artists/manage?token=${result.manageToken}&confirmed=1`, request.url), 303);
}
