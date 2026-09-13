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

describe("ContactForm — mobile iOS auto-zoom fix (2026-09-13): Name/Email/Message all render at >= 16px on mobile so focusing them never triggers Safari's viewport zoom, while desktop keeps its original text-sm size", () => {
  afterEach(cleanup);

  it("Name, Email and Message all render mobile-effective text-base (16px), not a bare text-sm (14px)", () => {
    render(<ContactForm />);
    const fields = [screen.getByLabelText("Name"), screen.getByLabelText("Email"), screen.getByLabelText("Message")];
    for (const field of fields) {
      const classes = field.className.split(/\s+/);
      expect(classes).toContain("text-base");
      expect(classes).not.toContain("text-sm");
    }
  });

  it("Name, Email and Message all still carry sm:text-sm — desktop's original 14px size is unchanged, only overridden below the sm breakpoint", () => {
    render(<ContactForm />);
    const fields = [screen.getByLabelText("Name"), screen.getByLabelText("Email"), screen.getByLabelText("Message")];
    for (const field of fields) {
      const classes = field.className.split(/\s+/);
      expect(classes).toContain("sm:text-sm");
    }
  });
});
