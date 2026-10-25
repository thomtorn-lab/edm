// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import EventYoutubePanel from "./EventYoutubePanel";
import EventManager from "./EventManager";
import type { EventYoutubeAdminState } from "@/db/eventYoutubeAdmin";
import type { EventWithVenue } from "@/lib/queries";

/**
 * The per-event YouTube panel in the published-event edit view (2026-10-24):
 * what it shows for each override state, what each button sends, and that
 * invalid links, missing access and failed saves never look like a save.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const AUTO_MATCH = { artistName: "STEAMBOI", videoId: "AUTOsteamb1", videoTitle: "Auto set", channelTitle: "Auto channel" };
const CHOSEN = { videoId: "Pbb0KmuwYSA", videoTitle: "steamboi | REX Radio", channelTitle: "REX Radio" };
const OVERRIDE = { mode: "video", ...CHOSEN, available: true, unavailableSince: null, updatedAt: "2026-10-24T10:00:00.000Z" };

const AUTO: EventYoutubeAdminState = { eventId: "e-1", status: "auto", shown: AUTO_MATCH, override: null, autoMatch: AUTO_MATCH };
const MANUAL: EventYoutubeAdminState = { eventId: "e-1", status: "manual-video", shown: CHOSEN, override: OVERRIDE, autoMatch: AUTO_MATCH };
const HIDDEN: EventYoutubeAdminState = { eventId: "e-1", status: "manual-hidden", shown: null, override: { ...OVERRIDE, mode: "hidden" }, autoMatch: AUTO_MATCH };
const UNAVAILABLE: EventYoutubeAdminState = {
  eventId: "e-1",
  status: "manual-unavailable",
  shown: null,
  override: { ...OVERRIDE, available: false, unavailableSince: "2026-10-20T05:17:00.000Z" },
  autoMatch: AUTO_MATCH,
};

type Reply = { status?: number; body: unknown };
const ok = (state: EventYoutubeAdminState): Reply => ({ body: { ok: true, state } });

/** fetch mock answering the replies in order (the first is the initial GET). */
function stubFetch(...replies: Reply[]) {
  const fetchMock = vi.fn();
  for (const r of replies) {
    fetchMock.mockResolvedValueOnce({ ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const status = () => screen.findByTestId("youtube-status");
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("EventYoutubePanel — display", () => {
  it("automatic: shows the matched video, linked, labelled Automatic; 'Use automatic' is disabled", async () => {
    const fetchMock = stubFetch(ok(AUTO));
    render(<EventYoutubePanel eventId="e-1" />);
    expect((await status()).textContent).toBe("Automatic");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/events/e-1/youtube");
    const link = screen.getByRole("link", { name: "Auto set" });
    expect(link.getAttribute("href")).toBe("https://www.youtube.com/watch?v=AUTOsteamb1");
    expect(screen.getByText(/Matched automatically for STEAMBOI/)).toBeTruthy();
    expect(button("Use automatic").disabled).toBe(true);
    expect(button("Hide video").disabled).toBe(false);
  });

  it("automatic with no match says no video", async () => {
    stubFetch(ok({ ...AUTO, shown: null, autoMatch: null }));
    render(<EventYoutubePanel eventId="e-1" />);
    await status();
    expect(screen.getByText("no video")).toBeTruthy();
  });

  it("an existing manual override shows as Manually chosen, with the automated match for reference", async () => {
    stubFetch(ok(MANUAL));
    render(<EventYoutubePanel eventId="e-1" />);
    expect((await status()).textContent).toBe("Manually chosen");
    expect(screen.getByRole("link", { name: "steamboi | REX Radio" }).getAttribute("href")).toBe("https://www.youtube.com/watch?v=Pbb0KmuwYSA");
    expect(screen.getByText(/Automatic match would be/)).toBeTruthy();
    expect(screen.getByLabelText("Replace with YouTube link or video id")).toBeTruthy();
    expect(button("Use automatic").disabled).toBe(false);
  });

  it("an existing hidden override shows Hidden by admin, no video, and the previously chosen one", async () => {
    stubFetch(ok(HIDDEN));
    render(<EventYoutubePanel eventId="e-1" />);
    expect((await status()).textContent).toBe("Hidden by admin");
    expect(screen.getByText("no video")).toBeTruthy();
    expect(screen.getByText(/Previously chosen/)).toBeTruthy();
    expect(button("Hide video").disabled).toBe(true);
  });

  it("an override whose video went unavailable says so and shows no video", async () => {
    stubFetch(ok(UNAVAILABLE));
    render(<EventYoutubePanel eventId="e-1" />);
    expect((await status()).textContent).toBe("Manually chosen — unavailable");
    expect(screen.getByText("no video")).toBeTruthy();
    expect(screen.getByText(/no longer public\/embeddable/)).toBeTruthy();
  });

  it("loading only reads: nothing is written just by opening the panel", async () => {
    const fetchMock = stubFetch(ok(MANUAL));
    render(<EventYoutubePanel eventId="e-1" />);
    await status();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toHaveLength(1); // a plain GET, no init
  });
});

describe("EventYoutubePanel — actions", () => {
  it("choose: sends the typed link for this event, then shows the saved state", async () => {
    const fetchMock = stubFetch(ok(AUTO), ok(MANUAL));
    render(<EventYoutubePanel eventId="e-1" />);
    await status();
    fireEvent.change(screen.getByLabelText("YouTube link or video id"), { target: { value: " https://youtu.be/Pbb0KmuwYSA " } });
    fireEvent.click(button("Save video"));
    await vi.waitFor(() => expect(screen.getByTestId("youtube-status").textContent).toBe("Manually chosen"));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/events/e-1/youtube", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "video", video: "https://youtu.be/Pbb0KmuwYSA" }),
    });
    expect(screen.getByRole("status").textContent).toMatch(/Saved/);
    expect((screen.getByLabelText("Replace with YouTube link or video id") as HTMLInputElement).value).toBe("");
  });

  it("change: replacing an existing manual video sends the new one", async () => {
    const fetchMock = stubFetch(ok(MANUAL), ok({ ...MANUAL, shown: { videoId: "dQw4w9WgXcQ", videoTitle: "New", channelTitle: null } }));
    render(<EventYoutubePanel eventId="e-1" />);
    await status();
    fireEvent.change(screen.getByLabelText("Replace with YouTube link or video id"), { target: { value: "dQw4w9WgXcQ" } });
    fireEvent.click(button("Save video"));
    await screen.findByRole("link", { name: "New" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ mode: "video", video: "dQw4w9WgXcQ" });
  });

  it("hide: sends mode hidden", async () => {
    const fetchMock = stubFetch(ok(MANUAL), ok(HIDDEN));
    render(<EventYoutubePanel eventId="e-1" />);
    await status();
    fireEvent.click(button("Hide video"));
    await vi.waitFor(() => expect(screen.getByTestId("youtube-status").textContent).toBe("Hidden by admin"));
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PUT", body: JSON.stringify({ mode: "hidden" }) });
  });

  it("back to automatic: sends DELETE", async () => {
    const fetchMock = stubFetch(ok(HIDDEN), ok(AUTO));
    render(<EventYoutubePanel eventId="e-1" />);
    await status();
    fireEvent.click(button("Use automatic"));
    await vi.waitFor(() => expect(screen.getByTestId("youtube-status").textContent).toBe("Automatic"));
    expect(fetchMock.mock.calls[1]).toEqual(["/api/admin/events/e-1/youtube", { method: "DELETE" }]);
  });

  it("an invalid link is refused in the browser and never sent", async () => {
    const fetchMock = stubFetch(ok(AUTO));
    render(<EventYoutubePanel eventId="e-1" />);
    await status();
    fireEvent.change(screen.getByLabelText("YouTube link or video id"), { target: { value: "https://vimeo.com/123" } });
    fireEvent.click(button("Save video"));
    expect(screen.getByRole("alert").textContent).toMatch(/isn't a YouTube video link/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("youtube-status").textContent).toBe("Automatic");
  });

  it("a server-side refusal (e.g. private video) shows its message and keeps the previous state and the typed value", async () => {
    stubFetch(ok(AUTO), { status: 400, body: { error: "Video Pbb0KmuwYSA can't be shown on the site — nothing was saved." } });
    render(<EventYoutubePanel eventId="e-1" />);
    await status();
    fireEvent.change(screen.getByLabelText("YouTube link or video id"), { target: { value: "Pbb0KmuwYSA" } });
    fireEvent.click(button("Save video"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/nothing was saved/);
    expect(screen.getByTestId("youtube-status").textContent).toBe("Automatic");
    expect((screen.getByLabelText("YouTube link or video id") as HTMLInputElement).value).toBe("Pbb0KmuwYSA");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a storage failure (500) or a network error is shown as an error, never as saved", async () => {
    stubFetch(ok(MANUAL), { status: 500, body: { error: "Hiding the video failed — reload to see the current state." } });
    render(<EventYoutubePanel eventId="e-1" />);
    await status();
    fireEvent.click(button("Hide video"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Hiding the video failed/);
    expect(screen.getByTestId("youtube-status").textContent).toBe("Manually chosen");

    cleanup();
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ok(MANUAL).body }).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    render(<EventYoutubePanel eventId="e-1" />);
    await status();
    fireEvent.click(button("Use automatic"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Saving failed/);
    expect(screen.getByTestId("youtube-status").textContent).toBe("Manually chosen");
  });

  it("missing access (401 from the admin proxy) shows an error, no state, and no enabled write buttons", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => { throw new SyntaxError("not json"); } }));
    render(<EventYoutubePanel eventId="e-1" />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't load/);
    expect(screen.queryByTestId("youtube-status")).toBeNull();
    expect(button("Save video").disabled).toBe(true);
    expect(button("Hide video").disabled).toBe(true);
    expect(button("Use automatic").disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("EventManager integration", () => {
  const base = { title: "x", slug: "x", description: null, artists: ["A"], startDatetime: "2026-11-20T20:00:00.000Z", endDatetime: null, venueId: "v", subVenue: null, primaryGenre: "techno", subgenres: ["techno"], officialEventUrl: null, ticketUrl: null, facebookUrl: null, residentAdvisorUrl: null, priceFrom: null, soldOut: false, cancelled: false, postponed: false, dateChanged: false, timeChanged: false, published: true, adminUnpublishReason: null, adminUnpublishNote: null, sourceCancelledAt: null, overriddenFields: [], venue: { id: "v", name: "Venue" } };
  const events = [
    { ...base, id: "e-aaaaaaaa", title: "Event A" },
    { ...base, id: "e-bbbbbbbb", title: "Event B" },
  ] as unknown as EventWithVenue[];

  it("the panel appears in the edit view only, loads for the edited event only, and the event form's Save never touches it", async () => {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (url.endsWith("/youtube") ? { ok: true, state: { ...AUTO, eventId: "e-aaaaaaaa" } } : { ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={events} venues={[]} />);
    expect(screen.queryByRole("region", { name: "YouTube video" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    const rowA = screen.getByText("Event A").closest("li")!;
    fireEvent.click(within(rowA).getByRole("button", { name: "Edit" }));
    expect(await within(rowA).findByTestId("youtube-status")).toBeTruthy();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/admin/events/e-aaaaaaaa/youtube"]);

    fireEvent.change(within(rowA).getByLabelText("Title"), { target: { value: "Event A (fixed)" } });
    fireEvent.click(within(rowA).getByRole("button", { name: /Save \(marks/ }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/admin/events/e-aaaaaaaa");
    expect(JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({ patch: { title: "Event A (fixed)" } });
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("e-bbbbbbbb"))).toBe(false);
  });
});
