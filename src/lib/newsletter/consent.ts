/**
 * Consent-wording version for the newsletter double opt-in (GDPR final
 * hardening round, 2026-10-06). Bump this string whenever the signup
 * form's copy, the confirmation email's wording, or the confirm page's
 * copy changes in any way that could affect what a subscriber is actually
 * agreeing to — never for a purely cosmetic change. Stamped onto a
 * subscriber's row (newsletterSubscribers.consentVersion) at the moment
 * they confirm, so "which wording did this person agree to" is always
 * answerable by looking up this tag in git history, without storing the
 * full consent text (or anything else, like an IP address) per subscriber.
 */
export const NEWSLETTER_CONSENT_VERSION = "2026-10-06";

/**
 * The exact purpose consent is being collected for, in one sentence —
 * referenced by the signup form, confirmation email, and confirm page so
 * all three stay in sync, and quoted here so this version tag has a fixed,
 * auditable meaning without re-reading three separate files.
 */
export const NEWSLETTER_CONSENT_PURPOSE =
  "To send you the Electronic CPH weekly newsletter (upcoming electronic music events in Copenhagen, filtered by the genres you choose).";
