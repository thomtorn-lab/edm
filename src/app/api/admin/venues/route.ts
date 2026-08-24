import { NextRequest, NextResponse } from "next/server";
import { createVenue, VenueNeedsConfirmationError } from "@/db/writes";

/**
 * Admin-only venue creation (source onboarding follow-up). Human-gated: this
 * is only ever called from the discovery-queue review UI, never from a
 * sync/ingestion path — no automated code creates a venue row.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const city = body?.city === "Copenhagen" || body?.city === "Frederiksberg" ? body.city : null;
  const postalCode = typeof body?.postalCode === "string" ? body.postalCode.trim() : "";
  const websiteUrlRaw = typeof body?.websiteUrl === "string" ? body.websiteUrl.trim() : "";
  const confirmed = body?.confirmed === true;

  if (!name) return NextResponse.json({ error: "Venue name is required." }, { status: 400 });
  if (!address) return NextResponse.json({ error: "Address is required." }, { status: 400 });
  if (!city) return NextResponse.json({ error: "City must be Copenhagen or Frederiksberg." }, { status: 400 });
  if (!postalCode) return NextResponse.json({ error: "Postal code is required." }, { status: 400 });

  try {
    const result = await createVenue(
      { name, address, city, postalCode, websiteUrl: websiteUrlRaw || null },
      { confirmed },
    );
    return NextResponse.json({ ok: true, created: result.created, venue: result.venue });
  } catch (err) {
    if (err instanceof VenueNeedsConfirmationError) {
      return NextResponse.json({ error: err.message, needsConfirmation: true }, { status: 409 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Venue creation failed." }, { status: 400 });
  }
}
