import { NextRequest, NextResponse } from "next/server";
import { applyAdminEventEdit } from "@/db/writes";
import { isEditableEventField } from "@/lib/override";

/**
 * Generic admin edit endpoint — correct genre, correct venue, add/correct
 * source URLs, edit title/description/lineup/dates, etc. all go through
 * here as a field patch. Every touched field is marked as manually
 * overridden (src/lib/override.ts) so a later sync can never revert it.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const patch = body?.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return NextResponse.json({ error: "Body must be { patch: { ...fields } }." }, { status: 400 });
  }

  const invalidFields = Object.keys(patch).filter((f) => !isEditableEventField(f));
  if (invalidFields.length > 0) {
    return NextResponse.json({ error: `Not editable: ${invalidFields.join(", ")}` }, { status: 400 });
  }

  try {
    await applyAdminEventEdit(id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Edit failed" }, { status: 400 });
  }
}
