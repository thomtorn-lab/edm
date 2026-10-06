import { NextRequest, NextResponse } from "next/server";
import { confirmSubscriberByToken } from "@/db/newsletter";
import { triggerRetentionSweep } from "@/lib/newsletter/retentionSweep";

/**
 * Double-opt-in confirmation (GDPR consent-evidence integrity fix,
 * 2026-10-06): intentionally a POST-only route, not the GET the confirm
 * link itself navigates to (see newsletter/confirm/page.tsx) — confirming a
 * subscription is a side-effecting action that must require an explicit
 * user action (the button submit on that page), not merely loading a URL.
 * A plain GET confirm (whether a Server Component or a route handler —
 * either responds to the same GET) is vulnerable to automated email-
 * security-gateway link scanners/prefetchers (e.g. Safe Links) silently
 * confirming subscriptions nobody ever clicked, which would corrupt the
 * very consent evidence double opt-in exists to produce. Exporting no GET
 * here mirrors the unsubscribe route's existing pattern: Next.js's App
 * Router rejects a GET with 405 before this module's code ever runs.
 */
export async function POST(request: NextRequest) {
  // Retention sweep (GDPR final hardening round, 2026-10-06) — see
  // triggerRetentionSweep's own doc comment: a confirm click is independent,
  // organic traffic that keeps retention running even if the scheduled send
  // workflow stops firing entirely.
  await triggerRetentionSweep();

  const form = await request.formData();
  const token = form.get("token");

  const result = typeof token === "string" && token ? await confirmSubscriberByToken(token) : null;

  if (!result) {
    return NextResponse.redirect(new URL("/newsletter/confirm?invalid=1", request.url), 303);
  }
  return NextResponse.redirect(
    new URL(`/newsletter/manage?token=${result.manageToken}&justConfirmed=1`, request.url),
    303,
  );
}
