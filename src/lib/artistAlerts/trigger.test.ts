import { afterEach, describe, expect, it, vi } from "vitest";

const reconcile = vi.fn();
const deferred: (() => Promise<void>)[] = [];
vi.mock("@/db/artistAppearances", () => ({ reconcileArtistAppearances: reconcile }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => deferred.push(fn) }));

afterEach(() => {
  delete process.env.ARTIST_ALERTS_MODE;
  deferred.length = 0;
  reconcile.mockReset();
});

describe("reconcileArtistsSoon", () => {
  it("defers one lineup reconcile until after the response, and does nothing while off", async () => {
    const { reconcileArtistsSoon } = await import("./trigger");
    reconcileArtistsSoon();
    expect(deferred).toHaveLength(0);
    process.env.ARTIST_ALERTS_MODE = "test";
    reconcileArtistsSoon();
    expect(deferred).toHaveLength(1);
    expect(reconcile).not.toHaveBeenCalled();
    await deferred[0]();
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("never lets a reconcile failure reach the caller", async () => {
    process.env.ARTIST_ALERTS_MODE = "live";
    reconcile.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { reconcileArtistsSoon } = await import("./trigger");
    reconcileArtistsSoon();
    await expect(deferred[0]()).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
