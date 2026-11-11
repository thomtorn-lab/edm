import { NextRequest, NextResponse } from "next/server";
import { requestArtistAlerts } from "@/db/artistAlerts";
import { ARTIST_ALERTS_REPLY_TO, artistAlertsMode, emailAllowed, subscriptionsEnabled } from "@/lib/artistAlerts/config";
import { buildConfirmEmail, buildManageLinkEmail } from "@/lib/artistAlerts/emailContent";
import { ADDRESS_LIMIT_MESSAGE, BUSY_MESSAGE, CLOSED_TEST_MESSAGE } from "@/lib/artistAlerts/messages";
import { parseIdList, parseRequests } from "@/lib/artistAlerts/requestParsing";
import { sendEmail } from "@/lib/email";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";
import { isValidEmail } from "@/lib/validation";


/**
 * Artist Alerts signup. New and confirmed addresses get the same answer
 * (no disclosure of who is signed up); only the email differs: a new or
 * unconfirmed address gets the double opt-in confirmation, a confirmed one
 * its manage link carrying the picks, which are added only once the
 * subscriber opens the link and presses Add. Whenever no email is sent on
 * purpose, the answer says so instead of claiming one was sent; the
 * per-address limit applies to every address the form is used for, so
 * saying so reveals nothing either.
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
  if (!emailAllowed(email, mode)) {
    console.info("artist alerts subscribe: address not on the test allowlist");
    return NextResponse.json({ error: CLOSED_TEST_MESSAGE }, { status: 403 });
  }
  if (isRateLimited(`artist-alerts-subscribe:${getClientIp(request)}`)) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });

  try {
    const result = await requestArtistAlerts({ email, artistIds, requests });
    if (result.outcome === "limited") {
      console.info("artist alerts subscribe: per-address email limit reached");
      return NextResponse.json({ error: ADDRESS_LIMIT_MESSAGE }, { status: 429 });
    }
    if (result.outcome === "busy") {
      console.info("artist alerts subscribe: global hourly email cap reached");
      return NextResponse.json({ error: BUSY_MESSAGE }, { status: 503 });
    }
    const content =
      result.outcome === "manage"
        ? buildManageLinkEmail({ manageToken: result.manageToken, picks: result.picks })
        : buildConfirmEmail({ confirmToken: result.confirmToken, artistNames: result.artistNames });
    await sendEmail({ to: email, subject: content.subject, text: content.text, html: content.html, replyTo: ARTIST_ALERTS_REPLY_TO });
  } catch (err) {
    console.error("artist alerts subscribe failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Something went wrong. Please try again later." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
