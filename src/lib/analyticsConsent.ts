/**
 * The visitor's choice about visitor statistics (Vercel Web Analytics),
 * consent round 2026-10-30. Danish cookie rules (cookiebekendtgørelsen, as
 * read in the May 2025 guidance from Datatilsynet and Digitaliseringsstyrelsen)
 * treat statistics as needing prior consent even when no cookie is set, so
 * the Analytics script is loaded only after an explicit "Allow" and sends
 * nothing without it (see PrivacyAwareAnalytics and analyticsBeforeSend).
 *
 * The choice itself is kept in localStorage so the banner doesn't come back
 * on every page — storing a consent choice is necessary to respect it. It
 * holds only the choice, the wording version and when it was made. If
 * storage is unavailable (private mode, blocked storage) the choice still
 * applies for the rest of the page's life, and the banner is shown again on
 * the next full load. A choice made under an older CONSENT_VERSION counts as
 * no choice, so changing what visitors agree to asks again.
 */

export type AnalyticsConsent = "granted" | "denied";

export const ANALYTICS_CONSENT_STORAGE_KEY = "ecph:analytics-consent";

/** Bump when the banner's description of what is collected changes in substance. */
export const ANALYTICS_CONSENT_VERSION = 1;

/** Fired on window whenever this tab records a new choice. */
export const ANALYTICS_CONSENT_EVENT = "ecph:analytics-consent-change";

let inMemoryChoice: AnalyticsConsent | null = null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function parseAnalyticsConsent(raw: string | null): AnalyticsConsent | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { choice?: unknown; version?: unknown };
    if (parsed.version !== ANALYTICS_CONSENT_VERSION) return null;
    return parsed.choice === "granted" || parsed.choice === "denied" ? parsed.choice : null;
  } catch {
    return null;
  }
}

/** The current choice, or null when the visitor hasn't chosen (yet). Never throws. */
export function readAnalyticsConsent(): AnalyticsConsent | null {
  if (typeof window === "undefined") return null;
  let stored: AnalyticsConsent | null = null;
  try {
    stored = parseAnalyticsConsent(storage()?.getItem(ANALYTICS_CONSENT_STORAGE_KEY) ?? null);
  } catch {
    stored = null;
  }
  return stored ?? inMemoryChoice;
}

export function setAnalyticsConsent(choice: AnalyticsConsent, now: Date = new Date()): void {
  inMemoryChoice = choice;
  try {
    storage()?.setItem(
      ANALYTICS_CONSENT_STORAGE_KEY,
      JSON.stringify({ choice, version: ANALYTICS_CONSENT_VERSION, decidedAt: now.toISOString() }),
    );
  } catch {
    // Storage blocked: the in-memory choice still applies for this page.
  }
  window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
}

/** useSyncExternalStore subscriber: this tab's choices plus choices made in other tabs. */
export function subscribeAnalyticsConsent(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === ANALYTICS_CONSENT_STORAGE_KEY) onChange();
  };
  window.addEventListener(ANALYTICS_CONSENT_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(ANALYTICS_CONSENT_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Test-only: forget the in-memory fallback between tests. */
export function resetAnalyticsConsentForTests(): void {
  inMemoryChoice = null;
}
