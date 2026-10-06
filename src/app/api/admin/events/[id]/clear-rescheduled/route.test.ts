import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level test for the admin "clear Rescheduled status" endpoint
 * (rescheduled-status correction, 2026-10-06). adminClearRescheduledStatus
 * is mocked so no real database is touched.
 */

const adminClearRescheduledStatusMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/db/writes", () => ({
  adminClearRescheduledStatus: (...args: unknown[]) => adminClearRescheduledStatusMock(...args),
}));

import { POST } from "./route";

function callPost(id: string) {
  return POST(new Request(`http://localhost/api/admin/events/${id}/clear-rescheduled`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

afterEach(() => {
  adminClearRescheduledStatusMock.mockClear();
});

describe("POST /api/admin/events/[id]/clear-rescheduled", () => {
  it("calls adminClearRescheduledStatus with the event id and returns ok", async () => {
    const res = await callPost("e-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(adminClearRescheduledStatusMock).toHaveBeenCalledWith("e-1");
  });

  it("returns a 400 with the error message when the write throws", async () => {
    adminClearRescheduledStatusMock.mockRejectedValueOnce(new Error("Event e-missing not found"));
    const res = await callPost("e-missing");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Event e-missing not found" });
  });
});
