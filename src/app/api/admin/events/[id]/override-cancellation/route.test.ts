import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level test for the admin source-cancellation override endpoint
 * (source-driven cancellation safety, 2026-09-07, Section 5).
 * adminOverrideSourceCancellation is mocked so no real database is touched.
 */

const adminOverrideSourceCancellationMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/db/writes", () => ({
  adminOverrideSourceCancellation: (...args: unknown[]) => adminOverrideSourceCancellationMock(...args),
}));

import { POST } from "./route";

function callPost(id: string) {
  return POST(new Request(`http://localhost/api/admin/events/${id}/override-cancellation`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

afterEach(() => {
  adminOverrideSourceCancellationMock.mockClear();
});

describe("POST /api/admin/events/[id]/override-cancellation", () => {
  it("calls adminOverrideSourceCancellation with the event id and returns ok", async () => {
    const res = await callPost("e-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(adminOverrideSourceCancellationMock).toHaveBeenCalledWith("e-1");
  });

  it("returns a 400 with the error message when the write throws", async () => {
    adminOverrideSourceCancellationMock.mockRejectedValueOnce(new Error("Event e-missing not found"));
    const res = await callPost("e-missing");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Event e-missing not found" });
  });
});
