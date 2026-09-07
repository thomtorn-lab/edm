import { describe, expect, it } from "vitest";
import { getSourceCancellationPolicy } from "./sources";

describe("getSourceCancellationPolicy (source-driven cancellation safety, 2026-09-07)", () => {
  it("returns 'trusted' for the three sources whose adapters can set cancelledHint at all today", () => {
    expect(getSourceCancellationPolicy("src-billetto")).toBe("trusted");
    expect(getSourceCancellationPolicy("src-poolen")).toBe("trusted");
    expect(getSourceCancellationPolicy("src-pumpehuset")).toBe("trusted");
  });

  it("returns 'none' for a source with no cancellation capability (e.g. a discovery-only aggregator)", () => {
    expect(getSourceCancellationPolicy("src-kultunaut")).toBe("none");
  });

  it("returns 'none' for a source that never sets cancelledHint despite being a high-trust official venue (e.g. Hangaren/Culture Box)", () => {
    expect(getSourceCancellationPolicy("src-hangaren")).toBe("none");
    expect(getSourceCancellationPolicy("src-culture-box")).toBe("none");
  });

  it("returns 'none' for an unknown/unregistered source id — never defaults open", () => {
    expect(getSourceCancellationPolicy("src-does-not-exist")).toBe("none");
  });
});
