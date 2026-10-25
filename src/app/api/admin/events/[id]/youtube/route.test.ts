import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for the admin per-event YouTube video endpoint
 * (2026-10-24): body handling and status mapping. The service
 * (src/db/eventYoutubeAdmin.ts, tested on its own) is mocked except for its
 * error class, so no database or YouTube call happens.
 */

const getEventYoutubeAdminState = vi.fn();
const setEventYoutubeVideo = vi.fn();
const hideEventYoutubeVideo = vi.fn();
const resetEventYoutubeToAuto = vi.fn();

vi.mock("@/db/eventYoutubeAdmin", async () => {
  class EventYoutubeAdminError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return { EventYoutubeAdminError, getEventYoutubeAdminState, setEventYoutubeVideo, hideEventYoutubeVideo, resetEventYoutubeToAuto };
});

const { GET, PUT, DELETE } = await import("./route");
const { EventYoutubeAdminError } = await import("@/db/eventYoutubeAdmin");

const STATE = { eventId: "e-1", status: "manual-video", shown: { videoId: "Pbb0KmuwYSA", videoTitle: "t", channelTitle: "c" }, override: null, autoMatch: null };
const ctx = (id = "e-1") => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/admin/events/e-1/youtube", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("/api/admin/events/[id]/youtube", () => {
  it("GET returns the state for the event in the URL", async () => {
    getEventYoutubeAdminState.mockResolvedValue(STATE);
    const res = await GET(req("GET"), ctx("e-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, state: STATE });
    expect(getEventYoutubeAdminState).toHaveBeenCalledWith("e-1");
  });

  it('PUT { mode: "video" } saves the given link for this event and returns the new state', async () => {
    setEventYoutubeVideo.mockResolvedValue(STATE);
    const res = await PUT(req("PUT", { mode: "video", video: "https://youtu.be/Pbb0KmuwYSA" }), ctx("e-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).state).toEqual(STATE);
    expect(setEventYoutubeVideo).toHaveBeenCalledWith("e-1", "https://youtu.be/Pbb0KmuwYSA");
    expect(hideEventYoutubeVideo).not.toHaveBeenCalled();
  });

  it('PUT { mode: "hidden" } hides the video on this event', async () => {
    hideEventYoutubeVideo.mockResolvedValue({ ...STATE, status: "manual-hidden", shown: null });
    const res = await PUT(req("PUT", { mode: "hidden" }), ctx("e-1"));
    expect(res.status).toBe(200);
    expect(hideEventYoutubeVideo).toHaveBeenCalledWith("e-1");
    expect(setEventYoutubeVideo).not.toHaveBeenCalled();
  });

  it("DELETE goes back to automatic for this event", async () => {
    resetEventYoutubeToAuto.mockResolvedValue({ ...STATE, status: "auto" });
    const res = await DELETE(req("DELETE"), ctx("e-1"));
    expect(res.status).toBe(200);
    expect(resetEventYoutubeToAuto).toHaveBeenCalledWith("e-1");
  });

  it.each([["no body", undefined], ["invalid JSON", "{nope"], ["unknown mode", { mode: "auto" }], ["array", []]])(
    "PUT with %s is a 400 and calls nothing",
    async (_label, body) => {
      const res = await PUT(req("PUT", body), ctx());
      expect(res.status).toBe(400);
      expect(setEventYoutubeVideo).not.toHaveBeenCalled();
      expect(hideEventYoutubeVideo).not.toHaveBeenCalled();
    },
  );

  it("a validation refusal keeps its status and message (invalid link → 400, unknown event → 404, YouTube down → 502)", async () => {
    for (const [status, message] of [
      [400, "That isn't a YouTube video link"],
      [404, "No event with id e-1."],
      [502, "Couldn't check the video with YouTube"],
    ] as const) {
      setEventYoutubeVideo.mockRejectedValueOnce(new EventYoutubeAdminError(message, status));
      const res = await PUT(req("PUT", { mode: "video", video: "x" }), ctx());
      expect(res.status).toBe(status);
      expect((await res.json()).error).toBe(message);
    }
  });

  it("a storage failure is a 500 with a generic message — the database error itself is logged, not returned", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [call, mock] of [
      [() => PUT(req("PUT", { mode: "video", video: "Pbb0KmuwYSA" }), ctx()), setEventYoutubeVideo],
      [() => PUT(req("PUT", { mode: "hidden" }), ctx()), hideEventYoutubeVideo],
      [() => DELETE(req("DELETE"), ctx()), resetEventYoutubeToAuto],
      [() => GET(req("GET"), ctx()), getEventYoutubeAdminState],
    ] as const) {
      mock.mockRejectedValueOnce(new Error("password authentication failed for user neondb_owner"));
      const res = await call();
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBeUndefined();
      expect(json.error).not.toContain("neondb_owner");
    }
    expect(log).toHaveBeenCalled();
  });
});
