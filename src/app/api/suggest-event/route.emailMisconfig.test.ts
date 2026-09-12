import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * End-to-end reproduction of the real Production failure mode (Public forms
 * — Contact + Suggest an event fail in Production investigation, 2026-09-12):
 * unlike route.test.ts, which mocks `@/lib/email` itself (so it only proves
 * the route reacts correctly to *some* rejection), this drives the REAL
 * `sendEmail` from `@/lib/email` — only the `resend` package's network
 * client is mocked, exactly like email.test.ts — so a genuinely missing env
 * var or a genuine Resend API error propagates through the real code path
 * `/api/suggest-event` runs in Production: route -> sendEmail -> Resend SDK.
 * Confirms the public response stays generic (no leaked var names/API
 * errors) even when the underlying failure is the real thing, not a stand-in.
 * Both /api/contact and /api/suggest-event share this exact chain, so a
 * Production misconfiguration here breaks both forms identically — see the
 * sibling test file at src/app/api/contact/route.emailMisconfig.test.ts.
 */

const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { POST } from "./route";

const ORIGINAL_ENV = process.env;
const VALID_BODY = {
  eventName: "Warehouse Night",
  date: "12 Sept 2026",
  venue: "Culture Box",
  eventUrl: "https://ra.co/events/123",
  contactEmail: "tipster@example.com",
  note: "Recurring monthly",
};

function makeRequest(body: unknown, ip: string): NextRequest {
  return new NextRequest("http://localhost/api/suggest-event", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    RESEND_API_KEY: "test-api-key",
    CONTACT_RECIPIENT_EMAIL: "recipient@example.com",
    CONTACT_FROM_EMAIL: "Electronic CPH <hello@send.electroniccph.com>",
  };
  sendMock.mockReset();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("POST /api/suggest-event — real Production failure conditions (not a mocked stand-in)", () => {
  it("all three env vars unset (the exact real Production misconfiguration this session's history found once already, 2026-08-29) -> generic 502, no var names leaked, Resend never called", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.CONTACT_RECIPIENT_EMAIL;
    delete process.env.CONTACT_FROM_EMAIL;

    const res = await POST(makeRequest(VALID_BODY, "10.0.9.11"));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Something went wrong sending your suggestion. Please try again later.");
    expect(body.error).not.toMatch(/RESEND_API_KEY|CONTACT_RECIPIENT_EMAIL|CONTACT_FROM_EMAIL|not configured/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("only RESEND_API_KEY unset -> same generic 502, Resend never called", async () => {
    delete process.env.RESEND_API_KEY;

    const res = await POST(makeRequest(VALID_BODY, "10.0.9.12"));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Something went wrong sending your suggestion. Please try again later.");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("only CONTACT_FROM_EMAIL unset -> same generic 502, Resend never called", async () => {
    delete process.env.CONTACT_FROM_EMAIL;

    const res = await POST(makeRequest(VALID_BODY, "10.0.9.13"));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Something went wrong sending your suggestion. Please try again later.");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("only CONTACT_RECIPIENT_EMAIL unset -> same generic 502, Resend never called", async () => {
    delete process.env.CONTACT_RECIPIENT_EMAIL;

    const res = await POST(makeRequest(VALID_BODY, "10.0.9.14"));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Something went wrong sending your suggestion. Please try again later.");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("env vars all present but Resend itself rejects (e.g. unverified sending domain, revoked key, suspended account) -> generic 502, real Resend error never reaches the public response", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "The gmail.com domain is not verified. Please add and verify your domain on https://resend.com/domains" } });

    const res = await POST(makeRequest(VALID_BODY, "10.0.9.15"));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Something went wrong sending your suggestion. Please try again later.");
    expect(body.error).not.toMatch(/domain|resend\.com|verify/i);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("fully configured and Resend accepts -> real success path end to end", async () => {
    sendMock.mockResolvedValue({ data: { id: "email_abc123" }, error: null });

    const res = await POST(makeRequest(VALID_BODY, "10.0.9.16"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
