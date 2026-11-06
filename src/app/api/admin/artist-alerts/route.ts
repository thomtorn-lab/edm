import { NextRequest, NextResponse } from "next/server";
import { decideAppearance } from "@/db/artistAppearances";
import { resolveRequestedArtist_admin, type ResolvedRequest } from "@/db/artistAlerts";
import { artistAlertsMode } from "@/lib/artistAlerts/config";
import { sendRequestResultEmails } from "@/lib/artistAlerts/notify";

/**
 * Admin review actions for Artist Alerts (behind /api/admin Basic Auth in
 * src/proxy.ts): confirm/reject an appearance in review, and approve, link
 * or reject a requested artist. Approving, linking or rejecting a request
 * emails each confirmed requester once (allowlist only in test mode).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length < 300 ? v : null);
  switch (body.action) {
    case "confirm-appearance":
    case "reject-appearance": {
      const eventId = str(body.eventId);
      const nameKey = str(body.nameKey);
      const ok = eventId && nameKey ? await decideAppearance(eventId, nameKey, body.action === "confirm-appearance" ? "confirmed" : "rejected") : false;
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Nothing changed." }, { status: 400 });
    }
    case "verify-request":
    case "reject-request":
    case "link-request": {
      const artistId = str(body.artistId);
      const linkTo = str(body.linkTo);
      let result: ResolvedRequest | null = null;
      if (artistId && body.action === "verify-request") result = await resolveRequestedArtist_admin(artistId, { verify: true });
      else if (artistId && body.action === "reject-request") result = await resolveRequestedArtist_admin(artistId, { reject: true });
      else if (artistId && linkTo) result = await resolveRequestedArtist_admin(artistId, { linkTo });
      if (!result) return NextResponse.json({ error: "Nothing changed." }, { status: 400 });
      const emailed = await sendRequestResultEmails(result, artistAlertsMode());
      return NextResponse.json({ ok: true, followers: result.recipients.length, emailed });
    }
  }
  return NextResponse.json({ error: "Invalid request." }, { status: 400 });
}
