import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocked at the db/client.ts boundary, matching this codebase's established
 * convention (see writes.test.ts) — src/db/*.ts otherwise has no unit
 * tests and instead relies on live verification (see sync.test.ts's own
 * doc comment on why one specific concurrency case gets a mock-based test
 * anyway). The one thing a mock genuinely cannot validate is whether
 * `FOR UPDATE SKIP LOCKED` actually partitions rows correctly across two
 * real concurrent Postgres transactions — that was verified separately,
 * live, against a local Postgres instance (not committed here, matching
 * the "no unrelated files" constraint) and is reported in the delivery
 * summary rather than as a vitest test. What IS tested here is (a) that
 * the claim query's SQL text still contains that clause (a regression
 * guard against someone silently dropping it) and (b) every function's
 * observable read/write contract.
 */

let selectResults: unknown[][] = [];
const selectMock = vi.fn(() => ({
  from: () => ({
    // `.where(...)` is awaited directly by some callers (getConfirmedSubscribers)
    // and chained with `.limit(...)` by others (everything that looks up one
    // row by a unique token/email). Lazily consumes exactly one item from the
    // queue on whichever path is actually taken (a thenable that defers its
    // own resolution to the shared getResult(), rather than eagerly shifting
    // at `.where()` time too) — so either path consumes exactly one fixture.
    where: () => {
      let result: Promise<unknown[]> | undefined;
      const getResult = () => (result ??= Promise.resolve(selectResults.shift() ?? []));
      return {
        limit: () => getResult(),
        then: (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
          getResult().then(onFulfilled, onRejected),
      };
    },
  }),
}));

const insertValuesMock = vi.fn((row: unknown) => {
  void row;
  const chain = {
    onConflictDoNothing: () => chain,
    returning: () => Promise.resolve(insertReturningResults.shift() ?? [{ id: "inserted" }]),
  };
  return chain;
});
let insertReturningResults: unknown[][] = [];

const updateSetMock = vi.fn();
let updateReturningResults: unknown[][] = [[{ id: "updated" }]];
const updateMock = vi.fn(() => ({
  set: (patch: Record<string, unknown>) => {
    updateSetMock(patch);
    return {
      where: () => ({
        returning: () => Promise.resolve(updateReturningResults.shift() ?? []),
      }),
    };
  },
}));

let deleteReturningResults: unknown[][] = [[{ id: "deleted" }]];
const deleteMock = vi.fn(() => ({
  where: () => ({
    returning: () => Promise.resolve(deleteReturningResults.shift() ?? []),
  }),
}));

let executeResult: { rows: unknown[] } = { rows: [] };
const executeMock = vi.fn((_query: unknown) => Promise.resolve(executeResult));

vi.mock("./client", () => ({
  db: {
    select: () => selectMock(),
    insert: () => ({ values: insertValuesMock }),
    update: () => updateMock(),
    delete: () => deleteMock(),
    execute: (query: unknown) => executeMock(query),
  },
}));

const {
  sanitizeGenreSelection,
  requestSubscription,
  confirmSubscriberByToken,
  getSubscriberByManageToken,
  updateSubscriberGenres,
  unsubscribeByManageToken,
  getConfirmedSubscribers,
  queuePendingSendsForWeek,
  markStaleUnconfirmedSends,
  claimPendingSends,
  markSendSent,
  isSendStillClaimable,
  deleteOldNewsletterSends,
  deleteExpiredUnconfirmedSubscribers,
  sweepNewsletterRetention,
} = await import("./newsletter");

beforeEach(() => {
  selectResults = [];
  insertReturningResults = [];
  updateReturningResults = [[{ id: "updated" }]];
  deleteReturningResults = [[{ id: "deleted" }]];
  executeResult = { rows: [] };
  selectMock.mockClear();
  insertValuesMock.mockClear();
  updateMock.mockClear();
  updateSetMock.mockClear();
  deleteMock.mockClear();
  executeMock.mockClear();
});

describe("sanitizeGenreSelection", () => {
  it("passes through valid MainGenreSlug values", () => {
    expect(sanitizeGenreSelection(["techno", "house"])).toEqual(["techno", "house"]);
  });

  it("drops anything that isn't a known MainGenreSlug", () => {
    expect(sanitizeGenreSelection(["techno", "not-a-genre", 123, null])).toEqual(["techno"]);
  });

  it("drops duplicates", () => {
    expect(sanitizeGenreSelection(["techno", "techno"])).toEqual(["techno"]);
  });

  it("returns an empty array for non-array input", () => {
    expect(sanitizeGenreSelection("techno")).toEqual([]);
    expect(sanitizeGenreSelection(null)).toEqual([]);
    expect(sanitizeGenreSelection(undefined)).toEqual([]);
  });
});

describe("requestSubscription", () => {
  it("creates a new pending subscriber and returns a confirm token when the email is unseen", async () => {
    selectResults = [[]];
    const result = await requestSubscription("new@example.com");
    expect(result?.confirmToken).toBeTruthy();
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    const inserted = insertValuesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.email).toBe("new@example.com");
    expect(inserted.confirmed).toBe(false);
    expect(inserted.genres).toEqual([]);
  });

  it("reuses the existing confirm token for an already-pending (unconfirmed) email, without inserting again", async () => {
    selectResults = [[{ confirmed: false, confirmToken: "existing-token" }]];
    const result = await requestSubscription("pending@example.com");
    expect(result).toEqual({ confirmToken: "existing-token" });
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns null (no new confirmation email) for an already-confirmed email", async () => {
    selectResults = [[{ confirmed: true, confirmToken: "old-token" }]];
    const result = await requestSubscription("confirmed@example.com");
    expect(result).toBeNull();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });
});

describe("confirmSubscriberByToken", () => {
  it(
    "confirms a valid pending token, returns the manage token, and stamps the consent-evidence " +
      "fields (confirmedAt + consentVersion) — GDPR final hardening round, 2026-10-06",
    async () => {
      selectResults = [[{ id: "sub-1", confirmed: false, manageToken: "manage-1" }]];
      const result = await confirmSubscriberByToken("confirm-1");
      expect(result).toEqual({ manageToken: "manage-1" });
      expect(updateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({ confirmed: true, confirmedAt: expect.any(Date), consentVersion: expect.any(String) }),
      );
    },
  );

  it("returns null for an unrecognized token", async () => {
    selectResults = [[]];
    const result = await confirmSubscriberByToken("bogus");
    expect(result).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("is idempotent — re-confirming an already-confirmed token still returns the manage token, without a redundant update", async () => {
    selectResults = [[{ id: "sub-1", confirmed: true, manageToken: "manage-1" }]];
    const result = await confirmSubscriberByToken("confirm-1");
    expect(result).toEqual({ manageToken: "manage-1" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("getSubscriberByManageToken", () => {
  it("returns the subscriber for a valid token", async () => {
    selectResults = [[{ id: "sub-1", email: "a@example.com", genres: ["techno"], confirmed: true, manageToken: "tok" }]];
    const result = await getSubscriberByManageToken("tok");
    expect(result).toEqual({ id: "sub-1", email: "a@example.com", genres: ["techno"], confirmed: true, manageToken: "tok" });
  });

  it("returns null for an unknown token", async () => {
    selectResults = [[]];
    expect(await getSubscriberByManageToken("unknown")).toBeNull();
  });
});

describe("updateSubscriberGenres", () => {
  it("returns true and updates when the token is valid", async () => {
    updateReturningResults = [[{ id: "sub-1" }]];
    const result = await updateSubscriberGenres("tok", ["house"]);
    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith({ genres: ["house"] });
  });

  it("returns false for an unknown token", async () => {
    updateReturningResults = [[]];
    expect(await updateSubscriberGenres("unknown", ["house"])).toBe(false);
  });
});

describe("unsubscribeByManageToken", () => {
  it("returns true when a row was deleted", async () => {
    deleteReturningResults = [[{ id: "sub-1" }]];
    expect(await unsubscribeByManageToken("tok")).toBe(true);
  });

  it("returns false for an unknown token (nothing deleted)", async () => {
    deleteReturningResults = [[]];
    expect(await unsubscribeByManageToken("unknown")).toBe(false);
  });
});

describe("getConfirmedSubscribers", () => {
  it("maps rows into subscriber records", async () => {
    selectResults = [[{ id: "sub-1", email: "a@example.com", genres: [], confirmed: true, manageToken: "tok" }]];
    const result = await getConfirmedSubscribers();
    expect(result).toEqual([{ id: "sub-1", email: "a@example.com", genres: [], confirmed: true, manageToken: "tok" }]);
  });

  it(
    "test-mode allowlist (activation safety round, 2026-10-06): narrows to confirmed subscribers whose " +
      "email is on the allowlist, excluding every other existing/confirmed subscriber",
    async () => {
      selectResults = [
        [
          { id: "sub-test", email: "Tester@Example.com", genres: [], confirmed: true, manageToken: "tok-test" },
          { id: "sub-real", email: "real-subscriber@example.com", genres: [], confirmed: true, manageToken: "tok-real" },
        ],
      ];
      const result = await getConfirmedSubscribers(new Set(["tester@example.com"]));
      expect(result).toEqual([{ id: "sub-test", email: "Tester@Example.com", genres: [], confirmed: true, manageToken: "tok-test" }]);
    },
  );

  it("returns every confirmed subscriber when no allowlist is given (undefined) — unchanged real-mode behavior", async () => {
    selectResults = [[{ id: "sub-1", email: "a@example.com", genres: [], confirmed: true, manageToken: "tok" }]];
    const result = await getConfirmedSubscribers(undefined);
    expect(result).toHaveLength(1);
  });

  it("returns every confirmed subscriber when the allowlist is explicitly null (real mode, flag enabled)", async () => {
    selectResults = [[{ id: "sub-1", email: "a@example.com", genres: [], confirmed: true, manageToken: "tok" }]];
    const result = await getConfirmedSubscribers(null);
    expect(result).toHaveLength(1);
  });

  it("returns nobody when the allowlist matches none of the confirmed subscribers", async () => {
    selectResults = [[{ id: "sub-real", email: "real-subscriber@example.com", genres: [], confirmed: true, manageToken: "tok" }]];
    const result = await getConfirmedSubscribers(new Set(["tester@example.com"]));
    expect(result).toEqual([]);
  });
});

describe("markStaleUnconfirmedSends", () => {
  it("marks stale 'sending' rows and returns the number of rows affected", async () => {
    updateReturningResults = [[{ id: "a" }, { id: "b" }]];
    const count = await markStaleUnconfirmedSends("2026-W41");
    expect(count).toBe(2);
    expect(updateSetMock).toHaveBeenCalledWith({ status: "stale_unconfirmed" });
  });

  it("returns 0 when nothing is stale", async () => {
    updateReturningResults = [[]];
    expect(await markStaleUnconfirmedSends("2026-W41")).toBe(0);
  });
});

describe("claimPendingSends", () => {
  it("maps raw rows into ClaimedSend records", async () => {
    executeResult = {
      rows: [
        {
          id: "send-1",
          subscriber_id: "sub-1",
          recipient_email: "a@example.com",
          manage_token: "manage-1",
          payload_subject: "Subject",
          payload_html: "<p>hi</p>",
          payload_text: "hi",
          idempotency_key: "newsletter:sub-1:2026-W41",
        },
      ],
    };
    const result = await claimPendingSends("2026-W41", 100);
    expect(result).toEqual([
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
    ]);
  });

  it("returns an empty array when nothing is claimable", async () => {
    executeResult = { rows: [] };
    expect(await claimPendingSends("2026-W41", 100)).toEqual([]);
  });

  it("IMPORTANT — the claim query uses FOR UPDATE SKIP LOCKED (regression guard: this is the only thing that makes concurrent claiming safe; a unique constraint alone does not)", async () => {
    await claimPendingSends("2026-W41", 100);
    const sqlArg = executeMock.mock.calls[0][0];
    const text = JSON.stringify(sqlArg);
    expect(text).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("only claims 'pending' rows or 'sending' rows past the reclaim window, never a freshly-claimed 'sending' row (regression guard against weakening the WHERE clause)", async () => {
    await claimPendingSends("2026-W41", 100);
    const sqlArg = executeMock.mock.calls[0][0];
    const text = JSON.stringify(sqlArg);
    expect(text).toContain("status = 'pending'");
    expect(text).toMatch(/claimed_at < now\(\) - .*interval '1 millisecond'/);
  });

  it(
    "test-mode allowlist (activation safety round, 2026-10-06): when given, adds a recipient_email " +
      "filter to the claim query's WHERE clause, so a non-test row is never even locked, let alone claimed",
    async () => {
      await claimPendingSends("2026-W41", 100, new Set(["tester@example.com"]));
      const sqlArg = executeMock.mock.calls[0][0];
      const text = JSON.stringify(sqlArg);
      expect(text).toContain("LOWER(recipient_email) = ANY");
      expect(text).toContain("tester@example.com");
    },
  );

  it("adds no recipient_email filter when no allowlist is given — unchanged real-mode query shape", async () => {
    await claimPendingSends("2026-W41", 100);
    const sqlArgUnfiltered = JSON.stringify(executeMock.mock.calls[0][0]);
    executeMock.mockClear();
    await claimPendingSends("2026-W41", 100, null);
    const sqlArgNull = JSON.stringify(executeMock.mock.calls[0][0]);
    expect(sqlArgUnfiltered).not.toContain("LOWER(recipient_email) = ANY");
    expect(sqlArgNull).not.toContain("LOWER(recipient_email) = ANY");
  });
});

describe("markSendSent", () => {
  it("sets status sent, sentAt, and resendEmailId", async () => {
    await markSendSent("send-1", "resend-id-1");
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", resendEmailId: "resend-id-1" }));
  });
});

describe("isSendStillClaimable", () => {
  it("returns true when the row still exists with status 'sending'", async () => {
    selectResults = [[{ id: "send-1" }]];
    expect(await isSendStillClaimable("send-1")).toBe(true);
  });

  it("returns false when the row no longer exists (e.g. cascaded away by an unsubscribe)", async () => {
    selectResults = [[]];
    expect(await isSendStillClaimable("send-1")).toBe(false);
  });
});

describe("queuePendingSendsForWeek", () => {
  const subscriber = { id: "sub-1", email: "a@example.com", genres: [] as const, confirmed: true, manageToken: "manage-1" };

  it("queues a 'pending' row with snapshotted content for a subscriber with matching events", async () => {
    insertReturningResults = [[{ id: "send-1" }]];
    const events = [
      {
        id: "e-1",
        title: "Night",
        slug: "night",
        startDatetime: "2026-10-10T20:00:00.000Z",
        endDatetime: null,
        subgenres: ["techno"],
        primaryGenre: "techno",
        soldOut: false,
        venue: { name: "Venue" },
      },
    ];
    const result = await queuePendingSendsForWeek("2026-W41", [subscriber as never], events as never);
    expect(result).toEqual({ queued: 1, skippedNoMatch: 0 });
    const inserted = insertValuesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.status).toBe("pending");
    expect(inserted.idempotencyKey).toBe("newsletter:sub-1:2026-W41");
    expect(inserted.payloadHtml).toContain("Night");
    expect(inserted.eventCount).toBe(1);
  });

  it("queues a 'skipped_no_match' row with no payload for a subscriber with zero matching events", async () => {
    insertReturningResults = [[{ id: "send-1" }]];
    const result = await queuePendingSendsForWeek("2026-W41", [subscriber as never], []);
    expect(result).toEqual({ queued: 0, skippedNoMatch: 1 });
    const inserted = insertValuesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.status).toBe("skipped_no_match");
    expect(inserted.payloadHtml).toBeUndefined();
    expect(inserted.eventCount).toBe(0);
  });

  it("does not count a row as queued/skipped when onConflictDoNothing finds it already exists (idempotent re-run)", async () => {
    insertReturningResults = [[]]; // onConflictDoNothing -> no row returned
    const result = await queuePendingSendsForWeek("2026-W41", [subscriber as never], []);
    expect(result).toEqual({ queued: 0, skippedNoMatch: 0 });
  });
});

describe("deleteOldNewsletterSends", () => {
  it("returns the number of deleted rows", async () => {
    deleteReturningResults = [[{ id: "a" }, { id: "b" }]];
    expect(await deleteOldNewsletterSends()).toBe(2);
  });

  it("returns 0 when nothing is past the retention window", async () => {
    deleteReturningResults = [[]];
    expect(await deleteOldNewsletterSends()).toBe(0);
  });
});

describe("deleteExpiredUnconfirmedSubscribers", () => {
  it("returns the number of deleted rows", async () => {
    deleteReturningResults = [[{ id: "sub-1" }]];
    expect(await deleteExpiredUnconfirmedSubscribers()).toBe(1);
  });

  it("returns 0 when nothing is expired", async () => {
    deleteReturningResults = [[]];
    expect(await deleteExpiredUnconfirmedSubscribers()).toBe(0);
  });
});

describe("sweepNewsletterRetention", () => {
  it("runs both retention deletes and returns their combined counts", async () => {
    deleteReturningResults = [[{ id: "send-1" }, { id: "send-2" }], [{ id: "sub-1" }]];
    const result = await sweepNewsletterRetention();
    expect(result).toEqual({ deletedOldSends: 2, deletedExpiredUnconfirmed: 1 });
    expect(deleteMock).toHaveBeenCalledTimes(2);
  });
});
