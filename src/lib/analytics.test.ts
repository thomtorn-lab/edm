import { describe, expect, it } from "vitest";
import { stripSensitiveQueryParams } from "./analytics";

describe(
  "stripSensitiveQueryParams (GDPR audit, 2026-10-06: Vercel Web Analytics sends the full pageview " +
    "URL by default, and the newsletter confirm/manage links carry a single-use confirmToken/" +
    "manageToken as a query parameter — that token must never reach the analytics backend)",
  () => {
    it("strips a confirmToken query parameter from a newsletter confirm pageview", () => {
      const result = stripSensitiveQueryParams({
        type: "pageview",
        url: "https://electroniccph.com/newsletter/confirm?token=secret-confirm-token",
      });
      expect(result.url).toBe("https://electroniccph.com/newsletter/confirm");
    });

    it("strips a manageToken query parameter from a newsletter manage pageview", () => {
      const result = stripSensitiveQueryParams({
        type: "pageview",
        url: "https://electroniccph.com/newsletter/manage?token=secret-manage-token&justConfirmed=1",
      });
      expect(result.url).toBe("https://electroniccph.com/newsletter/manage");
    });

    it("leaves a plain URL with no query string unchanged", () => {
      const result = stripSensitiveQueryParams({ type: "pageview", url: "https://electroniccph.com/" });
      expect(result.url).toBe("https://electroniccph.com/");
    });

    it("preserves the event type", () => {
      const result = stripSensitiveQueryParams({ type: "event", url: "https://electroniccph.com/?x=1" });
      expect(result.type).toBe("event");
    });
  },
);
