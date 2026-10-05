// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NewsletterPreferencesForm from "./NewsletterPreferencesForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NewsletterPreferencesForm", () => {
  it("renders a checkbox for every MainGenreSlug, pre-checked according to initialGenres", () => {
    render(<NewsletterPreferencesForm token="tok" initialGenres={["techno", "house"]} />);
    expect((screen.getByRole("checkbox", { name: "Techno" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "House" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Trance" }) as HTMLInputElement).checked).toBe(false);
  });

  it("renders no genre pre-checked for an empty selection (= all events)", () => {
    render(<NewsletterPreferencesForm token="tok" initialGenres={[]} />);
    for (const cb of screen.getAllByRole("checkbox")) {
      expect((cb as HTMLInputElement).checked).toBe(false);
    }
  });

  it("saves the currently-checked genres, not the initial ones, when toggled before saving", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<NewsletterPreferencesForm token="manage-tok" initialGenres={["techno"]} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Techno" })); // uncheck
    fireEvent.click(screen.getByRole("checkbox", { name: "House" })); // check
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));

    await screen.findByText("Saved.");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/newsletter/preferences",
      expect.objectContaining({ body: JSON.stringify({ token: "manage-tok", genres: ["house"] }) }),
    );
  });

  it("shows an error state when saving fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "nope" }) }));
    render(<NewsletterPreferencesForm token="tok" initialGenres={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn.t save/i);
  });

  it("unsubscribing calls the unsubscribe endpoint with the token and shows a confirmation, removing the preferences form", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<NewsletterPreferencesForm token="manage-tok" initialGenres={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /unsubscribe/i }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/unsubscribed/i);
    expect(fetchMock).toHaveBeenCalledWith("/api/newsletter/unsubscribe?token=manage-tok", { method: "POST" });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows an error state when unsubscribing fails, and keeps the form visible", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<NewsletterPreferencesForm token="tok" initialGenres={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /unsubscribe/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn.t unsubscribe/i);
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
  });
});
