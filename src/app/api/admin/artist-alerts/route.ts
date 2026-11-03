import { NextRequest, NextResponse } from "next/server";
import { decideAppearance } from "@/db/artistAppearances";
import { resolveRequestedArtist_admin } from "@/db/artistAlerts";

/**
 * Admin review actions for Artist Alerts (behind /api/admin Basic Auth in
 * src/proxy.ts): confirm/reject an appearance in review, and verify, link or
 * reject a requested artist.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length < 300 ? v : null);
  let ok = false;
  switch (body.action) {
    case "confirm-appearance":
    case "reject-appearance": {
      const eventId = str(body.eventId);
      const nameKey = str(body.nameKey);
      if (eventId && nameKey) ok = await decideAppearance(eventId, nameKey, body.action === "confirm-appearance" ? "confirmed" : "rejected");
      break;
    }
    case "verify-request":
    case "reject-request":
    case "link-request": {
      const artistId = str(body.artistId);
      const linkTo = str(body.linkTo);
      if (!artistId) break;
      if (body.action === "verify-request") ok = await resolveRequestedArtist_admin(artistId, { verify: true });
      else if (body.action === "reject-request") ok = await resolveRequestedArtist_admin(artistId, { reject: true });
      else if (linkTo) ok = await resolveRequestedArtist_admin(artistId, { linkTo });
      break;
    }
  }
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Nothing changed." }, { status: 400 });
}
