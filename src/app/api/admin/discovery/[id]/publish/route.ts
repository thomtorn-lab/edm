import { NextRequest, NextResponse } from "next/server";
import { publishDiscoveryItem } from "@/db/writes";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const venueId = typeof body?.venueId === "string" ? body.venueId : null;
  if (!venueId) {
    return NextResponse.json({ error: "A resolved venueId is required to publish." }, { status: 400 });
  }
  try {
    const eventId = await publishDiscoveryItem(id, venueId);
    return NextResponse.json({ ok: true, eventId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Publish failed" }, { status: 400 });
  }
}
