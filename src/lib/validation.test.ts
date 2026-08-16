import { describe, expect, it } from "vitest";
import { isValidEmail, isValidHttpUrl } from "./validation";

describe("isValidEmail", () => {
  it("accepts a normal email address", () => {
    expect(isValidEmail("person@example.com")).toBe(true);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isValidEmail("  person@example.com  ")).toBe(true);
  });

  it.each(["", "not-an-email", "person@", "@example.com", "person example.com", "person@example"])(
    "rejects %j",
    (value) => {
      expect(isValidEmail(value)).toBe(false);
    }
  );
});

describe("isValidHttpUrl", () => {
  it("accepts an https URL", () => {
    expect(isValidHttpUrl("https://ra.co/events/123")).toBe(true);
  });

  it("accepts an http URL", () => {
    expect(isValidHttpUrl("http://example.com")).toBe(true);
  });

  it.each(["", "not a url", "javascript:alert(1)", "ftp://example.com", "example.com"])(
    "rejects %j",
    (value) => {
      expect(isValidHttpUrl(value)).toBe(false);
    }
  );
});
