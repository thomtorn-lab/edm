import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Dedicated file (mirrors src/db/writes.afterDeferral.test.ts's own doc
 * comment on why) — mocking "next/server"'s after() with controllable
 * behavior across both the real-request and no-active-request scenarios.
 */

const sweepNewsletterRetentionMock = vi.fn();
vi.mock("@/db/newsletter", () => ({
  sweepNewsletterRetention: (...args: unknown[]) => sweepNewsletterRetentionMock(...args),
}));

let afterShouldThrow = false;
let capturedAfterCallback: (() => void | Promise<void>) | null = null;
const afterMock = vi.fn((cb: () => void | Promise<void>) => {
  if (afterShouldThrow) {
    // Mirrors the real implementation (node_modules/next/dist/server/after/after.js):
    // a synchronous throw when called outside an active request scope.
    throw new Error("`after` was called outside a request scope.");
  }
  capturedAfterCallback = cb;
});
vi.mock("next/server", () => ({ after: (cb: () => void | Promise<void>) => afterMock(cb) }));

const { triggerRetentionSweep } = await import("./retentionSweep");

beforeEach(() => {
  afterShouldThrow = false;
  capturedAfterCallback = null;
  afterMock.mockClear();
  sweepNewsletterRetentionMock.mockReset().mockResolvedValue({ deletedOldSends: 0, deletedExpiredUnconfirmed: 0 });
});

describe("triggerRetentionSweep", () => {
  it("defers the sweep via after() and doesn't call sweepNewsletterRetention synchronously when a request scope is active", async () => {
    await triggerRetentionSweep();
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(sweepNewsletterRetentionMock).not.toHaveBeenCalled();
    await capturedAfterCallback?.();
    expect(sweepNewsletterRetentionMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to a synchronous sweep when after() throws (no active request scope)", async () => {
    afterShouldThrow = true;
    await triggerRetentionSweep();
    expect(sweepNewsletterRetentionMock).toHaveBeenCalledTimes(1);
  });
});
