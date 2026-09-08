import { NextRequest, NextResponse } from "next/server";
import { applyAdminEventEdit } from "@/db/writes";
import { isEditableEventField } from "@/lib/override";
import { isValidHttpUrl } from "@/lib/urlValidation";

/**
 * URL-shaped fields validated on this route (event-level link editing,
 * 2026-09-07) — scoped to exactly the two fields that task added editing
 * for; every other editable field's validation is unchanged. `null` always
 * means "clear it" and is never validated as a URL.
 */
const URL_FIELDS = ["officialEventUrl", "ticketUrl", "residentAdvisorUrl", "facebookUrl"] as const;

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

  for (const field of URL_FIELDS) {
    const value = (patch as Record<string, unknown>)[field];
    if (typeof value === "string" && !isValidHttpUrl(value)) {
      return NextResponse.json({ error: `${field}: enter a valid http(s) URL, or clear the field.` }, { status: 400 });
    }
  }

  // Date-field type safety (unified event create/edit model addendum,
  // 2026-09-08 — confirmed admin bug: "e.toISOString is not a function").
  // JSON has no Date type — request.json() always hands back
  // startDatetime/endDatetime as plain strings, never Date instances. This
  // route used to pass that raw patch straight to applyAdminEventEdit,
  // which hands it to drizzle-orm's PgTimestamp column unmodified;
  // PgTimestamp.mapToDriverValue (node_modules/drizzle-orm/pg-core/columns/
  // timestamp.ts, the "date" mode our schema uses — no `mode: "string"` is
  // set anywhere in schema.ts) unconditionally calls `value.toISOString()`,
  // assuming its input is already a Date — confirmed directly from that
  // source, not assumed. A string has no such method, so every edit that
  // touched startDatetime/endDatetime here threw exactly that error. The
  // Discovery Queue PATCH route already converts probableStart/probableEnd
  // this same way (see src/app/api/admin/discovery/[id]/route.ts) — this
  // brings the events route to the same standard. startDatetime is
  // required (EDITABLE_EVENT_FIELDS lets it be touched, but the column
  // itself is NOT NULL) — an explicit null/invalid value is rejected here
  // rather than reaching the DB as one; endDatetime may be explicitly
  // cleared to null (nullable column, matches its own pre-existing
  // clear-to-null behavior).
  const cleaned: Record<string, unknown> = { ...patch };
  for (const field of ["startDatetime", "endDatetime"] as const) {
    const value = cleaned[field];
    if (typeof value !== "string") continue;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: `${field}: not a valid date.` }, { status: 400 });
    }
    cleaned[field] = parsed;
  }
  if (cleaned.startDatetime === null) {
    return NextResponse.json({ error: "startDatetime cannot be cleared — it is required." }, { status: 400 });
  }

  try {
    await applyAdminEventEdit(id, cleaned);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Edit failed" }, { status: 400 });
  }
}
