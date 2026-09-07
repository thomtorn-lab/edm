import { NextResponse } from "next/server";
import { adminOverrideSourceCancellation } from "@/db/writes";

/**
 * Explicit admin override of an active TRUSTED source cancellation
 * (source-driven cancellation safety, 2026-09-07, Section 5) — distinct
 * from /publish (adminRepublishEvent, which reverses an admin's own prior
 * unpublish decision). This route republishes an event the SYSTEM
 * unpublished because a trusted source reported it cancelled, and protects
 * that decision against the source's own signal re-firing on the next sync
 * (see adminOverrideSourceCancellation's own doc comment).
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    await adminOverrideSourceCancellation(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Override failed" }, { status: 400 });
  }
}
