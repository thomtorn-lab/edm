// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ContactForm from "./ContactForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillValidForm() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello there" } });
}

describe("ContactForm", () => {
  it("shows the exact required success message after a successful submission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));

    render(<ContactForm />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    const success = await screen.findByRole("status");
    expect(success.textContent).toBe(
      "Thanks — we’ve received your message. We may not be able to reply to every message, but we review them all."
    );
  });

  it("surfaces the server's own message on a 429 rate-limit response, not a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: "Too many requests. Please try again later." }),
      })
    );

    render(<ContactForm />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Too many requests. Please try again later.");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("falls back to a generic message on a network-level failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(<ContactForm />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Something went wrong sending your message. Please try again in a moment.");
  });

  it("does not submit when required fields are empty", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<ContactForm />);
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    expect(screen.getByText("Enter your name.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
