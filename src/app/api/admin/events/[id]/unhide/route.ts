import { NextResponse } from "next/server";
import { setEventPublished } from "@/db/writes";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    await setEventPublished(id, true);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unhide failed" }, { status: 400 });
  }
}
