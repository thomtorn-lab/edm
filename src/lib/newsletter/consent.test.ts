import { describe, expect, it } from "vitest";
import { NEWSLETTER_CONSENT_PURPOSE, NEWSLETTER_CONSENT_VERSION } from "./consent";

/**
 * Consent-copy audit (2026-10-07): adds the "You can unsubscribe at any
 * time" clause to the shared purpose sentence (previously stated only in
 * the Privacy Policy — see that page's own text), and bumps the version tag
 * per this file's own convention (bump whenever the signup form's copy, the
 * confirmation email's wording, or the confirm page's copy changes in any
 * way that could affect what a subscriber is actually agreeing to).
 */
describe("NEWSLETTER_CONSENT_PURPOSE / NEWSLETTER_CONSENT_VERSION", () => {
  it("states the brand, the weekly cadence, Copenhagen electronic music events, genre filtering, and that unsubscribing is always available", () => {
    expect(NEWSLETTER_CONSENT_PURPOSE).toContain("Electronic CPH weekly newsletter");
    expect(NEWSLETTER_CONSENT_PURPOSE).toContain("Copenhagen");
    expect(NEWSLETTER_CONSENT_PURPOSE).toContain("filtered by the genres you choose");
    expect(NEWSLETTER_CONSENT_PURPOSE).toContain("You can unsubscribe at any time.");
  });

  it("bumped the version tag alongside this wording change", () => {
    expect(NEWSLETTER_CONSENT_VERSION).toBe("2026-10-07");
  });
});
