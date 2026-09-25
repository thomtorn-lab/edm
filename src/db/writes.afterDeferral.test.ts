import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenreSlug } from "../lib/taxonomy";

/**
 * Dedicated file (separate from writes.test.ts) because this needs to mock
 * "next/server"'s after() with controllable behavior across two scenarios
 * — writes.test.ts deliberately relies on the REAL after() throwing (there
 * is no active Next.js request scope in a plain vitest process, which is
 * itself a real, load-bearing assertion: it's exactly what makes
 * createEvent's non-request callers, e.g. src/db/verifyProductionBootstrap.ts,
 * fall back to a synchronous await safely). Mocking "next/server" here
 * module-wide would change that for every test in this file, so it gets
 * its own file rather than perturbing writes.test.ts's existing 70 passing
 * cases (see the latency review, 2026-09-25, for why this distinction
 * matters: "errors don't propagate" and "the call doesn't delay
 * completion" are different guarantees, and this proves the second one).
 */

const insertValuesMock = vi.fn(() => {
  const resolved = Promise.resolve(undefined);
  return Object.assign(resolved, { onConflictDoNothing: () => Promise.resolve(undefined) });
});
const selectMock = vi.fn(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }));
vi.mock("./client", () => ({
  db: {
    insert: () => ({ values: insertValuesMock }),
    select: () => selectMock(),
  },
}));

let enrichmentResolve: (() => void) | null = null;
const enrichArtistYoutubePreviewsMock = vi.fn((_names: string[]) => {
  return new Promise<void>((resolve) => {
    enrichmentResolve = resolve;
  });
});
vi.mock("./youtubePreview", () => ({
  enrichArtistYoutubePreviews: (names: string[]) => enrichArtistYoutubePreviewsMock(names),
}));

let afterShouldThrow = false;
let capturedAfterCallback: (() => void | Promise<void>) | null = null;
const afterMock = vi.fn((cb: () => void | Promise<void>) => {
  if (afterShouldThrow) {
    // Mirrors the real implementation exactly (node_modules/next/dist/server/after/after.js):
    // a synchronous throw when called outside an active request scope.
    throw new Error("`after` was called outside a request scope.");
  }
  // Real after() doesn't run the callback synchronously either — it runs
  // once the response has been sent. Capturing it (never auto-invoking)
  // is what lets the test below prove createEvent doesn't wait for it.
  capturedAfterCallback = cb;
});
vi.mock("next/server", () => ({ after: (cb: () => void | Promise<void>) => afterMock(cb) }));

const { createEvent } = await import("./writes");

const baseInput = {
  id: "e-latencytest",
  title: "Latency Test Event",
  slug: "latency-test-event-e-latencytest",
  description: null,
  artists: ["Some Artist"],
  startDatetime: new Date("2026-10-01T20:00:00Z"),
  endDatetime: null as Date | null,
  venueId: "v-test",
  subVenue: null,
  primaryGenre: "techno" as GenreSlug,
  subgenres: [] as GenreSlug[],
  genreConfidence: "medium" as const,
  officialEventUrl: null,
  ticketUrl: null,
  facebookUrl: null,
  residentAdvisorUrl: null,
  imageUrl: null,
  priceFrom: null,
  currency: null,
  soldOut: false,
  cancelled: false,
  published: true,
  confidence: "medium" as const,
  canonicalSourceId: null,
};

beforeEach(() => {
  insertValuesMock.mockClear();
  selectMock.mockClear();
  enrichArtistYoutubePreviewsMock.mockClear();
  enrichmentResolve = null;
  afterMock.mockClear();
  afterShouldThrow = false;
  capturedAfterCallback = null;
});

function flushMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe("createEvent — YouTube enrichment latency (2026-09-25 architecture review)", () => {
  it("when after() is available (request scope), createEvent resolves WITHOUT waiting for enrichment to finish", async () => {
    afterShouldThrow = false;

    const createEventPromise = createEvent(baseInput, "admin");

    // createEvent must resolve here even though the enrichment call hasn't
    // even happened yet (after() only captures the callback, exactly like
    // the real implementation, which runs it once the response has been
    // sent — not before) — this is the actual latency guarantee, not just
    // "errors don't propagate".
    await expect(createEventPromise).resolves.toBeUndefined();

    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(capturedAfterCallback).not.toBeNull();
    expect(enrichArtistYoutubePreviewsMock).not.toHaveBeenCalled(); // not yet — only once the deferred callback actually runs

    // Simulating Next.js running the deferred callback after the response:
    const deferredResult = capturedAfterCallback!();
    expect(enrichArtistYoutubePreviewsMock).toHaveBeenCalledWith(["Some Artist"]);
    enrichmentResolve!();
    await expect(deferredResult).resolves.toBeUndefined();
  });

  it("when after() throws (no request scope, e.g. verifyProductionBootstrap.ts/verifySync.ts), falls back to a synchronous await", async () => {
    afterShouldThrow = true;

    const createEventPromise = createEvent(baseInput, "script-runner");

    let settledEarly = false;
    createEventPromise.then(() => {
      settledEarly = true;
    });
    // Flush a full macrotask boundary — if createEvent were (incorrectly)
    // resolving without awaiting the fallback, it would already be settled
    // by now even though enrichmentResolve() hasn't been called yet.
    await flushMacrotask();
    expect(settledEarly).toBe(false);
    expect(enrichArtistYoutubePreviewsMock).toHaveBeenCalledWith(["Some Artist"]);

    enrichmentResolve!();
    await expect(createEventPromise).resolves.toBeUndefined();
    expect(afterMock).toHaveBeenCalledTimes(1);
  });
});
