import { NextRequest, NextResponse } from "next/server";
import { mergeDiscoveryItem } from "@/db/writes";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const targetEventId = typeof body?.targetEventId === "string" ? body.targetEventId : null;
  if (!targetEventId) {
    return NextResponse.json({ error: "targetEventId is required to merge." }, { status: 400 });
  }
  try {
    await mergeDiscoveryItem(id, targetEventId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Merge failed" }, { status: 400 });
  }
}
