import { NextRequest, NextResponse } from "next/server";
import { updateDiscoveryItem } from "@/db/writes";
import { isValidHttpUrl } from "@/lib/urlValidation";

/**
 * URL-shaped fields validated on this route (admin + public link integrity,
 * 2026-09-08) — same rule and the same two field names as the published-
 * event PATCH route's own URL_FIELDS (src/app/api/admin/events/[id]/route.ts),
 * so a pre-publish Discovery Queue edit and a post-publish event edit hold
 * the exact same URL-shaped-field standard, per Section 10 of the KultuNaut
 * link-integrity audit ("prefer the same labels/validation rules"). `null`
 * always means "clear it" and is never validated as a URL.
 */
const URL_FIELDS = ["probableTicketUrl", "probableOfficialEventUrl"] as const;

/** Lets an admin fill in fields extraction couldn't determine (date, venue, lineup, official/ticket URL) before publishing. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const patch = body?.patch;
  if (!patch || typeof patch !== "object") {
    return NextResponse.json({ error: "Body must be { patch: { ...fields } }." }, { status: 400 });
  }

  const cleaned: Record<string, unknown> = { ...patch };
  if (typeof cleaned.probableStart === "string") {
    cleaned.probableStart = new Date(cleaned.probableStart);
  }
  if (typeof cleaned.probableEnd === "string") {
    cleaned.probableEnd = new Date(cleaned.probableEnd);
  }

  for (const field of URL_FIELDS) {
    const value = cleaned[field];
    if (typeof value === "string" && !isValidHttpUrl(value)) {
      return NextResponse.json({ error: `${field}: enter a valid http(s) URL, or clear the field.` }, { status: 400 });
    }
  }

  try {
    await updateDiscoveryItem(id, cleaned);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Edit failed" }, { status: 400 });
  }
}
