import { isNewsletterEnabled } from "./featureFlag";

/**
 * Safe end-to-end testing while public signup stays disabled (newsletter
 * activation safety round, 2026-10-06). `NEWSLETTER_TEST_ALLOWLIST` is a
 * comma-separated list of exact email addresses that may use the newsletter
 * while `NEWSLETTER_SIGNUP_ENABLED` is NOT "true" — set only for the
 * duration of a controlled test, never left on in real Production
 * operation. Unset or empty always means "no test access" (never "allow
 * everyone"): there is no way to accidentally turn this into a second,
 * looser signup gate.
 */
export function parseTestAllowlist(): Set<string> | null {
  const raw = process.env.NEWSLETTER_TEST_ALLOWLIST;
  if (!raw) return null;
  const emails = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  return emails.length > 0 ? new Set(emails) : null;
}

/**
 * The allowlist that should actually gate signup/queueing/claiming/sending
 * right now, or `null` when no test restriction applies. Deliberately
 * `null` whenever the real feature flag is on — a genuinely live newsletter
 * must never be narrowed by a leftover test allowlist, so this is the one
 * place that decides "is this a test-mode request" at all; every caller
 * downstream (subscribe route, send route, db/newsletter.ts's
 * selection/claim queries) takes the result of this function, never reads
 * `NEWSLETTER_TEST_ALLOWLIST` directly, so there is exactly one place this
 * decision can be made inconsistently.
 */
export function getActiveTestAllowlist(): Set<string> | null {
  if (isNewsletterEnabled()) return null;
  return parseTestAllowlist();
}

/** Case/whitespace-insensitive membership check — the allowlist itself is already normalized by parseTestAllowlist(), this just normalizes the candidate the same way. */
export function isEmailAllowlistedForTest(email: string, allowlist: Set<string> | null): boolean {
  if (!allowlist) return false;
  return allowlist.has(email.trim().toLowerCase());
}
