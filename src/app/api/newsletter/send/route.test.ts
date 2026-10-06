import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getPublishedEventsWithVenueMock = vi.fn();
const markStaleUnconfirmedSendsMock = vi.fn();
const getConfirmedSubscribersMock = vi.fn();
const queuePendingSendsForWeekMock = vi.fn();
const claimPendingSendsMock = vi.fn();
const markSendSentMock = vi.fn();
const isSendStillClaimableMock = vi.fn();
const sendNewsletterEmailMock = vi.fn();
const deleteOldNewsletterSendsMock = vi.fn();
const deleteExpiredUnconfirmedSubscribersMock = vi.fn();

vi.mock("@/lib/queries", () => ({
  getPublishedEventsWithVenue: (...args: unknown[]) => getPublishedEventsWithVenueMock(...args),
}));
vi.mock("@/db/newsletter", () => ({
  markStaleUnconfirmedSends: (...args: unknown[]) => markStaleUnconfirmedSendsMock(...args),
  getConfirmedSubscribers: (...args: unknown[]) => getConfirmedSubscribersMock(...args),
  queuePendingSendsForWeek: (...args: unknown[]) => queuePendingSendsForWeekMock(...args),
  claimPendingSends: (...args: unknown[]) => claimPendingSendsMock(...args),
  markSendSent: (...args: unknown[]) => markSendSentMock(...args),
  isSendStillClaimable: (...args: unknown[]) => isSendStillClaimableMock(...args),
  deleteOldNewsletterSends: (...args: unknown[]) => deleteOldNewsletterSendsMock(...args),
  deleteExpiredUnconfirmedSubscribers: (...args: unknown[]) => deleteExpiredUnconfirmedSubscribersMock(...args),
}));
vi.mock("@/lib/email", () => ({
  sendNewsletterEmail: (...args: unknown[]) => sendNewsletterEmailMock(...args),
}));

import { POST } from "./route";

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/newsletter/send", { method: "POST", headers });
}

beforeEach(() => {
  vi.stubEnv("SYNC_TRIGGER_TOKEN", "test-token");
  vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "true");
  getPublishedEventsWithVenueMock.mockReset().mockResolvedValue([]);
  markStaleUnconfirmedSendsMock.mockReset().mockResolvedValue(0);
  getConfirmedSubscribersMock.mockReset().mockResolvedValue([]);
  queuePendingSendsForWeekMock.mockReset().mockResolvedValue({ queued: 0, skippedNoMatch: 0 });
  claimPendingSendsMock.mockReset().mockResolvedValue([]);
  markSendSentMock.mockReset().mockResolvedValue(undefined);
  isSendStillClaimableMock.mockReset().mockResolvedValue(true);
  sendNewsletterEmailMock.mockReset();
  deleteOldNewsletterSendsMock.mockReset().mockResolvedValue(0);
  deleteExpiredUnconfirmedSubscribersMock.mockReset().mockResolvedValue(0);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/newsletter/send — auth and feature flag", () => {
  it("returns 500 when SYNC_TRIGGER_TOKEN isn't configured", async () => {
    vi.stubEnv("SYNC_TRIGGER_TOKEN", "");
    const res = await POST(makeRequest({ "x-sync-token": "anything" }));
    expect(res.status).toBe(500);
  });

  it("returns 401 for a wrong/missing token", async () => {
    const res = await POST(makeRequest({ "x-sync-token": "wrong" }));
    expect(res.status).toBe(401);
    expect(getConfirmedSubscribersMock).not.toHaveBeenCalled();
    expect(deleteOldNewsletterSendsMock).not.toHaveBeenCalled();
    expect(deleteExpiredUnconfirmedSubscribersMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the feature flag is off, even with a correct token", async () => {
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "false");
    const res = await POST(makeRequest({ "x-sync-token": "test-token" }));
    expect(res.status).toBe(503);
    expect(getConfirmedSubscribersMock).not.toHaveBeenCalled();
    expect(deleteOldNewsletterSendsMock).not.toHaveBeenCalled();
    expect(deleteExpiredUnconfirmedSubscribersMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/newsletter/send — GDPR retention sweep", () => {
  it("deletes old resolved sends and expired unconfirmed subscribers on every authenticated, enabled invocation, and reports the counts", async () => {
    deleteOldNewsletterSendsMock.mockResolvedValue(3);
    deleteExpiredUnconfirmedSubscribersMock.mockResolvedValue(2);
    const res = await POST(makeRequest({ "x-sync-token": "test-token" }));
    const body = await res.json();
    expect(deleteOldNewsletterSendsMock).toHaveBeenCalledTimes(1);
    expect(deleteExpiredUnconfirmedSubscribersMock).toHaveBeenCalledTimes(1);
    expect(body.deletedOldSends).toBe(3);
    expect(body.deletedExpiredUnconfirmed).toBe(2);
  });
});

describe("POST /api/newsletter/send — happy path", () => {
  it("marks stale sends, queues, claims, sends, and marks sent — returns a full summary", async () => {
    queuePendingSendsForWeekMock.mockResolvedValue({ queued: 2, skippedNoMatch: 1 });
    claimPendingSendsMock
      .mockResolvedValueOnce([
        {
          id: "send-1",
          subscriberId: "sub-1",
          recipientEmail: "a@example.com",
          manageToken: "manage-1",
          payloadSubject: "Subject",
          payloadHtml: "<p>hi</p>",
          payloadText: "hi",
          idempotencyKey: "newsletter:sub-1:2026-W41",
        },
      ])
      .mockResolvedValueOnce([]);
    sendNewsletterEmailMock.mockResolvedValue({ status: "sent", resendEmailId: "resend-1" });
    markStaleUnconfirmedSendsMock.mockResolvedValue(1);

    const res = await POST(makeRequest({ "x-sync-token": "test-token" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, queued: 2, skippedNoMatch: 1, staleUnconfirmedReclaimed: 1, sent: 1, ambiguous: 0 });
    expect(markSendSentMock).toHaveBeenCalledWith("send-1", "resend-1");
    expect(sendNewsletterEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@example.com",
        idempotencyKey: "newsletter:sub-1:2026-W41",
        listUnsubscribeUrl: expect.stringContaining("manage-1"),
      }),
    );
  });

  it("never marks a row sent on an ambiguous send result — leaves it for the next run", async () => {
    claimPendingSendsMock
      .mockResolvedValueOnce([
        {
          id: "send-1",
          subscriberId: "sub-1",
          recipientEmail: "a@example.com",
          manageToken: "manage-1",
          payloadSubject: "S",
          payloadHtml: "h",
          payloadText: "t",
          idempotencyKey: "key-1",
        },
      ])
      .mockResolvedValueOnce([]);
    sendNewsletterEmailMock.mockResolvedValue({ status: "ambiguous" });

    const res = await POST(makeRequest({ "x-sync-token": "test-token" }));
    const body = await res.json();

    expect(body.sent).toBe(0);
    expect(body.ambiguous).toBe(1);
    expect(markSendSentMock).not.toHaveBeenCalled();
  });

  it("unsubscribe-safety: never calls Resend for a row that was unsubscribed (cascaded away) between claim and send", async () => {
    claimPendingSendsMock
      .mockResolvedValueOnce([
        {
          id: "send-1",
          subscriberId: "sub-1",
          recipientEmail: "a@example.com",
          manageToken: "manage-1",
          payloadSubject: "S",
          payloadHtml: "h",
          payloadText: "t",
          idempotencyKey: "key-1",
        },
      ])
      .mockResolvedValueOnce([]);
    isSendStillClaimableMock.mockResolvedValue(false); // unsubscribed in the gap

    const res = await POST(makeRequest({ "x-sync-token": "test-token" }));
    const body = await res.json();

    expect(sendNewsletterEmailMock).not.toHaveBeenCalled();
    expect(markSendSentMock).not.toHaveBeenCalled();
    expect(body.sent).toBe(0);
    expect(body.skippedUnsubscribed).toBe(1);
  });

  it("checks isSendStillClaimable before calling sendNewsletterEmail, not after", async () => {
    claimPendingSendsMock
      .mockResolvedValueOnce([
        {
          id: "send-1",
          subscriberId: "sub-1",
          recipientEmail: "a@example.com",
          manageToken: "manage-1",
          payloadSubject: "S",
          payloadHtml: "h",
          payloadText: "t",
          idempotencyKey: "key-1",
        },
      ])
      .mockResolvedValueOnce([]);
    const callOrder: string[] = [];
    isSendStillClaimableMock.mockImplementation(async () => {
      callOrder.push("check");
      return true;
    });
    sendNewsletterEmailMock.mockImplementation(async () => {
      callOrder.push("send");
      return { status: "sent", resendEmailId: "r-1" };
    });

    await POST(makeRequest({ "x-sync-token": "test-token" }));
    expect(callOrder).toEqual(["check", "send"]);
  });

  it("calls markStaleUnconfirmedSends before claiming (so a just-staled row is never claimed in the same run)", async () => {
    const callOrder: string[] = [];
    markStaleUnconfirmedSendsMock.mockImplementation(async () => {
      callOrder.push("stale");
      return 0;
    });
    claimPendingSendsMock.mockImplementation(async () => {
      callOrder.push("claim");
      return [];
    });
    await POST(makeRequest({ "x-sync-token": "test-token" }));
    expect(callOrder[0]).toBe("stale");
  });

  it("is safely re-invokable: a second call with nothing left to claim just returns zero sent, no errors", async () => {
    claimPendingSendsMock.mockResolvedValue([]);
    const res = await POST(makeRequest({ "x-sync-token": "test-token" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.sent).toBe(0);
    expect(sendNewsletterEmailMock).not.toHaveBeenCalled();
  });

  it("stops claiming once a batch comes back empty, rather than looping forever", async () => {
    claimPendingSendsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "should-not-be-claimed" }]);
    await POST(makeRequest({ "x-sync-token": "test-token" }));
    expect(claimPendingSendsMock).toHaveBeenCalledTimes(1);
  });
});
