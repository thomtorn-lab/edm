"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { analyticsBeforeSend } from "@/lib/analytics";
import { readAnalyticsConsent, setAnalyticsConsent, subscribeAnalyticsConsent } from "@/lib/analyticsConsent";

/**
 * Vercel Web Analytics behind the visitor's consent (consent round,
 * 2026-10-30). Nothing is loaded and nothing is sent until the visitor
 * presses "Allow": before a choice the component renders only the consent
 * banner; after "Decline" it renders nothing; after "Allow" it renders
 * <Analytics>, whose beforeSend (analyticsBeforeSend) re-checks the choice
 * on every event and strips query strings. The choice can be changed at any
 * time on the Privacy page (AnalyticsConsentSettings).
 *
 * Client Component wrapper (GDPR audit, 2026-10-06): the root layout is a
 * Server Component and can't pass a function like beforeSend across that
 * boundary, so it lives in this client module.
 *
 * The server render (and the first client render, before storage can be
 * read) shows nothing at all, so a visitor who already chose never sees the
 * banner flash.
 */
const getServerSnapshot = () => undefined;

export default function PrivacyAwareAnalytics() {
  const consent = useSyncExternalStore(subscribeAnalyticsConsent, readAnalyticsConsent, getServerSnapshot);

  if (consent === "granted") return <Analytics beforeSend={analyticsBeforeSend} />;
  if (consent === null) return <AnalyticsConsentBanner />;
  return null;
}

const CHOICE_BUTTON =
  "min-h-[2.75rem] flex-1 rounded border border-border-strong px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:border-accent-dim hover:text-accent focus-visible:border-accent-dim sm:flex-none";

function AnalyticsConsentBanner() {
  return (
    <section
      aria-labelledby="analytics-consent-heading"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border-strong bg-surface-1 px-4 py-4 sm:px-6"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm leading-relaxed text-text-secondary">
          <h2 id="analytics-consent-heading" className="font-semibold text-text-primary">
            Allow visitor statistics?
          </h2>
          <p>
            With your permission we use Vercel Web Analytics, which sets no cookies, to count page views. Declining
            doesn&rsquo;t affect the site, and you can change your choice at any time on the{" "}
            <Link href="/privacy#statistics" className="underline hover:text-text-primary">Privacy</Link> page.
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <button type="button" className={CHOICE_BUTTON} onClick={() => setAnalyticsConsent("denied")}>
            Decline
          </button>
          <button type="button" className={CHOICE_BUTTON} onClick={() => setAnalyticsConsent("granted")}>
            Allow
          </button>
        </div>
      </div>
    </section>
  );
}
