"use client";

import { useSyncExternalStore } from "react";
import { readAnalyticsConsent, setAnalyticsConsent, subscribeAnalyticsConsent, type AnalyticsConsent } from "@/lib/analyticsConsent";

/**
 * The Privacy page's "change your choice" control for visitor statistics
 * (consent round, 2026-10-30): shows the current choice and lets the
 * visitor switch it either way. Declining after allowing takes effect
 * immediately — analyticsBeforeSend drops every later event — and the
 * Analytics script itself is gone from the next page load.
 */
const getServerSnapshot = () => undefined;

const STATUS: Record<"none" | AnalyticsConsent, string> = {
  none: "You haven't made a choice yet, so no statistics are collected.",
  granted: "You have allowed visitor statistics.",
  denied: "You have declined visitor statistics, so none are collected.",
};

const BUTTON =
  "min-h-[2.75rem] rounded border border-border-strong px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:border-accent-dim hover:text-accent focus-visible:border-accent-dim disabled:cursor-default disabled:opacity-50 disabled:hover:border-border-strong disabled:hover:text-text-primary";

export default function AnalyticsConsentSettings() {
  const consent = useSyncExternalStore(subscribeAnalyticsConsent, readAnalyticsConsent, getServerSnapshot);
  // Server render: no storage to read — render the buttons without a status
  // line, so the page doesn't claim a choice it can't see.
  const status = consent === undefined ? null : STATUS[consent ?? "none"];

  return (
    <div className="space-y-3">
      {status && (
        <p role="status" className="text-sm text-text-secondary">
          {status}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" className={BUTTON} disabled={consent === "denied"} onClick={() => setAnalyticsConsent("denied")}>
          Decline statistics
        </button>
        <button type="button" className={BUTTON} disabled={consent === "granted"} onClick={() => setAnalyticsConsent("granted")}>
          Allow statistics
        </button>
      </div>
    </div>
  );
}
