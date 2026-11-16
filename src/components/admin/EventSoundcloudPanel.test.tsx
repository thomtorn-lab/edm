// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EventSoundcloudPanel from "./EventSoundcloudPanel";

/** Manual SoundCloud links in the event's admin edit view (2026-11-16): add, change, remove, errors. */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const URL_ = "/api/admin/events/e-1/soundcloud";
type ArtistIn = { name: string; manualUrl: string | null; automaticUrl: string | null; automaticFrom?: "event-source" | "reused" | null; manualBlocked?: boolean };
const state = (artists: ArtistIn[]) => ({
  ok: true,
  state: { eventId: "e-1", artists: artists.map((a) => ({ manualBlocked: false, automaticFrom: a.automaticUrl ? "event-source" : null, ...a })) },
});
const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body });

function stubFetch(...responses: unknown[]) {
  const fetchMock = vi.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

describe("EventSoundcloudPanel", () => {
  it("adds a manual link for one lineup artist", async () => {
    const fetchMock = stubFetch(
      reply(state([{ name: "TICON", manualUrl: null, automaticUrl: "https://soundcloud.com/ticon" }])),
      reply(state([{ name: "TICON", manualUrl: "https://soundcloud.com/ticon-official", automaticUrl: "https://soundcloud.com/ticon" }])),
    );
    render(<EventSoundcloudPanel eventId="e-1" />);
    expect(await screen.findByText(/Automatic \(from this event's source\):/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("SoundCloud profile link for TICON"), { target: { value: "https://soundcloud.com/ticon-official" } });
    fireEvent.click(screen.getByRole("button", { name: "Add link for TICON" }));
    expect(await screen.findByText(/Saved — TICON now links/)).toBeTruthy();
    expect(fetchMock.mock.calls[1][0]).toBe(URL_);
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("PUT");
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({ artistName: "TICON", url: "https://soundcloud.com/ticon-official" });
    expect(screen.getByText(/Manual:/)).toBeTruthy();
  });

  it("changes an existing manual link", async () => {
    const fetchMock = stubFetch(
      reply(state([{ name: "TICON", manualUrl: "https://soundcloud.com/ticon-old", automaticUrl: null }])),
      reply(state([{ name: "TICON", manualUrl: "https://soundcloud.com/ticon-new", automaticUrl: null }])),
    );
    render(<EventSoundcloudPanel eventId="e-1" />);
    fireEvent.change(await screen.findByLabelText("SoundCloud profile link for TICON"), { target: { value: "https://soundcloud.com/ticon-new" } });
    fireEvent.click(screen.getByRole("button", { name: "Change link for TICON" }));
    expect(await screen.findByText("soundcloud.com/ticon-new")).toBeTruthy();
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({ artistName: "TICON", url: "https://soundcloud.com/ticon-new" });
  });

  it("removes a manual link; the automatic one shows again", async () => {
    const fetchMock = stubFetch(
      reply(state([{ name: "TICON", manualUrl: "https://soundcloud.com/ticon-official", automaticUrl: "https://soundcloud.com/ticon" }])),
      reply(state([{ name: "TICON", manualUrl: null, automaticUrl: "https://soundcloud.com/ticon" }])),
    );
    render(<EventSoundcloudPanel eventId="e-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove link for TICON" }));
    expect(await screen.findByText(/Removed — TICON/)).toBeTruthy();
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("DELETE");
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({ artistName: "TICON" });
    expect(screen.getByText(/Automatic \(from this event's source\):/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove link for TICON" })).toBeNull();
  });

  it("shows the server's validation error and keeps the typed link", async () => {
    stubFetch(reply(state([{ name: "TICON", manualUrl: null, automaticUrl: null }])), reply({ error: "That isn't a soundcloud.com link." }, false));
    render(<EventSoundcloudPanel eventId="e-1" />);
    const input = (await screen.findByLabelText("SoundCloud profile link for TICON")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://example.com/ticon" } });
    fireEvent.click(screen.getByRole("button", { name: "Add link for TICON" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That isn't a soundcloud.com link.");
    expect(input.value).toBe("https://example.com/ticon");
  });
});

describe("EventSoundcloudPanel — the link the public page uses, and Reload (2026-11-16)", () => {
  it("shows a reused automatic link as such, and it can be replaced by a manual one", async () => {
    const fetchMock = stubFetch(
      reply(state([{ name: "NATURALIZE", manualUrl: null, automaticUrl: "https://soundcloud.com/naturalizemusic", automaticFrom: "reused" }])),
      reply(state([{ name: "NATURALIZE", manualUrl: "https://soundcloud.com/naturalize-dk", automaticUrl: "https://soundcloud.com/naturalizemusic", automaticFrom: "reused" }])),
    );
    render(<EventSoundcloudPanel eventId="e-1" />);
    expect(await screen.findByText(/Automatic \(reused from another event or Discogs\):/)).toBeTruthy();
    expect(screen.getByText("soundcloud.com/naturalizemusic")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("SoundCloud profile link for NATURALIZE"), { target: { value: "https://soundcloud.com/naturalize-dk" } });
    fireEvent.click(screen.getByRole("button", { name: "Add link for NATURALIZE" }));
    expect(await screen.findByText(/Manual:/)).toBeTruthy();
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({ artistName: "NATURALIZE", url: "https://soundcloud.com/naturalize-dk" });
  });

  it("Reload re-reads the links, e.g. after automatic matching has finished", async () => {
    const fetchMock = stubFetch(
      reply(state([{ name: "TICON", manualUrl: null, automaticUrl: null }])),
      reply(state([{ name: "TICON", manualUrl: null, automaticUrl: "https://soundcloud.com/ticon", automaticFrom: "reused" }])),
    );
    render(<EventSoundcloudPanel eventId="e-1" />);
    expect(await screen.findByText("No link")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload SoundCloud links" }));
    expect(await screen.findByText("soundcloud.com/ticon")).toBeTruthy();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([URL_, URL_]);
    expect(fetchMock.mock.calls[1][1]).toBeUndefined(); // a plain GET, nothing saved
  });
});
