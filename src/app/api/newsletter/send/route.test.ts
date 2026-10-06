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
const sweepNewsletterRetentionMock = vi.fn();

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
  sweepNewsletterRetention: (...args: unknown[]) => sweepNewsletterRetentionMock(...args),
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
  sweepNewsletterRetentionMock.mockReset().mockResolvedValue({ deletedOldSends: 0, deletedExpiredUnconfirmed: 0 });
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
    expect(sweepNewsletterRetentionMock).not.toHaveBeenCalled();
  });

  it(
    "GDPR final hardening (2026-10-06): the retention sweep still runs when the feature flag is off — " +
      "retention is a legal obligation independent of whether real sending is currently enabled, and must " +
      "not silently stop just because this endpoint also happens to gate sending",
    async () => {
      vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "false");
      sweepNewsletterRetentionMock.mockResolvedValue({ deletedOldSends: 3, deletedExpiredUnconfirmed: 2 });
      const res = await POST(makeRequest({ "x-sync-token": "test-token" }));
      const body = await res.json();
      expect(res.status).toBe(503);
      expect(getConfirmedSubscribersMock).not.toHaveBeenCalled();
      expect(sweepNewsletterRetentionMock).toHaveBeenCalledTimes(1);
      expect(body.deletedOldSends).toBe(3);
      expect(body.deletedExpiredUnconfirmed).toBe(2);
    },
  );
});

describe("POST /api/newsletter/send — GDPR retention sweep", () => {
  it("sweeps retention on every authenticated invocation and reports the counts", async () => {
    sweepNewsletterRetentionMock.mockResolvedValue({ deletedOldSends: 3, deletedExpiredUnconfirmed: 2 });
    const res = await POST(makeRequest({ "x-sync-token": "test-token" }));
    const body = await res.json();
    expect(sweepNewsletterRetentionMock).toHaveBeenCalledTimes(1);
    expect(body.deletedOldSends).toBe(3);
    expect(body.deletedExpiredUnconfirmed).toBe(2);
  });
});

describe("POST /api/newsletter/send — activation safety: test-mode allowlist isolation (2026-10-06)", () => {
  it("proceeds (instead of 503) when the flag is off but NEWSLETTER_TEST_ALLOWLIST is set, and passes the parsed allowlist to selection and claiming", async () => {
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "false");
    vi.stubEnv("NEWSLETTER_TEST_ALLOWLIST", "tester@example.com");
    const res = await POST(makeRequest({ "x-sync-token": "test-token" }));
    expect(res.status).toBe(200);
    expect(getConfirmedSubscribersMock).toHaveBeenCalledWith(new Set(["tester@example.com"]));
    expect(claimPendingSendsMock).toHaveBeenCalledWith(expect.any(String), expect.any(Number), new Set(["tester@example.com"]));
    const body = await res.json();
    expect(body.testMode).toBe(true);
  });

  it("still 503s when the flag is off and no allowlist is configured — unchanged existing behavior", async () => {
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "false");
    const res = await POST(makeRequest({ "x-sync-token": "test-token" }));
    expect(res.status).toBe(503);
    expect(getConfirmedSubscribersMock).not.toHaveBeenCalled();
  });

  it("still 503s when the flag is off and the allowlist is empty — empty/missing allowlist always means no test access", async () => {
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "false");
    vi.stubEnv("NEWSLETTER_TEST_ALLOWLIST", "");
    const res = await POST(makeRequest({ "x-sync-token": "test-token" }));
    expect(res.status).toBe(503);
    expect(getConfirmedSubscribersMock).not.toHaveBeenCalled();
  });

  it("ignores a configured allowlist entirely once the flag is genuinely enabled — passes null, not the allowlist, so a real run is never narrowed", async () => {
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "true");
    vi.stubEnv("NEWSLETTER_TEST_ALLOWLIST", "tester@example.com");
    const res = await POST(makeRequest({ "x-sync-token": "test-token" }));
    expect(res.status).toBe(200);
    expect(getConfirmedSubscribersMock).toHaveBeenCalledWith(null);
    expect(claimPendingSendsMock).toHaveBeenCalledWith(expect.any(String), expect.any(Number), null);
    const body = await res.json();
    expect(body.testMode).toBe(false);
  });

  it(
    "existing (non-test) confirmed subscriber must never be included in test mode: even if claimPendingSends " +
      "somehow still returned a non-allowlisted row, the final per-row gate skips it and never calls Resend " +
      "— the third independent enforcement layer",
    async () => {
      vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "false");
      vi.stubEnv("NEWSLETTER_TEST_ALLOWLIST", "tester@example.com");
      claimPendingSendsMock
        .mockResolvedValueOnce([
          {
            id: "send-real",
            subscriberId: "sub-real",
            recipientEmail: "real-subscriber@example.com", // not on the allowlist
            manageToken: "manage-real",
            payloadSubject: "S",
            payloadHtml: "h",
            payloadText: "t",
            idempotencyKey: "key-real",
          },
        ])
        .mockResolvedValueOnce([]);

      const res = await POST(makeRequest({ "x-sync-token": "test-token" }));
      const body = await res.json();

      expect(sendNewsletterEmailMock).not.toHaveBeenCalled();
      expect(markSendSentMock).not.toHaveBeenCalled();
      expect(isSendStillClaimableMock).not.toHaveBeenCalled(); // skipped before even reaching the unsubscribe-safety check
      expect(body.sent).toBe(0);
      expect(body.skippedNotAllowlisted).toBe(1);
    },
  );

  it("a genuinely allowlisted row still sends normally in test mode", async () => {
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "false");
    vi.stubEnv("NEWSLETTER_TEST_ALLOWLIST", "tester@example.com");
    claimPendingSendsMock
      .mockResolvedValueOnce([
        {
          id: "send-test",
          subscriberId: "sub-test",
          recipientEmail: "Tester@Example.com", // case-different from the allowlist entry
          manageToken: "manage-test",
          payloadSubject: "S",
          payloadHtml: "h",
          payloadText: "t",
          idempotencyKey: "key-test",
        },
      ])
      .mockResolvedValueOnce([]);
    sendNewsletterEmailMock.mockResolvedValue({ status: "sent", resendEmailId: "r-1" });

    const res = await POST(makeRequest({ "x-sync-token": "test-token" }));
    const body = await res.json();

    expect(sendNewsletterEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: "Tester@Example.com" }));
    expect(body.sent).toBe(1);
    expect(body.skippedNotAllowlisted).toBe(0);
  });

  it("retry/reclaim in test mode still only ever claims allowlisted rows — same claimPendingSends call each batch, allowlist included every time", async () => {
    vi.stubEnv("NEWSLETTER_SIGNUP_ENABLED", "false");
    vi.stubEnv("NEWSLETTER_TEST_ALLOWLIST", "tester@example.com");
    claimPendingSendsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await POST(makeRequest({ "x-sync-token": "test-token" }));
    expect(claimPendingSendsMock).toHaveBeenCalledWith(expect.any(String), expect.any(Number), new Set(["tester@example.com"]));
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
