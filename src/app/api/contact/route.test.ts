import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sendEmailMock = vi.fn();

vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

import { POST } from "./route";

function makeRequest(body: unknown, ip: string): NextRequest {
  return new NextRequest("http://localhost/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue(undefined);
});

describe("POST /api/contact", () => {
  it("sends an email and returns ok for a valid submission", async () => {
    const res = await POST(
      makeRequest({ name: "Ada", email: "ada@example.com", message: "Hello there" }, "10.0.1.1")
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "[Electronic CPH] Contact",
        replyTo: "ada@example.com",
        text: expect.stringContaining("Hello there"),
      })
    );
  });

  it("rejects an invalid email with 400 and does not send", async () => {
    const res = await POST(
      makeRequest({ name: "Ada", email: "not-an-email", message: "Hello" }, "10.0.1.2")
    );

    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("rejects missing required fields with 400", async () => {
    const res = await POST(makeRequest({ name: "", email: "ada@example.com", message: "" }, "10.0.1.3"));

    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("accepts silently but never sends when the honeypot field is filled", async () => {
    const res = await POST(
      makeRequest(
        { name: "Bot", email: "bot@example.com", message: "spam", company: "Acme Inc" },
        "10.0.1.4"
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("returns a generic 502 without leaking provider details when sending fails", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("Resend rejected: invalid API key sk_live_secret"));

    const res = await POST(
      makeRequest({ name: "Ada", email: "ada@example.com", message: "Hello" }, "10.0.1.5")
    );

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBeTypeOf("string");
    expect(body.error).not.toMatch(/sk_live_secret|api key/i);
  });

  it("rate limits repeated requests from the same IP", async () => {
    const ip = "10.0.1.6";
    for (let i = 0; i < 5; i++) {
      const res = await POST(
        makeRequest({ name: "Ada", email: "ada@example.com", message: "Hi" }, ip)
      );
      expect(res.status).toBe(200);
    }

    const res = await POST(makeRequest({ name: "Ada", email: "ada@example.com", message: "Hi" }, ip));
    expect(res.status).toBe(429);
  });

  it("rejects a malformed JSON body with 400", async () => {
    const req = new NextRequest("http://localhost/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.1.7" },
      body: "{not json",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
