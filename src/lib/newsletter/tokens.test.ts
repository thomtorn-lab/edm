import { describe, expect, it } from "vitest";
import { generateNewsletterToken } from "./tokens";

describe("generateNewsletterToken", () => {
  it("generates a URL-safe token with no padding/plus/slash characters", () => {
    const token = generateNewsletterToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates tokens with enough entropy to be non-guessable (32 random bytes)", () => {
    const token = generateNewsletterToken();
    // base64url of 32 bytes is 43 chars (no padding).
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it("never generates the same token twice across many calls", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateNewsletterToken()));
    expect(tokens.size).toBe(1000);
  });
});
