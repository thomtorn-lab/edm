import { NextRequest, NextResponse } from "next/server";
import { updateDiscoveryItem } from "@/db/writes";

/** Lets an admin fill in fields extraction couldn't determine (date, venue, lineup) before publishing. */
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

  try {
    await updateDiscoveryItem(id, cleaned);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Edit failed" }, { status: 400 });
  }
}
