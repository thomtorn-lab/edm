import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const unsubscribeByManageTokenMock = vi.fn();
vi.mock("@/db/newsletter", () => ({
  unsubscribeByManageToken: (...args: unknown[]) => unsubscribeByManageTokenMock(...args),
}));
const triggerRetentionSweepMock = vi.fn();
vi.mock("@/lib/newsletter/retentionSweep", () => ({
  triggerRetentionSweep: (...args: unknown[]) => triggerRetentionSweepMock(...args),
}));

import * as route from "./route";
const { POST } = route;

function makeRequest(url: string, body?: string): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: body ? { "content-type": "application/x-www-form-urlencoded" } : {},
    body,
  });
}

beforeEach(() => {
  unsubscribeByManageTokenMock.mockReset();
  unsubscribeByManageTokenMock.mockResolvedValue(true);
  triggerRetentionSweepMock.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/newsletter/unsubscribe", () => {
  it("unsubscribes using the token from the query string", async () => {
    const res = await POST(makeRequest("http://localhost/api/newsletter/unsubscribe?token=manage-tok-1"));
    expect(unsubscribeByManageTokenMock).toHaveBeenCalledWith("manage-tok-1");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("handles an RFC 8058 one-click POST body (List-Unsubscribe=One-Click) the same way — token still comes from the query string", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/newsletter/unsubscribe?token=manage-tok-2", "List-Unsubscribe=One-Click"),
    );
    expect(unsubscribeByManageTokenMock).toHaveBeenCalledWith("manage-tok-2");
    expect(res.status).toBe(200);
  });

  it("always returns 200 even for a missing/invalid token (never reveals validity)", async () => {
    const res = await POST(makeRequest("http://localhost/api/newsletter/unsubscribe"));
    expect(unsubscribeByManageTokenMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("always returns 200 even when the token doesn't match any subscriber", async () => {
    unsubscribeByManageTokenMock.mockResolvedValue(false);
    const res = await POST(makeRequest("http://localhost/api/newsletter/unsubscribe?token=unknown"));
    expect(res.status).toBe(200);
  });

  it("protection against accidental unsubscribe from GET requests or link scanners: the route exports no GET handler, so Next.js's App Router rejects a GET with 405 before this module's code ever runs — only a POST (as RFC 8058's List-Unsubscribe-Post requires) can trigger unsubscribeByManageToken", () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });

  it(
    "GDPR final hardening (2026-10-06): triggers the retention sweep on every call, independent of " +
      "the scheduled send workflow — an unsubscribe click is organic traffic that keeps retention alive",
    async () => {
      await POST(makeRequest("http://localhost/api/newsletter/unsubscribe?token=manage-tok-1"));
      expect(triggerRetentionSweepMock).toHaveBeenCalledTimes(1);
    },
  );
});
