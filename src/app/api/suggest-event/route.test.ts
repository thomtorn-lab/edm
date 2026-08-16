import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sendEmailMock = vi.fn();

vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

import { POST } from "./route";

const VALID_SUBMISSION = {
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
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue(undefined);
});

describe("POST /api/suggest-event", () => {
  it("sends an email and returns ok for a valid submission", async () => {
    const res = await POST(makeRequest(VALID_SUBMISSION, "10.0.2.1"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "[Electronic CPH] Event suggestion",
        replyTo: "tipster@example.com",
        text: expect.stringContaining("Warehouse Night"),
      })
    );
  });

  it("rejects an invalid event URL with 400 and does not send", async () => {
    const res = await POST(
      makeRequest({ ...VALID_SUBMISSION, eventUrl: "not a url" }, "10.0.2.2")
    );

    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid contact email with 400 and does not send", async () => {
    const res = await POST(
      makeRequest({ ...VALID_SUBMISSION, contactEmail: "not-an-email" }, "10.0.2.3")
    );

    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("rejects missing required fields with 400", async () => {
    const res = await POST(
      makeRequest({ ...VALID_SUBMISSION, eventName: "", venue: "", date: "" }, "10.0.2.4")
    );

    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("accepts silently but never sends when the honeypot field is filled", async () => {
    const res = await POST(
      makeRequest({ ...VALID_SUBMISSION, company: "Acme Inc" }, "10.0.2.5")
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("returns a generic 502 without leaking provider details when sending fails", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("Resend rejected: invalid API key sk_live_secret"));

    const res = await POST(makeRequest(VALID_SUBMISSION, "10.0.2.6"));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBeTypeOf("string");
    expect(body.error).not.toMatch(/sk_live_secret|api key/i);
  });

  it("rate limits repeated requests from the same IP", async () => {
    const ip = "10.0.2.7";
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest(VALID_SUBMISSION, ip));
      expect(res.status).toBe(200);
    }

    const res = await POST(makeRequest(VALID_SUBMISSION, ip));
    expect(res.status).toBe(429);
  });

  it("treats an optional note as optional", async () => {
    const withoutNote: Record<string, unknown> = { ...VALID_SUBMISSION };
    delete withoutNote.note;
    const res = await POST(makeRequest(withoutNote, "10.0.2.8"));

    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});
