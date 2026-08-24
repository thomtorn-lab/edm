import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy, config } from "./proxy";

/**
 * Security verification (venue-ingestion-decoupling pre-merge audit): the
 * new POST /api/admin/venues route (src/app/api/admin/venues/route.ts) has
 * no inline auth check of its own — like every other /api/admin/* write
 * route (discovery publish/ignore/merge, events hide/unhide, extract), it
 * relies entirely on this proxy running first. That reliance is only safe
 * if the matcher genuinely covers the new path and the auth check itself is
 * fail-closed — both verified directly here, against the real proxy()
 * function and the real matcher config, not a re-implementation of either.
 */

function makeRequest(pathname: string, authHeader?: string): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

describe("proxy — matcher covers the new venue-creation route", () => {
  it("includes /api/admin/:path* so /api/admin/venues is covered without needing its own matcher entry", () => {
    expect(config.matcher).toContain("/api/admin/:path*");
  });
});

describe("proxy — POST /api/admin/venues is gated exactly like every other admin write route", () => {
  const ORIGINAL_USER = process.env.ADMIN_USERNAME;
  const ORIGINAL_PASS = process.env.ADMIN_PASSWORD;

  afterEach(() => {
    process.env.ADMIN_USERNAME = ORIGINAL_USER;
    process.env.ADMIN_PASSWORD = ORIGINAL_PASS;
  });

  it("fails closed (401) when no credentials are configured at all, even with no Authorization header sent", () => {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    const res = proxy(makeRequest("/api/admin/venues"));
    expect(res.status).toBe(401);
  });

  describe("with credentials configured", () => {
    beforeEach(() => {
      process.env.ADMIN_USERNAME = "test-admin";
      process.env.ADMIN_PASSWORD = "test-secret";
    });

    it("rejects an unauthenticated POST with no Authorization header — cannot create a venue", () => {
      const res = proxy(makeRequest("/api/admin/venues"));
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toContain("Basic");
    });

    it("rejects a request with the wrong credentials", () => {
      const res = proxy(makeRequest("/api/admin/venues", basicAuthHeader("test-admin", "wrong-password")));
      expect(res.status).toBe(401);
    });

    it("rejects a malformed (non-Basic) Authorization header", () => {
      const res = proxy(makeRequest("/api/admin/venues", "Bearer some-token"));
      expect(res.status).toBe(401);
    });

    it("lets a correctly authenticated admin request through to the route handler", () => {
      const res = proxy(makeRequest("/api/admin/venues", basicAuthHeader("test-admin", "test-secret")));
      // NextResponse.next() carries the x-middleware-next marker rather than
      // a 401/redirect — this is the "proceed to the route" outcome.
      expect(res.status).not.toBe(401);
    });
  });
});
