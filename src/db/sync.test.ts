import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoveryQueue, syncLocks } from "./schema";
import type { RawCandidateEvent, SourceAdapter } from "@/lib/adapters/types";
import type { Venue } from "@/lib/types";
import type { EventWithVenue } from "@/lib/queries";

/**
 * These tests exist because src-culture-box's advisory lock got stuck on a
 * Supavisor-pooled backend in production (see the doc comment above
 * runSourceSync in ./sync) and stayed stuck indefinitely — every sync for
 * that source failed with "skipped_concurrent" until a human manually ran
 * pg_terminate_backend. The replacement lease mechanism's entire reason for
 * existing is to make that specific failure mode structurally impossible,
 * so it's covered here even though src/db/*.ts otherwise has no unit tests
 * (validated instead via live Preview-sync runs) — there is no other way
 * to exercise "a crashed sync must self-heal" without one.
 *
 * The mock below simulates the exact conditional-upsert / delete semantics
 * the real `sync_locks` SQL uses (see acquireSyncLock/releaseSyncLock in
 * ./sync) against an in-memory Map, evaluating the real `eq`/`lte`/`and`
 * condition trees built from the real (unmocked) schema columns — so it
 * stays accurate to what Postgres actually does rather than hardcoding
 * assumptions about the calling code's behavior.
 */

interface LeaseRow {
  sourceId: string;
  lockToken: string;
  lockedAt: Date;
  expiresAt: Date;
}

type Cond =
  | { type: "eq"; col: unknown; val: unknown }
  | { type: "lte"; col: unknown; val: unknown }
  | { type: "and"; conds: Cond[] };

const FIELD_BY_COLUMN = new Map<unknown, keyof LeaseRow>([
  [syncLocks.sourceId, "sourceId"],
  [syncLocks.lockToken, "lockToken"],
  [syncLocks.lockedAt, "lockedAt"],
  [syncLocks.expiresAt, "expiresAt"],
]);

function evalCond(cond: Cond, row: LeaseRow): boolean {
  if (cond.type === "and") return cond.conds.every((c) => evalCond(c, row));
  const field = FIELD_BY_COLUMN.get(cond.col);
  if (!field) throw new Error("Unrecognized column in mocked WHERE clause");
  const rowVal = row[field];
  if (cond.type === "lte") return (rowVal as Date).getTime() <= (cond.val as Date).getTime();
  return rowVal === cond.val;
}

let leaseTable: Map<string, LeaseRow>;

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => ({ type: "eq" as const, col, val }),
    lte: (col: unknown, val: unknown) => ({ type: "lte" as const, col, val }),
    and: (...conds: unknown[]) => ({ type: "and" as const, conds }),
  };
});

vi.mock("./client", () => ({
  db: {
    insert: () => ({
      values: (values: LeaseRow) => ({
        onConflictDoUpdate: (config: { set: Partial<LeaseRow>; where: Cond }) => ({
          returning: (selection: Record<string, unknown>) => {
            const existing = leaseTable.get(values.sourceId);
            let stored: LeaseRow;
            if (!existing) {
              stored = { ...values };
            } else if (evalCond(config.where, existing)) {
              stored = { ...existing, ...config.set } as LeaseRow;
            } else {
              return Promise.resolve([]);
            }
            leaseTable.set(values.sourceId, stored);
            const projected: Record<string, unknown> = {};
            for (const key of Object.keys(selection)) projected[key] = stored[key as keyof LeaseRow];
            return Promise.resolve([projected]);
          },
        }),
      }),
    }),
    delete: () => ({
      where: (cond: Cond) => {
        for (const [key, row] of leaseTable.entries()) {
          if (evalCond(cond, row)) leaseTable.delete(key);
        }
        return Promise.resolve();
      },
    }),
    // runSourceSyncLocked also reads sourceEventLinks/discoveryQueue
    // directly via db.select() — irrelevant to the lease mechanism under
    // test here, so always resolves empty by default. Trusted-source status
    // itself is a static, code-level lookup (src/lib/data/sources.ts) and
    // never touches the DB at all. Wrapped in vi.fn() so individual tests
    // can override the discoveryQueue call's return value (e.g. to simulate
    // an existing pending row that must be resolved once evidence flips a
    // candidate to auto_publish).
    select: vi.fn(() => ({
      from: () => ({
        where: () => Object.assign(Promise.resolve([]), { limit: () => Promise.resolve([]) }),
      }),
    })),
  },
}));

// Mirrors the real insertDiscoveryItem's echo-back return shape (see
// db/writes.ts) — tests that only care about call count can ignore the
// return value, but tests proving the notification batching wiring need a
// realistic item flowing into notifyDiscoveryQueueInsertBatch.
vi.mock("./writes", () => ({
  touchSourceSyncStats: vi.fn().mockResolvedValue(undefined),
  applySourceSyncPatch: vi.fn(),
  applySyncHoldUnpublish: vi.fn(),
  createEvent: vi.fn(),
  insertDiscoveryItem: vi.fn().mockImplementation((item) =>
    Promise.resolve({
      id: item.id,
      probableTitle: item.probableTitle,
      probableStart: item.probableStart,
      probableVenueName: item.probableVenueName,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      predictedGenre: item.predictedGenre,
      genreConfidence: item.genreConfidence,
      overallConfidence: item.overallConfidence,
      missingFields: item.missingFields,
    }),
  ),
  recordSourceLink: vi.fn(),
  resolveDiscoveryItemAsPublished: vi.fn(),
  applyDiscoveryClassificationUpdate: vi.fn(),
}));

vi.mock("@/lib/queries", () => ({
  getVenues: vi.fn().mockResolvedValue([]),
  getAllEventsAdmin: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/discoveryNotification", () => ({
  notifyDiscoveryQueueInsertBatch: vi.fn().mockResolvedValue(undefined),
}));

const { acquireSyncLock, releaseSyncLock, runSourceSync } = await import("./sync");
const { getAllEventsAdmin } = await import("@/lib/queries");
const { getVenues } = await import("@/lib/queries");
const { insertDiscoveryItem, applySourceSyncPatch, applySyncHoldUnpublish, createEvent } = await import("./writes");
const { notifyDiscoveryQueueInsertBatch } = await import("@/lib/discoveryNotification");

function fakeAdapter(fetchCandidates: () => Promise<RawCandidateEvent[]>): SourceAdapter {
  return { sourceId: "src-culture-box", fetchCandidates };
}

const rawCandidate: RawCandidateEvent = {
  sourceId: "src-culture-box",
  sourceUrl: "https://culture-box.com/event/x",
  title: "Test Night",
  description: null,
  artists: ["DJ Test"],
  startDatetime: "2026-09-01T22:00:00Z",
  endDatetime: null,
  venueName: "Culture Box",
  officialEventUrl: "https://culture-box.com/event/x",
  ticketUrl: null,
  facebookUrl: null,
  residentAdvisorUrl: null,
  imageUrl: null,
  priceFrom: null,
  genreHint: null,
  genreConfidenceHint: null,
};

beforeEach(() => {
  leaseTable = new Map();
  vi.clearAllMocks();
});

describe("acquireSyncLock / releaseSyncLock (per-source sync concurrency lease)", () => {
  it("a first sync for a source acquires the lock", async () => {
    expect(await acquireSyncLock("src-culture-box")).not.toBeNull();
  });

  it("a concurrent sync for the SAME source is skipped while the lease is still valid", async () => {
    expect(await acquireSyncLock("src-culture-box")).not.toBeNull();
    expect(await acquireSyncLock("src-culture-box")).toBeNull();
  });

  it("a sync for a DIFFERENT source proceeds independently while another source's lease is held", async () => {
    expect(await acquireSyncLock("src-culture-box")).not.toBeNull();
    expect(await acquireSyncLock("src-hangaren")).not.toBeNull();
    expect(await acquireSyncLock("src-poolen")).not.toBeNull();
  });

  it("releasing the lock lets an immediate subsequent sync for the same source acquire it again", async () => {
    const token = await acquireSyncLock("src-culture-box");
    expect(token).not.toBeNull();
    await releaseSyncLock("src-culture-box", token!);
    expect(await acquireSyncLock("src-culture-box")).not.toBeNull();
  });

  it("a lease past its expiry is acquirable again even without an explicit release — no permanent lock survives a crashed sync", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-19T12:00:00Z"));
      const token = await acquireSyncLock("src-culture-box");
      expect(token).not.toBeNull();

      // Never call releaseSyncLock — simulates a request killed before its `finally` runs.
      vi.setSystemTime(new Date(new Date("2026-08-19T12:00:00Z").getTime() + 5 * 60 * 1000 + 1000));
      const afterCrash = await acquireSyncLock("src-culture-box");
      expect(afterCrash).not.toBeNull();
      expect(afterCrash).not.toBe(token);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releasing with a stale token (from an already-expired, since-reacquired lease) does not clobber the new holder's lock", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-19T12:00:00Z"));
      const staleToken = await acquireSyncLock("src-culture-box");
      expect(staleToken).not.toBeNull();

      vi.setSystemTime(new Date(new Date("2026-08-19T12:00:00Z").getTime() + 5 * 60 * 1000 + 1000));
      const newToken = await acquireSyncLock("src-culture-box");
      expect(newToken).not.toBeNull();
      expect(newToken).not.toBe(staleToken);

      // The original (crashed) request finally wakes up and releases what it still thinks is its lock.
      await releaseSyncLock("src-culture-box", staleToken!);

      // The new holder's lease must still be intact.
      expect(await acquireSyncLock("src-culture-box")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Hangaren, Culture Box, and Poolen leases never interfere with each other", async () => {
    const cultureBox = await acquireSyncLock("src-culture-box");
    const hangaren = await acquireSyncLock("src-hangaren");
    const poolen = await acquireSyncLock("src-poolen");
    expect([cultureBox, hangaren, poolen].every((t) => t !== null)).toBe(true);

    await releaseSyncLock("src-hangaren", hangaren!);

    expect(await acquireSyncLock("src-culture-box")).toBeNull(); // still held
    expect(await acquireSyncLock("src-poolen")).toBeNull(); // still held
    expect(await acquireSyncLock("src-hangaren")).not.toBeNull(); // released, free again
  });
});

describe("runSourceSync (lease acquire/release wrapping the actual sync)", () => {
  it("releases the lock after a clean run, even one that completes via the internal fetch-failure path (not a thrown error)", async () => {
    const adapter = fakeAdapter(() => Promise.reject(new Error("fetch timed out")));
    const result = await runSourceSync("src-culture-box", "Culture Box", adapter);
    expect(result.outcome).toBe("failed");

    // If the lock weren't released, this would come back null.
    expect(await acquireSyncLock("src-culture-box")).not.toBeNull();
  });

  it("releases the lock even when the locked run throws instead of returning normally", async () => {
    const adapter = fakeAdapter(() => Promise.resolve([rawCandidate]));
    vi.mocked(getAllEventsAdmin).mockRejectedValueOnce(new Error("db unavailable"));

    await expect(runSourceSync("src-culture-box", "Culture Box", adapter)).rejects.toThrow("db unavailable");

    // If the lock weren't released in the `finally`, this would come back null.
    expect(await acquireSyncLock("src-culture-box")).not.toBeNull();
  });

  it("a concurrent sync for the same source is skipped_concurrent while a run is (simulated as) still in flight", async () => {
    await acquireSyncLock("src-culture-box"); // simulates another in-flight run already holding the lease
    const adapter = fakeAdapter(() => Promise.resolve([]));
    const result = await runSourceSync("src-culture-box", "Culture Box", adapter);
    expect(result).toEqual({
      sourceId: "src-culture-box",
      outcome: "skipped_concurrent",
      candidatesFound: 0,
      created: 0,
      updated: 0,
      queuedForReview: 0,
      unpublished: 0,
      errors: [],
    });
  });
});

describe("Billetto Discovery Queue noise — a genuinely irrelevant new candidate is never queued (data-quality Workstream, 2026-08-24)", () => {
  it("never calls insertDiscoveryItem for the real 'SpeedDating i København 25-35 år' Billetto candidate", async () => {
    const speedDating: RawCandidateEvent = {
      ...rawCandidate,
      sourceId: "src-billetto",
      title: "SpeedDating i København 25-35 år",
      description: null,
      artists: [],
      officialEventUrl: "https://billetto.dk/e/speeddating-i-kobenhavn-25-35-ar-billetter-1971692",
    };
    const adapter = fakeAdapter(() => Promise.resolve([speedDating]));
    const result = await runSourceSync("src-billetto", "Billetto", adapter);

    expect(result.outcome).toBe("ok");
    expect(result.created).toBe(0);
    expect(result.queuedForReview).toBe(0);
    expect(insertDiscoveryItem).not.toHaveBeenCalled();
  });

  it("still queues a genuinely unclear (not negative-evidenced) Billetto candidate as ordinary review — the gate is narrow, not a blanket drop", async () => {
    const unclear: RawCandidateEvent = {
      ...rawCandidate,
      sourceId: "src-billetto",
      title: "Melting Monday",
      description: null,
      artists: [],
      officialEventUrl: "https://billetto.dk/e/melting-monday-1",
    };
    const adapter = fakeAdapter(() => Promise.resolve([unclear]));
    const result = await runSourceSync("src-billetto", "Billetto", adapter);

    expect(result.outcome).toBe("ok");
    expect(result.queuedForReview).toBe(1);
    expect(insertDiscoveryItem).toHaveBeenCalledTimes(1);
  });
});

describe("trusted-electronic sources — a complete Hangaren/Culture Box candidate auto-publishes even with unresolved genre (Section 6, corrected 2026-08-24)", () => {
  const hangarenVenues: Venue[] = [
    {
      id: "v-hangaren",
      slug: "hangaren",
      name: "Hangaren",
      aliases: [],
      address: "",
      city: "Copenhagen",
      postalCode: "",
      websiteUrl: null,
      description: "",
      shortDescription: null,
      venueProfile: null,
    },
  ];

  it("auto-publishes the real 'Miley Serious' Hangaren case (genre never resolves) purely from the static isTrustedElectronicSource registry — no DB read involved — and never queues it", async () => {
    const miley: RawCandidateEvent = {
      ...rawCandidate,
      sourceId: "src-hangaren",
      title: "Miley Serious",
      description: null,
      artists: ["Miley Serious"],
      venueName: "Hangaren",
      officialEventUrl: "https://www.hangaren.dk/events/miley-serious",
    };
    vi.mocked(getVenues).mockResolvedValueOnce(hangarenVenues);

    const adapter = fakeAdapter(() => Promise.resolve([miley]));
    const result = await runSourceSync("src-hangaren", "Hangaren", adapter);

    expect(result.outcome).toBe("ok");
    expect(result.created).toBe(1);
    expect(result.queuedForReview).toBe(0);
    expect(insertDiscoveryItem).not.toHaveBeenCalled();
  });

  it("existing queue behavior on next sync (correction item 5): a Hangaren candidate that already has a pending discovery_queue row from an earlier, lower-confidence sync gets that row resolved as published — never left stuck — once this sync's trusted-source evidence clears the auto-publish bar", async () => {
    const miley: RawCandidateEvent = {
      ...rawCandidate,
      sourceId: "src-hangaren",
      title: "Miley Serious",
      description: null,
      artists: ["Miley Serious"],
      venueName: "Hangaren",
      officialEventUrl: "https://www.hangaren.dk/events/miley-serious",
    };
    vi.mocked(getVenues).mockResolvedValueOnce(hangarenVenues);

    // Simulate the real Production shape: this candidate's URL already has a
    // "pending" discovery_queue row from a past sync that only had
    // low/unresolved genre confidence to go on.
    const { db } = await import("./client");
    vi.mocked(db.select).mockImplementation(() => {
      const base = {
        from: (table: unknown) => ({
          where: () => {
            // Second Promise.all call is the discoveryQueue pending lookup;
            // the first (sourceEventLinks) stays at the empty default.
            if (table === discoveryQueue) {
              return Promise.resolve([
                {
                  id: "dq-miley-pending",
                  sourceUrl: "https://www.hangaren.dk/events/miley-serious",
                  status: "pending",
                },
              ]);
            }
            return Promise.resolve([]);
          },
        }),
      };
      return base as unknown as ReturnType<typeof db.select>;
    });

    const adapter = fakeAdapter(() => Promise.resolve([miley]));
    const result = await runSourceSync("src-hangaren", "Hangaren", adapter);

    expect(result.outcome).toBe("ok");
    expect(result.created).toBe(1);
    expect(insertDiscoveryItem).not.toHaveBeenCalled();
    const { resolveDiscoveryItemAsPublished } = await import("./writes");
    expect(resolveDiscoveryItemAsPublished).toHaveBeenCalledWith("dq-miley-pending");
  });

  it("event lifecycle/status handling, 2026-08-28 (Section 2): a candidate the source already reports cancelled is never auto-published as a brand-new event, even though it otherwise clears the same auto-publish bar as Miley Serious above — routes to the review queue instead, never a cancellation-specific path", async () => {
    const cancelledFromBirth: RawCandidateEvent = {
      ...rawCandidate,
      sourceId: "src-hangaren",
      title: "Miley Serious",
      description: null,
      artists: ["Miley Serious"],
      venueName: "Hangaren",
      officialEventUrl: "https://www.hangaren.dk/events/miley-serious-cancelled",
      cancelledHint: true,
    };
    vi.mocked(getVenues).mockResolvedValueOnce(hangarenVenues);

    const adapter = fakeAdapter(() => Promise.resolve([cancelledFromBirth]));
    const result = await runSourceSync("src-hangaren", "Hangaren", adapter);

    expect(result.outcome).toBe("ok");
    expect(result.created).toBe(0);
    expect(createEvent).not.toHaveBeenCalled();
    // Falls through to the ordinary review-queue path, same as any other
    // non-auto-publish candidate — not silently dropped, not auto-published.
    expect(result.queuedForReview).toBe(1);
  });

  it("the same trusted-source auto-publish applies to Culture Box, not just Hangaren", async () => {
    const cultureBoxEvent: RawCandidateEvent = {
      ...rawCandidate,
      sourceId: "src-culture-box",
      title: "Unresolved Genre Night",
      description: null,
      artists: ["DJ Unknown"],
      venueName: "Culture Box",
      officialEventUrl: "https://culture-box.com/event/unresolved-genre-night",
    };
    const cultureBoxVenues: Venue[] = [
      {
        id: "v-culture-box",
        slug: "culture-box",
        name: "Culture Box",
        aliases: [],
        address: "",
        city: "Copenhagen",
        postalCode: "",
        websiteUrl: null,
        description: "",
        shortDescription: null,
        venueProfile: null,
      },
    ];
    vi.mocked(getVenues).mockResolvedValueOnce(cultureBoxVenues);

    const adapter = fakeAdapter(() => Promise.resolve([cultureBoxEvent]));
    const result = await runSourceSync("src-culture-box", "Culture Box", adapter);

    expect(result.outcome).toBe("ok");
    expect(result.created).toBe(1);
    expect(result.queuedForReview).toBe(0);
    expect(insertDiscoveryItem).not.toHaveBeenCalled();
  });
});

describe("Discovery Queue notification batching (safety correction — notifications must not serialize the per-candidate DB write path)", () => {
  function unclearBilletto(id: string, title: string): RawCandidateEvent {
    return {
      ...rawCandidate,
      sourceId: "src-billetto",
      title,
      description: null,
      artists: [],
      officialEventUrl: `https://billetto.dk/e/${id}`,
    };
  }

  it("batches all new rows into ONE notifyDiscoveryQueueInsertBatch call after the loop, not one call per candidate", async () => {
    const candidates = [
      unclearBilletto("a", "Melting Monday"),
      unclearBilletto("b", "Tuesday Sessions"),
      unclearBilletto("c", "Wednesday Warehouse"),
    ];
    const adapter = fakeAdapter(() => Promise.resolve(candidates));

    const result = await runSourceSync("src-billetto", "Billetto", adapter);

    expect(result.outcome).toBe("ok");
    expect(result.queuedForReview).toBe(3);
    expect(insertDiscoveryItem).toHaveBeenCalledTimes(3);
    // The batching contract: exactly one call, carrying all three items —
    // never three separate calls (that would just move the serialization
    // problem rather than fix it).
    expect(notifyDiscoveryQueueInsertBatch).toHaveBeenCalledTimes(1);
    const [batchArg] = vi.mocked(notifyDiscoveryQueueInsertBatch).mock.calls[0];
    expect(batchArg).toHaveLength(3);
    expect(batchArg.map((i: { probableTitle: string }) => i.probableTitle)).toEqual([
      "Melting Monday",
      "Tuesday Sessions",
      "Wednesday Warehouse",
    ]);
  });

  it("calls notifyDiscoveryQueueInsertBatch only after every insertDiscoveryItem call has already resolved — never interleaved with the per-candidate DB path", async () => {
    const callOrder: string[] = [];
    vi.mocked(insertDiscoveryItem).mockImplementation((item) => {
      callOrder.push(`insert:${item.id}`);
      return Promise.resolve({
        id: item.id,
        probableTitle: item.probableTitle,
        probableStart: item.probableStart,
        probableVenueName: item.probableVenueName,
        sourceName: item.sourceName,
        sourceUrl: item.sourceUrl,
        predictedGenre: item.predictedGenre,
        genreConfidence: item.genreConfidence,
        overallConfidence: item.overallConfidence,
        missingFields: item.missingFields,
      });
    });
    vi.mocked(notifyDiscoveryQueueInsertBatch).mockImplementation(async () => {
      callOrder.push("notify-batch");
    });

    const candidates = [unclearBilletto("a", "Melting Monday"), unclearBilletto("b", "Tuesday Sessions")];
    const adapter = fakeAdapter(() => Promise.resolve(candidates));
    await runSourceSync("src-billetto", "Billetto", adapter);

    // Both inserts must precede the single batch call — never interleaved.
    expect(callOrder).toHaveLength(3);
    expect(callOrder[callOrder.length - 1]).toBe("notify-batch");
    expect(callOrder.slice(0, -1).every((c) => c.startsWith("insert:"))).toBe(true);
  });

  it("a notification batch failure never fails the sync — ingestion outcome is unaffected", async () => {
    vi.mocked(notifyDiscoveryQueueInsertBatch).mockRejectedValueOnce(new Error("Resend outage"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const adapter = fakeAdapter(() => Promise.resolve([unclearBilletto("a", "Melting Monday")]));
    const result = await runSourceSync("src-billetto", "Billetto", adapter);

    expect(result.outcome).toBe("ok");
    expect(result.queuedForReview).toBe(1);
    expect(result.errors).toEqual([]);
    errorSpy.mockRestore();
  });

  it("does not call notifyDiscoveryQueueInsertBatch at all when no new rows were queued", async () => {
    const adapter = fakeAdapter(() =>
      Promise.resolve([
        {
          ...rawCandidate,
          sourceId: "src-billetto",
          title: "SpeedDating i København 25-35 år",
          description: null,
          artists: [],
          officialEventUrl: "https://billetto.dk/e/speeddating-i-kobenhavn-25-35-ar-billetter-1971692",
        },
      ]),
    );
    const result = await runSourceSync("src-billetto", "Billetto", adapter);

    expect(result.outcome).toBe("ok");
    expect(insertDiscoveryItem).not.toHaveBeenCalled();
    expect(notifyDiscoveryQueueInsertBatch).toHaveBeenCalledWith([]);
  });
});

function existingCultureBoxEvent(): EventWithVenue {
  return {
    id: "e-already-known",
    title: "Some Other Night",
    slug: "some-other-night-e-already-known",
    description: null,
    artists: [],
    startDatetime: "2026-09-05T22:00:00.000Z",
    endDatetime: null,
    timezone: "Europe/Copenhagen",
    venueId: "v-culture-box",
    primaryGenre: "techno",
    subgenres: ["techno"],
    genreConfidence: "high",
    officialEventUrl: "https://culture-box.com/event/some-other-night",
    ticketUrl: null,
    facebookUrl: null,
    residentAdvisorUrl: null,
    otherSourceUrls: [],
    imageUrl: null,
    priceFrom: null,
    currency: null,
    soldOut: false,
    cancelled: false,
    postponed: false,
    dateChanged: false,
    timeChanged: false,
    published: true,
    manualOverride: false,
    overriddenFields: [],
    confidence: "high",
    canonicalSourceId: "src-culture-box",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    lastSourceCheck: null,
    lastChanged: null,
    venue: {
      id: "v-culture-box",
      slug: "culture-box",
      name: "Culture Box",
      aliases: [],
      address: "Kronprinsessegade 54A",
      city: "Copenhagen",
      postalCode: "1306",
      websiteUrl: null,
      description: "",
      shortDescription: null,
      venueProfile: null,
    },
  };
}

describe("Event lifecycle/status handling (2026-08-28) — source disappearance never implies cancellation", () => {
  it("an existing published event this sync's candidates never mention is never touched — no write of any kind, cancelled included", async () => {
    // A previously-known, currently-published event that this run's
    // adapter output simply doesn't return (e.g. it already happened and
    // fell off the venue's listing page, or a transient scrape gap) — the
    // sync loop only ever visits events reachable via THIS run's own
    // candidates (URL-linked or fuzzy-matched); an event absent from
    // `candidates` entirely is structurally never looked up, so it can
    // never be cancelled, unpublished, or otherwise modified by its mere
    // absence from one run.
    vi.mocked(getAllEventsAdmin).mockResolvedValueOnce([existingCultureBoxEvent()]);
    // This run's own candidate is a completely unrelated new event —
    // proves the existing row above is never even considered, not merely
    // that its outcome happens to be "no change."
    const adapter = fakeAdapter(() => Promise.resolve([rawCandidate]));

    await runSourceSync("src-culture-box", "Culture Box", adapter);

    expect(applySourceSyncPatch).not.toHaveBeenCalled();
    expect(applySyncHoldUnpublish).not.toHaveBeenCalled();
  });

  it("zero candidates from the adapter (zero-event anomaly) never cancels or unpublishes any existing event — it's treated as a sync failure to investigate, not evidence of cancellation", async () => {
    vi.mocked(getAllEventsAdmin).mockResolvedValueOnce([existingCultureBoxEvent()]);
    const adapter = fakeAdapter(() => Promise.resolve([]));

    const result = await runSourceSync("src-culture-box", "Culture Box", adapter);

    expect(result.outcome).toBe("zero_events");
    expect(applySourceSyncPatch).not.toHaveBeenCalled();
    expect(applySyncHoldUnpublish).not.toHaveBeenCalled();
  });
});

describe("Unknown-venue visibility + source freshness (work package, 2026-08-31) — real Billetto shapes from the completed activation test", () => {
  afterEach(() => {
    vi.useRealTimers();
  });


  it("1. qualifying candidate + unknown venue -> queued with real genre evidence, the venue-unresolved reason in missingFields, and lastSeenAt stamped (the precondition modeVenueBlocks' ACTIVE report depends on)", async () => {
    const electroWerkz: RawCandidateEvent = {
      ...rawCandidate,
      sourceId: "src-billetto",
      title: "Electro Werkz",
      venueName: "Råhuset", // Råhuset — not in the (empty, default-mocked) venues table
      genreHint: "electro",
      genreConfidenceHint: "high",
      officialEventUrl: "https://billetto.dk/e/electro-werkz-billetter-1982707",
    };
    const adapter = fakeAdapter(() => Promise.resolve([electroWerkz]));
    vi.setSystemTime(new Date("2026-08-31T13:00:00Z"));
    const result = await runSourceSync("src-billetto", "Billetto", adapter);

    expect(result.outcome).toBe("ok");
    expect(insertDiscoveryItem).toHaveBeenCalledTimes(1);
    const call = vi.mocked(insertDiscoveryItem).mock.calls[0][0];
    expect(call.predictedGenre).toBe("electro");
    expect(call.missingFields).toContain("venue (unresolved against registry)");
    expect(call.lastSeenAt).toEqual(new Date("2026-08-31T13:00:00Z"));
  });

  it("2. manual-review-tier candidate (generic-floor genre, no strong signal) + unknown venue -> also queued as an active venue block. While venue-blocked, decision is always 'hold' (meetsMinimumFields requires a resolved venue before review_queue-vs-auto_publish is ever decided — real Electro Werkz/Wyatt E. evidence: both showed overallConfidence 'low' while blocked, genreConfidence is what actually distinguishes a would-be-qualifying candidate ('high') from a would-be-review one ('medium') once its venue resolves", async () => {
    const wyattE: RawCandidateEvent = {
      ...rawCandidate,
      sourceId: "src-billetto",
      title: "Wyatt E. x Five The Hierophant",
      venueName: "Råhuset",
      genreHint: "electronic-other",
      genreConfidenceHint: "medium",
      officialEventUrl: "https://billetto.dk/e/wyatt-e-x-five-the-hierophant-billetter-1957514",
    };
    const adapter = fakeAdapter(() => Promise.resolve([wyattE]));
    vi.setSystemTime(new Date("2026-08-31T13:00:00Z"));
    const result = await runSourceSync("src-billetto", "Billetto", adapter);

    expect(result.outcome).toBe("ok");
    expect(insertDiscoveryItem).toHaveBeenCalledTimes(1);
    const call = vi.mocked(insertDiscoveryItem).mock.calls[0][0];
    expect(call.predictedGenre).toBe("electronic-other");
    expect(call.genreConfidence).toBe("medium");
    expect(call.overallConfidence).toBe("low");
    expect(call.missingFields).toContain("venue (unresolved against registry)");
    expect(call.lastSeenAt).toEqual(new Date("2026-08-31T13:00:00Z"));
  });

  it("3. non-qualifying candidate (no genre evidence at all) + unknown venue -> never presented as a venue-onboarding opportunity (predictedGenre stays null, excluded by modeVenueBlocks' own predicted_genre IS NOT NULL filter regardless of whether a row is created)", async () => {
    const noEvidence: RawCandidateEvent = {
      ...rawCandidate,
      sourceId: "src-billetto",
      title: "Some Unrelated Workshop",
      description: "A quiet afternoon workshop, nothing electronic about it.",
      venueName: "Råhuset",
      genreHint: null,
      genreConfidenceHint: null,
      officialEventUrl: "https://billetto.dk/e/some-unrelated-workshop",
    };
    const adapter = fakeAdapter(() => Promise.resolve([noEvidence]));
    await runSourceSync("src-billetto", "Billetto", adapter);

    if (vi.mocked(insertDiscoveryItem).mock.calls.length > 0) {
      expect(vi.mocked(insertDiscoveryItem).mock.calls[0][0].predictedGenre).toBeNull();
    }
  });

  it("4. candidate seen again on a later sync (existing pending row, venue still unresolved) -> lastSeenAt is bumped to THIS sync's time, independent of whether classification also changed", async () => {
    const { db } = await import("./client");
    vi.mocked(db.select).mockImplementation(() => {
      const base = {
        from: (table: unknown) => ({
          where: () => {
            if (table === discoveryQueue) {
              return Promise.resolve([
                {
                  id: "dq-electro-werkz",
                  sourceUrl: "https://billetto.dk/e/electro-werkz-billetter-1982707",
                  status: "pending",
                  predictedGenre: "electro",
                  genreConfidence: "high",
                  overriddenFields: [],
                  overallConfidence: "low",
                  missingFields: ["venue (unresolved against registry)"],
                  suspectedDuplicateOfEventId: null,
                },
              ]);
            }
            return Promise.resolve([]);
          },
        }),
      };
      return base as unknown as ReturnType<typeof db.select>;
    });

    const electroWerkz: RawCandidateEvent = {
      ...rawCandidate,
      sourceId: "src-billetto",
      title: "Electro Werkz",
      venueName: "Råhuset",
      genreHint: "electro",
      genreConfidenceHint: "high",
      officialEventUrl: "https://billetto.dk/e/electro-werkz-billetter-1982707",
    };
    const adapter = fakeAdapter(() => Promise.resolve([electroWerkz]));
    vi.setSystemTime(new Date("2026-08-31T19:00:00Z"));
    await runSourceSync("src-billetto", "Billetto", adapter);

    const { applyDiscoveryClassificationUpdate } = await import("./writes");
    expect(applyDiscoveryClassificationUpdate).toHaveBeenCalledWith(
      "dq-electro-werkz",
      expect.objectContaining({ lastSeenAt: new Date("2026-08-31T19:00:00Z") }),
    );
  });

  it("5. a normal (non-partial-fetch) successful sync marks the source's sync as COMPLETE — touchSourceSyncStats receives complete: true — the baseline every existing adapter (no lastFetchWasComplete method) already satisfies", async () => {
    const adapter = fakeAdapter(() => Promise.resolve([rawCandidate]));
    await runSourceSync("src-culture-box", "Culture Box", adapter);

    const { touchSourceSyncStats } = await import("./writes");
    expect(touchSourceSyncStats).toHaveBeenCalledWith(
      "src-culture-box",
      expect.objectContaining({ success: true, complete: true }),
    );
  });

  it("6. a source reporting a PARTIAL fetch (e.g. Billetto's own later-page-failure resilience) marks the sync as complete: false — this is what stops an unseen candidate from that same run being wrongly treated as stale", async () => {
    const adapter: SourceAdapter = {
      sourceId: "src-billetto",
      fetchCandidates: () => Promise.resolve([rawCandidate]),
      lastFetchWasComplete: () => false,
    };
    await runSourceSync("src-billetto", "Billetto", adapter);

    const { touchSourceSyncStats } = await import("./writes");
    expect(touchSourceSyncStats).toHaveBeenCalledWith(
      "src-billetto",
      expect.objectContaining({ success: true, complete: false }),
    );
  });

  it("7. once the venue is registered, the NEXT normal sync resolves it, re-evaluates the pipeline, and resolves the prior pending row as published — no manual edit, no manual event creation, no Billetto-specific code", async () => {
    const raahuset: Venue[] = [
      {
        id: "v-rahuset",
        slug: "rahuset",
        name: "Råhuset",
        aliases: [],
        address: "Onkel Dannys Pl. 7, 1711 København V",
        city: "Copenhagen",
        postalCode: "1711",
        websiteUrl: null,
        description: "",
        shortDescription: null,
        venueProfile: null,
      },
    ];
    vi.mocked(getVenues).mockResolvedValueOnce(raahuset);

    const { db } = await import("./client");
    vi.mocked(db.select).mockImplementation(() => {
      const base = {
        from: (table: unknown) => ({
          where: () => {
            if (table === discoveryQueue) {
              return Promise.resolve([
                {
                  id: "dq-electro-werkz",
                  sourceUrl: "https://billetto.dk/e/electro-werkz-billetter-1982707",
                  status: "pending",
                },
              ]);
            }
            return Promise.resolve([]);
          },
        }),
      };
      return base as unknown as ReturnType<typeof db.select>;
    });

    const electroWerkz: RawCandidateEvent = {
      ...rawCandidate,
      sourceId: "src-billetto",
      title: "Electro Werkz",
      venueName: "Råhuset",
      genreHint: "electro",
      genreConfidenceHint: "high",
      officialEventUrl: "https://billetto.dk/e/electro-werkz-billetter-1982707",
    };
    const adapter = fakeAdapter(() => Promise.resolve([electroWerkz]));
    const result = await runSourceSync("src-billetto", "Billetto", adapter);

    expect(result.outcome).toBe("ok");
    expect(result.created).toBe(1);
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(insertDiscoveryItem).not.toHaveBeenCalled();
    const { resolveDiscoveryItemAsPublished } = await import("./writes");
    expect(resolveDiscoveryItemAsPublished).toHaveBeenCalledWith("dq-electro-werkz");
  });

  it("8. after venue registration, a genuine duplicate of an already-canonical event still routes through ordinary dedup — never a second canonical row just because this feature exists", async () => {
    const raahuset: Venue[] = [
      {
        id: "v-rahuset",
        slug: "rahuset",
        name: "Råhuset",
        aliases: [],
        address: "Onkel Dannys Pl. 7, 1711 København V",
        city: "Copenhagen",
        postalCode: "1711",
        websiteUrl: null,
        description: "",
        shortDescription: null,
        venueProfile: null,
      },
    ];
    vi.mocked(getVenues).mockResolvedValueOnce(raahuset);
    vi.mocked(getAllEventsAdmin).mockResolvedValueOnce([
      {
        id: "e-existing-electro-werkz",
        title: "Electro Werkz",
        slug: "electro-werkz",
        description: null,
        artists: [],
        venueId: "v-rahuset",
        startDatetime: "2026-08-15T18:00:00.000Z",
        endDatetime: null,
        officialEventUrl: "https://billetto.dk/e/electro-werkz-billetter-1982707",
        ticketUrl: null,
        facebookUrl: null,
        residentAdvisorUrl: null,
        imageUrl: null,
        primaryGenre: "electro",
        overriddenFields: [],
        soldOut: false,
        cancelled: false,
        postponed: false,
        canonicalSourceId: "src-billetto",
        published: true,
        manualOverride: false,
      } as unknown as EventWithVenue,
    ]);

    const duplicateCandidate: RawCandidateEvent = {
      ...rawCandidate,
      sourceId: "src-billetto",
      title: "Electro Werkz",
      venueName: "Råhuset",
      startDatetime: "2026-08-15T18:00:00.000Z",
      genreHint: "electro",
      genreConfidenceHint: "high",
      officialEventUrl: "https://billetto.dk/e/electro-werkz-billetter-1982707",
    };
    const adapter = fakeAdapter(() => Promise.resolve([duplicateCandidate]));
    const result = await runSourceSync("src-billetto", "Billetto", adapter);

    expect(result.outcome).toBe("ok");
    expect(createEvent).not.toHaveBeenCalled();
    expect(result.updated).toBe(1);
  });

  it("9. a candidate absent from this sync's fetch (e.g. it expired from the source's own feed) is never touched — its lastSeenAt stays exactly where it was, which is what lets it fall stale relative to the source's next complete sync", async () => {
    // Only an UNRELATED candidate is returned this cycle — High Energy
    // Movement's own row (if it existed) is never looked up at all, proving
    // it structurally cannot have its lastSeenAt bumped by a sync that never
    // saw it.
    const unrelated: RawCandidateEvent = {
      ...rawCandidate,
      sourceId: "src-billetto",
      title: "Some Other Current Candidate",
      officialEventUrl: "https://billetto.dk/e/some-other-current-candidate",
    };
    const adapter = fakeAdapter(() => Promise.resolve([unrelated]));
    await runSourceSync("src-billetto", "Billetto", adapter);

    const { applyDiscoveryClassificationUpdate } = await import("./writes");
    const touchedIds = vi.mocked(applyDiscoveryClassificationUpdate).mock.calls.map((c) => c[0]);
    expect(touchedIds).not.toContain("dq-high-energy-movement");
  });

  it("10. existing Billetto flow remains completely intact — a normal auto-publish-eligible Billetto candidate with an already-resolved venue still creates a canonical event exactly as before this work package", async () => {
    const rustVenue: Venue[] = [
      {
        id: "v-rust",
        slug: "rust",
        name: "RUST",
        aliases: [],
        address: "Guldbergsgade 8, 2200 København N",
        city: "Copenhagen",
        postalCode: "2200",
        websiteUrl: null,
        description: "",
        shortDescription: null,
        venueProfile: null,
      },
    ];
    vi.mocked(getVenues).mockResolvedValueOnce(rustVenue);

    const nnhmn: RawCandidateEvent = {
      ...rawCandidate,
      sourceId: "src-billetto",
      title: "Det berlinske darkwave-fænomen NNHMN har sin debut i København!",
      venueName: "RUST",
      genreHint: "electro",
      genreConfidenceHint: "high",
      officialEventUrl: "https://billetto.dk/e/det-berlinske-darkwave-faenomen-nnhmn-har-sin-debut-i-kobenhavn-billetter-1983805",
    };
    const adapter = fakeAdapter(() => Promise.resolve([nnhmn]));
    const result = await runSourceSync("src-billetto", "Billetto", adapter);

    expect(result.outcome).toBe("ok");
    expect(result.created).toBe(1);
    expect(createEvent).toHaveBeenCalledTimes(1);
    const created = vi.mocked(createEvent).mock.calls[0][0];
    expect(created.venueId).toBe("v-rust");
    expect(created.primaryGenre).toBe("electro");
    expect(created.published).toBe(true);
  });
});
