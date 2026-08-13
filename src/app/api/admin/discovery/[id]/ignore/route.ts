import { NextResponse } from "next/server";
import { ignoreDiscoveryItem } from "@/db/writes";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    await ignoreDiscoveryItem(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Ignore failed" }, { status: 400 });
  }
}
