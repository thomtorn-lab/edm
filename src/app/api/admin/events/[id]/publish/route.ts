import { NextResponse } from "next/server";
import { adminRepublishEvent } from "@/db/writes";

/**
 * "Publish Again" (admin unpublish/cancellation safety, 2026-09-06) —
 * supersedes the old bare unhide/route.ts (setEventPublished(id, true)):
 * clears the adminUnpublishReason/adminUnpublishedAt override via
 * adminRepublishEvent so the event becomes eligible for normal future
 * sync behavior again, not just published=true on its own.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    await adminRepublishEvent(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Publish failed" }, { status: 400 });
  }
}
