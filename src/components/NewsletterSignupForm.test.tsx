// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NewsletterSignupForm from "./NewsletterSignupForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillEmail(value: string) {
  fireEvent.change(screen.getByLabelText("Weekly newsletter"), { target: { value } });
}

describe("NewsletterSignupForm", () => {
  it("shows a confirmation message after a successful submission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    render(<NewsletterSignupForm />);
    fillEmail("ada@example.com");
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/check your email/i);
  });

  it("rejects an invalid email client-side without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<NewsletterSignupForm />);
    fillEmail("not-an-email");
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the server's own error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: "Too many requests. Please try again later." }) }),
    );
    render(<NewsletterSignupForm />);
    fillEmail("ada@example.com");
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Too many requests. Please try again later.");
  });

  it("falls back to a generic message on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    render(<NewsletterSignupForm />);
    fillEmail("ada@example.com");
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/something went wrong/i);
  });

  it("sends the email and an empty honeypot field to the subscribe endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<NewsletterSignupForm />);
    fillEmail("ada@example.com");
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));

    await screen.findByRole("status");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/newsletter/subscribe",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "ada@example.com", company: "" }) }),
    );
  });

  it("has exactly one labelled, visible field — email only (product requirement: email-only initial signup); the honeypot is present but hidden from assistive tech and never tab-reachable", () => {
    const { container } = render(<NewsletterSignupForm />);
    expect(screen.getByLabelText("Weekly newsletter")).toBeTruthy();
    const inputs = container.querySelectorAll("input");
    expect(inputs).toHaveLength(2); // email + honeypot
    const honeypot = Array.from(inputs).find((el) => el.getAttribute("aria-hidden") === "true");
    expect(honeypot).toBeTruthy();
    expect(honeypot?.getAttribute("tabindex")).toBe("-1");
  });
});
