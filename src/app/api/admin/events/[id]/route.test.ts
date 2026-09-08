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

/**
 * Date-field type-safety regression tests (unified event create/edit model
 * addendum, 2026-09-08 — confirmed admin bug: "e.toISOString is not a
 * function"). Root cause, verified directly from drizzle-orm's installed
 * source (node_modules/drizzle-orm/pg-core/columns/timestamp.ts):
 * PgTimestamp.mapToDriverValue unconditionally calls `.toISOString()` on
 * whatever it's handed, assuming a Date instance. JSON has no Date type, so
 * request.json() always hands this route a plain string for
 * startDatetime/endDatetime — the route must convert before forwarding to
 * applyAdminEventEdit. These tests assert on the exact runtime type
 * (`instanceof Date`) applyAdminEventEditMock receives, not just the
 * response status, since a string that merely *looks* like it round-tripped
 * is exactly what caused the original bug.
 */
describe("PATCH /api/admin/events/[id] — date-field type safety (addendum, 2026-09-08)", () => {
  it("1. existing stored date edited to a new date -> save succeeds, Date instance forwarded", async () => {
    const res = await callPatch("e-1", { startDatetime: "2026-10-15T20:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(applyAdminEventEditMock).toHaveBeenCalledTimes(1);
    const [, forwarded] = applyAdminEventEditMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(forwarded.startDatetime).toBeInstanceOf(Date);
    expect((forwarded.startDatetime as Date).toISOString()).toBe("2026-10-15T20:00:00.000Z");
  });

  it("2. string date input for endDatetime -> save succeeds, converted to a Date before forwarding", async () => {
    const res = await callPatch("e-1", { endDatetime: "2026-10-16T02:00:00.000Z" });
    expect(res.status).toBe(200);
    const [, forwarded] = applyAdminEventEditMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(forwarded.endDatetime).toBeInstanceOf(Date);
    expect((forwarded.endDatetime as Date).toISOString()).toBe("2026-10-16T02:00:00.000Z");
  });

  it("3. empty date where allowed — endDatetime: null clears without being treated as invalid", async () => {
    const res = await callPatch("e-1", { endDatetime: null });
    expect(res.status).toBe(200);
    expect(applyAdminEventEditMock).toHaveBeenCalledWith("e-1", { endDatetime: null });
  });

  it("3b. startDatetime cannot be cleared to null — required field, rejected before reaching the DB", async () => {
    const res = await callPatch("e-1", { startDatetime: null });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/startDatetime/i);
    expect(applyAdminEventEditMock).not.toHaveBeenCalled();
  });

  it("4. date + start/end time combination — both converted to distinct Date instances in one save", async () => {
    const res = await callPatch("e-1", {
      startDatetime: "2026-11-01T21:00:00.000Z",
      endDatetime: "2026-11-02T04:30:00.000Z",
    });
    expect(res.status).toBe(200);
    const [, forwarded] = applyAdminEventEditMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(forwarded.startDatetime).toBeInstanceOf(Date);
    expect(forwarded.endDatetime).toBeInstanceOf(Date);
    expect((forwarded.startDatetime as Date).toISOString()).toBe("2026-11-01T21:00:00.000Z");
    expect((forwarded.endDatetime as Date).toISOString()).toBe("2026-11-02T04:30:00.000Z");
  });

  it("5. no 'toISOString is not a function' runtime error — an invalid date string is rejected with 400, not thrown", async () => {
    await expect(callPatch("e-1", { startDatetime: "not-a-date" })).resolves.toBeDefined();
    const res = await callPatch("e-1", { startDatetime: "not-a-date" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/startDatetime/i);
    expect(json.error).toMatch(/not a valid date/i);
    expect(applyAdminEventEditMock).not.toHaveBeenCalled();
  });

  it("6. no off-by-one-day/timezone shift — the forwarded Date's ISO string matches the submitted instant exactly", async () => {
    // A UTC-midnight instant is the case most likely to shift a day under a
    // naive local-timezone round-trip; asserting toISOString() round-trips
    // byte-for-byte is a direct check that new Date(value) never
    // reinterprets the string through the server's local timezone.
    const res = await callPatch("e-1", { startDatetime: "2026-12-24T00:00:00.000Z" });
    expect(res.status).toBe(200);
    const [, forwarded] = applyAdminEventEditMock.mock.calls[0] as [string, Record<string, unknown>];
    expect((forwarded.startDatetime as Date).toISOString()).toBe("2026-12-24T00:00:00.000Z");
  });
});
