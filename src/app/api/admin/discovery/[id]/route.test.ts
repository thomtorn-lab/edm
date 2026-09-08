import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for the Discovery Queue admin edit endpoint. Mirrors
 * src/app/api/admin/events/[id]/route.test.ts's pattern (same PATCH-with-
 * mocked-write-layer shape), scoped to what this handler is responsible
 * for: URL-field validation and — addendum, 2026-09-08 — date-field type
 * safety for probableStart/probableEnd, so "Analyze, DQ edit, and Published
 * edit must use the same date semantics" is actually verified, not just
 * asserted in a comment. updateDiscoveryItem is mocked so no real database
 * is touched.
 */

const updateDiscoveryItemMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/db/writes", () => ({
  updateDiscoveryItem: (...args: unknown[]) => updateDiscoveryItemMock(...args),
}));

import { PATCH } from "./route";

function makeRequest(id: string, patch: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/admin/discovery/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ patch }),
  });
}

function callPatch(id: string, patch: unknown) {
  return PATCH(makeRequest(id, patch), { params: Promise.resolve({ id }) });
}

afterEach(() => {
  updateDiscoveryItemMock.mockClear();
});

describe("PATCH /api/admin/discovery/[id] — URL field validation", () => {
  it("accepts a valid Resident Advisor URL", async () => {
    const res = await callPatch("dq-1", { probableResidentAdvisorUrl: "https://ra.co/events/1" });
    expect(res.status).toBe(200);
    expect(updateDiscoveryItemMock).toHaveBeenCalledWith("dq-1", { probableResidentAdvisorUrl: "https://ra.co/events/1" });
  });

  it("rejects a malformed official event URL with 400", async () => {
    const res = await callPatch("dq-1", { probableOfficialEventUrl: "not a url" });
    expect(res.status).toBe(400);
    expect(updateDiscoveryItemMock).not.toHaveBeenCalled();
  });
});

/**
 * Date-field type-safety regression tests (unified event create/edit model
 * addendum, 2026-09-08). Root cause is the same as the published-event
 * route's own (see that route's test file for the full drizzle-orm
 * citation) — this route already converted probableStart/probableEnd
 * before the addendum, so these tests exist mainly to lock in parity: an
 * invalid date is now rejected with the same 400 the events route gives,
 * and a valid one is forwarded as an actual Date instance.
 */
describe("PATCH /api/admin/discovery/[id] — date-field type safety (addendum, 2026-09-08)", () => {
  it("1. existing stored date edited to a new date -> save succeeds, Date instance forwarded", async () => {
    const res = await callPatch("dq-1", { probableStart: "2026-10-15T20:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(updateDiscoveryItemMock).toHaveBeenCalledTimes(1);
    const [, forwarded] = updateDiscoveryItemMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(forwarded.probableStart).toBeInstanceOf(Date);
    expect((forwarded.probableStart as Date).toISOString()).toBe("2026-10-15T20:00:00.000Z");
  });

  it("2. string date input for probableEnd -> save succeeds, converted to a Date before forwarding", async () => {
    const res = await callPatch("dq-1", { probableEnd: "2026-10-16T02:00:00.000Z" });
    expect(res.status).toBe(200);
    const [, forwarded] = updateDiscoveryItemMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(forwarded.probableEnd).toBeInstanceOf(Date);
    expect((forwarded.probableEnd as Date).toISOString()).toBe("2026-10-16T02:00:00.000Z");
  });

  it("3. empty date where allowed — probableStart: null clears without being treated as invalid (unresolved date is a normal DQ state)", async () => {
    const res = await callPatch("dq-1", { probableStart: null });
    expect(res.status).toBe(200);
    expect(updateDiscoveryItemMock).toHaveBeenCalledWith("dq-1", { probableStart: null });
  });

  it("3b. probableEnd: null clears without being treated as invalid", async () => {
    const res = await callPatch("dq-1", { probableEnd: null });
    expect(res.status).toBe(200);
    expect(updateDiscoveryItemMock).toHaveBeenCalledWith("dq-1", { probableEnd: null });
  });

  it("4. date + start/end time combination — both converted to distinct Date instances in one save", async () => {
    const res = await callPatch("dq-1", {
      probableStart: "2026-11-01T21:00:00.000Z",
      probableEnd: "2026-11-02T04:30:00.000Z",
    });
    expect(res.status).toBe(200);
    const [, forwarded] = updateDiscoveryItemMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(forwarded.probableStart).toBeInstanceOf(Date);
    expect(forwarded.probableEnd).toBeInstanceOf(Date);
    expect((forwarded.probableStart as Date).toISOString()).toBe("2026-11-01T21:00:00.000Z");
    expect((forwarded.probableEnd as Date).toISOString()).toBe("2026-11-02T04:30:00.000Z");
  });

  it("5. no 'toISOString is not a function' runtime error — an invalid date string is rejected with 400, not thrown", async () => {
    const res = await callPatch("dq-1", { probableStart: "not-a-date" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/probableStart/i);
    expect(json.error).toMatch(/not a valid date/i);
    expect(updateDiscoveryItemMock).not.toHaveBeenCalled();
  });

  it("6. no off-by-one-day/timezone shift — the forwarded Date's ISO string matches the submitted instant exactly", async () => {
    const res = await callPatch("dq-1", { probableStart: "2026-12-24T00:00:00.000Z" });
    expect(res.status).toBe(200);
    const [, forwarded] = updateDiscoveryItemMock.mock.calls[0] as [string, Record<string, unknown>];
    expect((forwarded.probableStart as Date).toISOString()).toBe("2026-12-24T00:00:00.000Z");
  });
});
