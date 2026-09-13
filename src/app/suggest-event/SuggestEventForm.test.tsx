// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SuggestEventForm from "./SuggestEventForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillValidForm() {
  fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Midnight Session" } });
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "12 Sept 2026" } });
  fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "RUST" } });
  fireEvent.change(screen.getByLabelText("Event URL"), { target: { value: "https://ra.co/events/1" } });
  fireEvent.change(screen.getByLabelText("Contact email"), { target: { value: "ada@example.com" } });
}

describe("SuggestEventForm", () => {
  it("shows a clear success state after a successful submission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));

    render(<SuggestEventForm />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /suggest an event/i }));

    const success = await screen.findByRole("status");
    expect(success.textContent).toContain("Thanks");
    expect(success.textContent).toMatch(/review|checked/i);
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

    render(<SuggestEventForm />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /suggest an event/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Too many requests. Please try again later.");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("falls back to a generic message on a network-level failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(<SuggestEventForm />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /suggest an event/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Something went wrong sending your suggestion. Please try again in a moment.");
  });

  it("does not submit when required fields are empty", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<SuggestEventForm />);
    fireEvent.click(screen.getByRole("button", { name: /suggest an event/i }));

    expect(screen.getByText("Enter the event name.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SuggestEventForm — mobile iOS auto-zoom fix (2026-09-13): every field renders at >= 16px on mobile so focusing it never triggers Safari's viewport zoom, while desktop keeps its original text-sm size", () => {
  afterEach(cleanup);

  function allFields() {
    return [
      screen.getByLabelText("Event name"),
      screen.getByLabelText("Date"),
      screen.getByLabelText("Venue"),
      screen.getByLabelText("Event URL"),
      screen.getByLabelText("Contact email"),
      screen.getByLabelText(/Note/),
    ];
  }

  it("every field renders mobile-effective text-base (16px), not a bare text-sm (14px)", () => {
    render(<SuggestEventForm />);
    for (const field of allFields()) {
      const classes = field.className.split(/\s+/);
      expect(classes).toContain("text-base");
      expect(classes).not.toContain("text-sm");
    }
  });

  it("every field still carries sm:text-sm — desktop's original 14px size is unchanged, only overridden below the sm breakpoint", () => {
    render(<SuggestEventForm />);
    for (const field of allFields()) {
      const classes = field.className.split(/\s+/);
      expect(classes).toContain("sm:text-sm");
    }
  });
});
