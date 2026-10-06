import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requestSubscriptionMock = vi.fn();
const sendEmailMock = vi.fn();
const triggerRetentionSweepMock = vi.fn();

vi.mock("@/db/newsletter", () => ({
  requestSubscription: (...args: unknown[]) => requestSubscriptionMock(...args),
}));
vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));
vi.mock("@/lib/newsletter/retentionSweep", () => ({
  triggerRetentionSweep: (...args: unknown[]) => triggerRetentionSweepMock(...args),
}));

import { POST } from "./route";

function makeRequest(body: unknown, ip = "10.0.1.1"): NextRequest {
  return new NextRequest("http://localhost/api/newsletter/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requestSubscriptionMock.mockReset();
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue(undefined);
  triggerRetentionSweepMock.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/newsletter/subscribe", () => {
  it("returns 503 when the feature flag is off", async () => {
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "false");
    const res = await POST(makeRequest({ email: "a@example.com" }));
    expect(res.status).toBe(503);
    expect(requestSubscriptionMock).not.toHaveBeenCalled();
  });

  it(
    "GDPR final hardening (2026-10-06): triggers the retention sweep even when the feature flag is off — " +
      "retention must not depend on signup being currently enabled",
    async () => {
      vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "false");
      await POST(makeRequest({ email: "a@example.com" }));
      expect(triggerRetentionSweepMock).toHaveBeenCalledTimes(1);
    },
  );

  it("sends a confirmation email and returns ok for a new subscription", async () => {
    requestSubscriptionMock.mockResolvedValue({ confirmToken: "tok-123" });
    const res = await POST(makeRequest({ email: "a@example.com" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@example.com", subject: expect.stringContaining("Confirm") }),
    );
    const text = sendEmailMock.mock.calls[0][0].text as string;
    expect(text).toContain("tok-123");
  });

  it("returns ok without sending an email when the address is already confirmed (never leaks subscription status)", async () => {
    requestSubscriptionMock.mockResolvedValue(null);
    const res = await POST(makeRequest({ email: "already@example.com" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid email with 400 and never calls requestSubscription", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(requestSubscriptionMock).not.toHaveBeenCalled();
  });

  it("honeypot: a filled 'company' field returns a fake success without subscribing", async () => {
    const res = await POST(makeRequest({ email: "bot@example.com", company: "Acme Bots Inc" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(requestSubscriptionMock).not.toHaveBeenCalled();
  });

  it("rate-limits repeated requests from the same IP", async () => {
    requestSubscriptionMock.mockResolvedValue({ confirmToken: "tok" });
    const ip = "10.0.2.2";
    for (let i = 0; i < 5; i++) {
      await POST(makeRequest({ email: `user${i}@example.com` }, ip));
    }
    const res = await POST(makeRequest({ email: "one-more@example.com" }, ip));
    expect(res.status).toBe(429);
  });

  it("returns 502 if sending the confirmation email fails", async () => {
    requestSubscriptionMock.mockResolvedValue({ confirmToken: "tok" });
    sendEmailMock.mockRejectedValue(new Error("Resend down"));
    const res = await POST(makeRequest({ email: "a@example.com" }, "10.0.3.3"));
    expect(res.status).toBe(502);
  });
});
