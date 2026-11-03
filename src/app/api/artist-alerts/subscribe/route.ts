import { NextRequest, NextResponse } from "next/server";
import { requestArtistAlerts } from "@/db/artistAlerts";
import { ARTIST_ALERTS_REPLY_TO, artistAlertsMode, emailAllowed, subscriptionsEnabled } from "@/lib/artistAlerts/config";
import { buildConfirmEmail, buildManageLinkEmail } from "@/lib/artistAlerts/emailContent";
import { parseIdList, parseRequests } from "@/lib/artistAlerts/requestParsing";
import { sendEmail } from "@/lib/email";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";
import { isValidEmail } from "@/lib/validation";

/**
 * Artist Alerts signup. Always the same generic answer, whether the address
 * is new, pending or already subscribed. Nothing becomes active until the
 * emailed confirmation link is used (double opt-in).
 */
export async function POST(request: NextRequest) {
  const mode = artistAlertsMode();
  if (!subscriptionsEnabled(mode)) return NextResponse.json({ error: "Not available." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== "object" || parsed === null) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.company === "string" && body.company.trim() !== "") return NextResponse.json({ ok: true }); // honeypot

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!isValidEmail(email) || email.length > 254) return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  const artistIds = parseIdList(body.artistIds);
  const requests = parseRequests(body.requests);
  if (artistIds.length === 0 && requests.length === 0) return NextResponse.json({ error: "Choose at least one artist." }, { status: 400 });
  if (!emailAllowed(email, mode)) return NextResponse.json({ ok: true }); // test mode: silently ignore other addresses
  if (isRateLimited(`artist-alerts-subscribe:${getClientIp(request)}`)) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });

  try {
    const result = await requestArtistAlerts({ email, artistIds, requests });
    // Same answer either way; only the email differs. A confirmed address gets
    // its manage link (artists change there at once), anyone else the
    // double opt-in confirmation.
    const content = result.manageToken
      ? buildManageLinkEmail({ manageToken: result.manageToken })
      : result.confirmToken
        ? buildConfirmEmail({ confirmToken: result.confirmToken, artistNames: result.artistNames })
        : null;
    if (content) await sendEmail({ to: email, subject: content.subject, text: content.text, replyTo: ARTIST_ALERTS_REPLY_TO });
  } catch (err) {
    console.error("artist alerts subscribe failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Something went wrong. Please try again later." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
