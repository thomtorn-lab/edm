import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncLocks } from "./schema";
import type { RawCandidateEvent, SourceAdapter } from "@/lib/adapters/types";

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
    // runSourceSyncLocked also reads sourceEventLinks/discoveryQueue directly
    // via db.select() — irrelevant to the lease mechanism under test here,
    // so always resolves empty.
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  },
}));

vi.mock("./writes", () => ({
  touchSourceSyncStats: vi.fn().mockResolvedValue(undefined),
  applySourceSyncPatch: vi.fn(),
  createEvent: vi.fn(),
  insertDiscoveryItem: vi.fn(),
  recordSourceLink: vi.fn(),
  resolveDiscoveryItemAsPublished: vi.fn(),
  applyDiscoveryClassificationUpdate: vi.fn(),
}));

vi.mock("@/lib/queries", () => ({
  getVenues: vi.fn().mockResolvedValue([]),
  getAllEventsAdmin: vi.fn().mockResolvedValue([]),
}));

const { acquireSyncLock, releaseSyncLock, runSourceSync } = await import("./sync");
const { getAllEventsAdmin } = await import("@/lib/queries");

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
      errors: [],
    });
  });
});
