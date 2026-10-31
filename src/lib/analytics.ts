import type { BeforeSendEvent } from "@vercel/analytics/next";
import { readAnalyticsConsent } from "./analyticsConsent";

/**
 * Vercel Web Analytics sends the full page URL, including its query string,
 * by default (GDPR audit, 2026-10-06) — but the newsletter confirm/manage
 * links carry a single-use confirmToken/manageToken as a query parameter,
 * and those are the entire auth model for those flows (no account/login).
 * Without this, every pageview of those links would hand the token to
 * Vercel's analytics backend as plain pageview data. Strips every query
 * parameter from the URL before it leaves the browser; the privacy-friendly
 * cookieless pageview/popular-pages use case this site has doesn't need
 * query strings at all.
 */
export function stripSensitiveQueryParams(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url);
  url.search = "";
  return { ...event, url: url.toString() };
}

/**
 * The beforeSend the site actually installs (consent round, 2026-10-30):
 * drops every event unless the visitor has allowed statistics, checked at
 * send time — so a visitor who allows and later declines stops sending from
 * that moment, even though the already-loaded script stays in the page
 * until the next full load. Allowed events still have their query string
 * stripped.
 */
export function analyticsBeforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  if (readAnalyticsConsent() !== "granted") return null;
  return stripSensitiveQueryParams(event);
}
