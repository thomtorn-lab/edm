import { NextResponse } from "next/server";
import { adminUnpublishEvent } from "@/db/writes";
import type { AdminUnpublishReason } from "@/lib/types";

const VALID_REASONS: AdminUnpublishReason[] = ["cancelled", "irrelevant", "duplicate", "incorrect_data", "other"];

/**
 * Admin unpublish (admin unpublish/cancellation safety, 2026-09-06) —
 * supersedes the old bare hide/route.ts (setEventPublished(id, false)):
 * requires a reason and records the persistent adminUnpublishReason/
 * adminUnpublishedAt override via adminUnpublishEvent, which every
 * automated publish path (pipeline.ts's computeDecision,
 * publishDiscoveryItem) now respects.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const reason = body?.reason;
  if (typeof reason !== "string" || !VALID_REASONS.includes(reason as AdminUnpublishReason)) {
    return NextResponse.json({ error: `reason must be one of: ${VALID_REASONS.join(", ")}` }, { status: 400 });
  }
  try {
    await adminUnpublishEvent(id, reason as AdminUnpublishReason);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unpublish failed" }, { status: 400 });
  }
}
