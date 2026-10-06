import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveTestAllowlist, isEmailAllowlistedForTest, parseTestAllowlist } from "./testAllowlist";

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseTestAllowlist", () => {
  it("returns null when unset", () => {
    expect(parseTestAllowlist()).toBeNull();
  });

  it("returns null for an empty string (empty allowlist = no test access, not 'allow everyone')", () => {
    vi.stubEnv("NEWSLETTER_TEST_ALLOWLIST", "");
    expect(parseTestAllowlist()).toBeNull();
  });

  it("returns null when the value is only commas/whitespace", () => {
    vi.stubEnv("NEWSLETTER_TEST_ALLOWLIST", " , , ");
    expect(parseTestAllowlist()).toBeNull();
  });

  it("parses a comma-separated list, trimmed and lowercased", () => {
    vi.stubEnv("NEWSLETTER_TEST_ALLOWLIST", " Alice@Example.com, bob@example.com ,,");
    expect(parseTestAllowlist()).toEqual(new Set(["alice@example.com", "bob@example.com"]));
  });
});

describe("getActiveTestAllowlist", () => {
  it("returns null when the real feature flag is enabled — a live newsletter is never narrowed by a leftover test allowlist", () => {
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "true");
    vi.stubEnv("NEWSLETTER_TEST_ALLOWLIST", "tester@example.com");
    expect(getActiveTestAllowlist()).toBeNull();
  });

  it("returns the parsed allowlist when the flag is disabled and an allowlist is configured", () => {
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "false");
    vi.stubEnv("NEWSLETTER_TEST_ALLOWLIST", "tester@example.com");
    expect(getActiveTestAllowlist()).toEqual(new Set(["tester@example.com"]));
  });

  it("returns null when the flag is disabled and no allowlist is configured (today's existing fully-disabled behavior)", () => {
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "false");
    expect(getActiveTestAllowlist()).toBeNull();
  });
});

describe("isEmailAllowlistedForTest", () => {
  it("returns false when allowlist is null", () => {
    expect(isEmailAllowlistedForTest("tester@example.com", null)).toBe(false);
  });

  it("matches case/whitespace-insensitively", () => {
    const allowlist = new Set(["tester@example.com"]);
    expect(isEmailAllowlistedForTest("  Tester@Example.COM  ", allowlist)).toBe(true);
  });

  it("returns false for an address not on the list", () => {
    const allowlist = new Set(["tester@example.com"]);
    expect(isEmailAllowlistedForTest("someone-else@example.com", allowlist)).toBe(false);
  });
});
