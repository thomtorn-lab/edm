import { describe, expect, it } from "vitest";
import { isRateLimited } from "./rateLimit";

describe("isRateLimited", () => {
  it("allows the first several requests, then blocks", () => {
    const key = "test-key-allow-then-block";
    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited(key, base)).toBe(false);
    }
    expect(isRateLimited(key, base)).toBe(true);
  });

  it("resets once the window has elapsed", () => {
    const key = "test-key-window-reset";
    const base = Date.now();
    for (let i = 0; i < 6; i++) isRateLimited(key, base);

    expect(isRateLimited(key, base + 11 * 60 * 1000)).toBe(false);
  });

  it("tracks separate keys independently", () => {
    const base = Date.now();
    for (let i = 0; i < 6; i++) isRateLimited("test-key-a", base);

    expect(isRateLimited("test-key-b", base)).toBe(false);
  });
});
