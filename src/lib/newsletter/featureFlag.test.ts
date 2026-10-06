import { afterEach, describe, expect, it, vi } from "vitest";
import { isNewsletterEnabled } from "./featureFlag";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isNewsletterEnabled", () => {
  it("is false when the env var is unset (the default on every existing deployment)", () => {
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "");
    expect(isNewsletterEnabled()).toBe(false);
  });

  it("is true only for the exact string 'true'", () => {
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "true");
    expect(isNewsletterEnabled()).toBe(true);
  });

  it("is false for any other value, including '1' or 'TRUE' (no accidental enablement via typo/truthy-string)", () => {
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "1");
    expect(isNewsletterEnabled()).toBe(false);
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "TRUE");
    expect(isNewsletterEnabled()).toBe(false);
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "false");
    expect(isNewsletterEnabled()).toBe(false);
  });
});
