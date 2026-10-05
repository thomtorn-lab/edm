import { NextRequest, NextResponse } from "next/server";
import { unsubscribeByManageToken } from "@/db/newsletter";

/**
 * Two distinct callers hit this exact route, both satisfied by the same
 * simple behavior: an email client's automated one-click unsubscribe
 * (RFC 8058 — POSTs here with body `List-Unsubscribe=One-Click`, no
 * interaction, wants a fast plain success response, never a redirect) and
 * this site's own manage-preferences page (a JS fetch POST, same URL
 * shape). Neither needs — or should get — a response that reveals whether
 * the token was valid; this always replies 200 so the outcome can never be
 * used to probe whether an address was subscribed. Token lives in the URL
 * query string (not a JSON body) specifically because that's what the
 * List-Unsubscribe header embeds and what a mail client's automated POST
 * carries no other identifying information in.
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (token) {
    await unsubscribeByManageToken(token);
  }
  return NextResponse.json({ ok: true });
}
