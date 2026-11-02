import { NextRequest, NextResponse } from "next/server";
import { unsubscribeArtistAlerts } from "@/db/artistAlerts";
import { isWellFormedToken } from "@/lib/artistAlerts/tokens";

/**
 * One-click unsubscribe (List-Unsubscribe-Post, RFC 8058) and the manage
 * page's button. Deletes the subscriber and everything attached. Works in
 * every mode, so a link in an old email always unsubscribes.
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (isWellFormedToken(token)) await unsubscribeArtistAlerts(token);
  return NextResponse.json({ ok: true });
}
