import { NextResponse } from "next/server";
import { adminClearRescheduledStatus } from "@/db/writes";

/**
 * Clears an incorrect/outdated "Rescheduled" status (rescheduled-status
 * correction, 2026-10-06) — distinct from the generic PATCH route: that
 * route would record "dateChanged" as a permanent manual override via
 * EDITABLE_EVENT_FIELDS/overriddenFields, which would block sync from ever
 * detecting a genuine future reschedule. This dedicated action only resets
 * the underlying change-detection flags (see adminClearRescheduledStatus's
 * own doc comment), the same "dedicated route, not the generic editor"
 * pattern as /override-cancellation.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    await adminClearRescheduledStatus(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Clear failed" }, { status: 400 });
  }
}
