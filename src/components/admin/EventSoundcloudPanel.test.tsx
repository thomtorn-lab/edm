// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EventSoundcloudPanel from "./EventSoundcloudPanel";
import type { EventSoundcloudAdminState } from "@/db/eventSoundcloudAdmin";

/** Admin-entered artist SoundCloud links (2026-11-15): one input per lineup artist, saved on its own button. */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STATE: EventSoundcloudAdminState = { eventId: "e-1", lineup: ["GUY J", "Rós"], links: { "GUY J": "https://soundcloud.com/guy-j" } };

function stubFetch(...bodies: { status?: number; body: unknown }[]) {
  const fetchMock = vi.fn();
  for (const r of bodies) fetchMock.mockResolvedValueOnce({ ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("EventSoundcloudPanel", () => {
  it("shows one input per lineup artist, pre-filled with saved links", async () => {
    const fetchMock = stubFetch({ body: { ok: true, state: STATE } });
    render(<EventSoundcloudPanel eventId="e-1" />);
    expect(((await screen.findByLabelText("GUY J")) as HTMLInputElement).value).toBe("https://soundcloud.com/guy-j");
    expect((screen.getByLabelText("Rós") as HTMLInputElement).value).toBe("");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/events/e-1/soundcloud");
  });

  it("saves every lineup name with its link (empty clears) and shows the saved state", async () => {
    const saved = { ...STATE, links: { "GUY J": "https://soundcloud.com/guy-j", "Rós": "https://soundcloud.com/ros" } };
    const fetchMock = stubFetch({ body: { ok: true, state: STATE } }, { body: { ok: true, state: saved } });
    render(<EventSoundcloudPanel eventId="e-1" />);
    fireEvent.change(await screen.findByLabelText("Rós"), { target: { value: "https://soundcloud.com/Ros" } });
    fireEvent.click(screen.getByRole("button", { name: "Save SoundCloud links" }));
    expect((await screen.findByRole("status")).textContent).toContain("Saved");
    const [path, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(path).toBe("/api/admin/events/e-1/soundcloud");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      links: [
        { artistName: "GUY J", url: "https://soundcloud.com/guy-j" },
        { artistName: "Rós", url: "https://soundcloud.com/Ros" },
      ],
    });
  });

  it("refuses a track link before sending anything", async () => {
    const fetchMock = stubFetch({ body: { ok: true, state: STATE } });
    render(<EventSoundcloudPanel eventId="e-1" />);
    fireEvent.change(await screen.findByLabelText("Rós"), { target: { value: "https://soundcloud.com/ros/a-track" } });
    fireEvent.click(screen.getByRole("button", { name: "Save SoundCloud links" }));
    expect((await screen.findByRole("alert")).textContent).toContain("nothing was saved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks for a lineup first when the event has none", async () => {
    stubFetch({ body: { ok: true, state: { eventId: "e-1", lineup: [], links: {} } } });
    render(<EventSoundcloudPanel eventId="e-1" />);
    expect(await screen.findByText(/No lineup yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save SoundCloud links" })).toBeNull();
  });
});
