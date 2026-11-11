import { NextRequest, NextResponse } from "next/server";
import { requestManageLink } from "@/db/artistAlerts";
import { ARTIST_ALERTS_REPLY_TO, artistAlertsMode, emailAllowed, subscriptionsEnabled } from "@/lib/artistAlerts/config";
import { buildManageLinkEmail } from "@/lib/artistAlerts/emailContent";
import { CLOSED_TEST_MESSAGE, MANAGE_LINK_SENT_MESSAGE } from "@/lib/artistAlerts/messages";
import { sendEmail } from "@/lib/email";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";
import { isValidEmail } from "@/lib/validation";


/**
 * "Manage Artist Alerts" form: emails a confirmed subscriber their manage
 * link. No login and no account: the link in the inbox is the access.
 */
export async function POST(request: NextRequest) {
  const mode = artistAlertsMode();
  if (!subscriptionsEnabled(mode)) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  if (typeof body.company === "string" && body.company.trim() !== "") return NextResponse.json({ ok: true, message: MANAGE_LINK_SENT_MESSAGE }); // honeypot

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!isValidEmail(email) || email.length > 254) return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  if (!emailAllowed(email, mode)) {
    console.info("artist alerts manage-link: address not on the test allowlist");
    return NextResponse.json({ error: CLOSED_TEST_MESSAGE }, { status: 403 });
  }
  if (isRateLimited(`artist-alerts-manage-link:${getClientIp(request)}`)) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });

  try {
    const result = await requestManageLink(email);
    if (result) {
      const content = buildManageLinkEmail({ manageToken: result.manageToken });
      await sendEmail({ to: email, subject: content.subject, text: content.text, html: content.html, replyTo: ARTIST_ALERTS_REPLY_TO });
      console.info("artist alerts manage-link: sent");
    } else {
      console.info("artist alerts manage-link: no email (not a confirmed subscriber, or limit reached)");
    }
  } catch (err) {
    console.error("artist alerts manage-link failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Something went wrong. Please try again later." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, message: MANAGE_LINK_SENT_MESSAGE });
}
