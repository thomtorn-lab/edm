// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import NewsletterConfirmPage from "./page";

afterEach(() => {
  cleanup();
});

describe("NewsletterConfirmPage", () => {
  it(
    "GDPR consent-evidence integrity: never confirms on render (GET) — renders a form requiring an " +
      "explicit submit instead, so an automated email-security-gateway link scanner/prefetcher loading " +
      "this URL can never silently confirm a subscription nobody actually clicked",
    async () => {
      const element = await NewsletterConfirmPage({ searchParams: Promise.resolve({ token: "confirm-123" }) });
      render(element);
      const form = screen.getByRole("button", { name: /confirm subscription/i }).closest("form");
      expect(form).toBeTruthy();
      expect(form?.getAttribute("method")).toBe("POST");
      expect(form?.getAttribute("action")).toBe("/api/newsletter/confirm");
      const tokenInput = form?.querySelector('input[name="token"]') as HTMLInputElement | null;
      expect(tokenInput?.value).toBe("confirm-123");
    },
  );

  it("shows an invalid-link message when no token is present at all", async () => {
    const element = await NewsletterConfirmPage({ searchParams: Promise.resolve({}) });
    render(element);
    expect(screen.getByText(/Link not valid/i)).toBeTruthy();
  });

  it("shows an invalid-link message when the API route redirected back here after a bad/used token", async () => {
    const element = await NewsletterConfirmPage({ searchParams: Promise.resolve({ token: "confirm-123", invalid: "1" }) });
    render(element);
    expect(screen.getByText(/Link not valid/i)).toBeTruthy();
  });
});
