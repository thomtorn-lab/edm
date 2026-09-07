import { describe, expect, it } from "vitest";
import { getSourceCancellationPolicy, SOURCES } from "./sources";

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

  it("reads real per-source registry metadata (Source.cancellationPolicy), not a hardcoded id list — every one of the 23 registered sources sets it explicitly, and exactly the three cancelledHint-capable sources are 'trusted'", () => {
    expect(SOURCES.length).toBe(23);
    for (const s of SOURCES) {
      expect(s.cancellationPolicy).toBeDefined();
    }
    const trusted = SOURCES.filter((s) => s.cancellationPolicy === "trusted").map((s) => s.id).sort();
    expect(trusted).toEqual(["src-billetto", "src-poolen", "src-pumpehuset"]);
  });
});
