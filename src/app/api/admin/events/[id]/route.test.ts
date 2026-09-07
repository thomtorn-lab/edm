import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for the generic admin event-edit endpoint, scoped to
 * what this handler itself is responsible for: rejecting non-editable
 * fields and — new for event-level link editing, 2026-09-07 — validating
 * officialEventUrl/ticketUrl format before ever reaching applyAdminEventEdit.
 * applyAdminEventEdit is mocked so no real database is touched.
 */

const applyAdminEventEditMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/db/writes", () => ({
  applyAdminEventEdit: (...args: unknown[]) => applyAdminEventEditMock(...args),
}));

import { PATCH } from "./route";

function makeRequest(id: string, patch: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/admin/events/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ patch }),
  });
}

function callPatch(id: string, patch: unknown) {
  return PATCH(makeRequest(id, patch), { params: Promise.resolve({ id }) });
}

afterEach(() => {
  applyAdminEventEditMock.mockClear();
});

describe("PATCH /api/admin/events/[id] — officialEventUrl/ticketUrl validation", () => {
  it("accepts a valid Official Event URL and forwards it verbatim", async () => {
    const res = await callPatch("e-1", { officialEventUrl: "https://venue.example.com/events/night" });
    expect(res.status).toBe(200);
    expect(applyAdminEventEditMock).toHaveBeenCalledWith("e-1", { officialEventUrl: "https://venue.example.com/events/night" });
  });

  it("accepts a valid Tickets URL", async () => {
    const res = await callPatch("e-1", { ticketUrl: "https://tickets.example.com/e/1" });
    expect(res.status).toBe(200);
    expect(applyAdminEventEditMock).toHaveBeenCalledWith("e-1", { ticketUrl: "https://tickets.example.com/e/1" });
  });

  it("accepts null (clear) for officialEventUrl without validating it as a URL", async () => {
    const res = await callPatch("e-1", { officialEventUrl: null });
    expect(res.status).toBe(200);
    expect(applyAdminEventEditMock).toHaveBeenCalledWith("e-1", { officialEventUrl: null });
  });

  it("accepts null (clear) for ticketUrl", async () => {
    const res = await callPatch("e-1", { ticketUrl: null });
    expect(res.status).toBe(200);
    expect(applyAdminEventEditMock).toHaveBeenCalledWith("e-1", { ticketUrl: null });
  });

  it("rejects a malformed Official Event URL with 400 and never calls applyAdminEventEdit", async () => {
    const res = await callPatch("e-1", { officialEventUrl: "not a url" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/officialEventUrl/);
    expect(applyAdminEventEditMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed Tickets URL with 400", async () => {
    const res = await callPatch("e-1", { ticketUrl: "ftp://example.com/x" });
    expect(res.status).toBe(400);
    expect(applyAdminEventEditMock).not.toHaveBeenCalled();
  });

  it("rejects a non-editable field", async () => {
    const res = await callPatch("e-1", { canonicalSourceId: "src-billetto" });
    expect(res.status).toBe(400);
    expect(applyAdminEventEditMock).not.toHaveBeenCalled();
  });

  it("edits to one event never target another — each PATCH forwards its own id", async () => {
    await callPatch("e-A", { officialEventUrl: "https://a.example.com" });
    await callPatch("e-B", { officialEventUrl: "https://b.example.com" });

    expect(applyAdminEventEditMock).toHaveBeenNthCalledWith(1, "e-A", { officialEventUrl: "https://a.example.com" });
    expect(applyAdminEventEditMock).toHaveBeenNthCalledWith(2, "e-B", { officialEventUrl: "https://b.example.com" });
  });
});
