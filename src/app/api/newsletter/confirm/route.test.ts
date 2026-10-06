import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const confirmSubscriberByTokenMock = vi.fn();
vi.mock("@/db/newsletter", () => ({
  confirmSubscriberByToken: (...args: unknown[]) => confirmSubscriberByTokenMock(...args),
}));
const triggerRetentionSweepMock = vi.fn();
vi.mock("@/lib/newsletter/retentionSweep", () => ({
  triggerRetentionSweep: (...args: unknown[]) => triggerRetentionSweepMock(...args),
}));

import * as route from "./route";
const { POST } = route;

function makeRequest(formFields: Record<string, string>): NextRequest {
  const body = new URLSearchParams(formFields).toString();
  return new NextRequest("http://localhost/api/newsletter/confirm", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

beforeEach(() => {
  confirmSubscriberByTokenMock.mockReset();
  triggerRetentionSweepMock.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/newsletter/confirm", () => {
  it("confirms using the token from the submitted form and redirects to the manage page", async () => {
    confirmSubscriberByTokenMock.mockResolvedValue({ manageToken: "manage-123" });
    const res = await POST(makeRequest({ token: "confirm-123" }));
    expect(confirmSubscriberByTokenMock).toHaveBeenCalledWith("confirm-123");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost/newsletter/manage?token=manage-123&justConfirmed=1");
  });

  it("redirects back to the confirm page with an invalid flag for an unrecognized token", async () => {
    confirmSubscriberByTokenMock.mockResolvedValue(null);
    const res = await POST(makeRequest({ token: "bogus" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost/newsletter/confirm?invalid=1");
  });

  it("redirects to invalid without calling the DB when no token is submitted", async () => {
    const res = await POST(makeRequest({}));
    expect(confirmSubscriberByTokenMock).not.toHaveBeenCalled();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost/newsletter/confirm?invalid=1");
  });

  it("protection against link-scanner/prefetcher auto-confirmation: the route exports no GET handler, so Next.js's App Router rejects a GET with 405 before this module's code ever runs — only an explicit POST (the button submit on the confirm page) can trigger confirmSubscriberByToken", () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });

  it(
    "GDPR final hardening (2026-10-06): triggers the retention sweep on every call, independent of " +
      "the scheduled send workflow — a confirm click is organic traffic that keeps retention alive",
    async () => {
      await POST(makeRequest({ token: "confirm-123" }));
      expect(triggerRetentionSweepMock).toHaveBeenCalledTimes(1);
    },
  );
});
