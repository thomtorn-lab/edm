import { NextRequest, NextResponse } from "next/server";
import { requestSubscription } from "@/db/newsletter";
import { sendEmail } from "@/lib/email";
import { isValidEmail } from "@/lib/validation";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";
import { isNewsletterEnabled } from "@/lib/newsletter/featureFlag";
import { NEWSLETTER_CONSENT_PURPOSE } from "@/lib/newsletter/consent";
import { triggerRetentionSweep } from "@/lib/newsletter/retentionSweep";

const SITE_URL = "https://electroniccph.com";

/**
 * Always returns the same generic success response regardless of whether
 * the email was new, already pending, or already confirmed (GDPR/privacy:
 * never let the API reveal whether an address is subscribed). Mirrors
 * /api/contact's existing honeypot + isValidEmail + isRateLimited pattern.
 */
export async function POST(request: NextRequest) {
  // Retention sweep (GDPR final hardening round, 2026-10-06) — triggered
  // before the feature-flag check, deliberately: retention must keep
  // running even while signup itself is paused. See triggerRetentionSweep's
  // own doc comment for why this can't depend solely on the scheduled send
  // job continuing to fire.
  await triggerRetentionSweep();

  if (!isNewsletterEnabled()) {
    return NextResponse.json({ error: "Newsletter signup is not yet available." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { email, company } = body as Record<string, unknown>;

  // Honeypot, same convention as /api/contact — a hidden field real
  // visitors never fill in; bots that do get a fake success.
  if (typeof company === "string" && company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  if (!isValidEmail(trimmedEmail)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  if (isRateLimited(`newsletter-subscribe:${getClientIp(request)}`)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  try {
    const result = await requestSubscription(trimmedEmail);
    if (result) {
      const confirmUrl = `${SITE_URL}/newsletter/confirm?token=${result.confirmToken}`;
      await sendEmail({
        to: trimmedEmail,
        subject: "Confirm your Electronic CPH newsletter subscription",
        text: `${NEWSLETTER_CONSENT_PURPOSE}\n\nConfirm your subscription:\n\n${confirmUrl}\n\nIf you didn't request this, you can ignore this email — you won't be subscribed unless you click the link.`,
      });
    }
  } catch (err) {
    console.error("newsletter subscribe: failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Something went wrong. Please try again later." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
