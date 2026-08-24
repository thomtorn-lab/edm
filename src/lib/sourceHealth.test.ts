import { describe, expect, it } from "vitest";
import { describeSourceHealth, getSourceHealth, isStale, parseSyncFrequencyMs } from "./sourceHealth";
import type { Source } from "./types";

function baseSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "s-1",
    sourceName: "Test Source",
    sourceType: "official-venue",
    baseUrl: "https://example.com",
    roles: ["discovery", "ingestion"],
    adapter: "first-party-json",
    trustLevel: "high",
    autoPublish: true,
    trustedElectronicSource: false,
    syncFrequency: "every 6h",
    active: true,
    lastSuccessfulSync: "2026-08-13T06:00:00+02:00",
    lastAttemptedSync: "2026-08-13T06:00:00+02:00",
    lastError: null,
    eventsFound: 10,
    eventsUpdated: 1,
    integrationNote: "",
    ...overrides,
  };
}

// Close to baseSource()'s fixed lastSuccessfulSync so tests that aren't
// about staleness don't depend on the real wall-clock date.
const SHORTLY_AFTER_BASE_SYNC = new Date("2026-08-13T08:00:00+02:00");

describe("getSourceHealth", () => {
  it("is ok for an active, error-free, non-zero source", () => {
    expect(getSourceHealth(baseSource(), SHORTLY_AFTER_BASE_SYNC)).toBe("ok");
  });

  it("flags an unexpected zero-event reading as degraded, not inactive", () => {
    expect(getSourceHealth(baseSource({ eventsFound: 0 }), SHORTLY_AFTER_BASE_SYNC)).toBe("degraded");
  });

  it("flags a sync error as degraded", () => {
    expect(getSourceHealth(baseSource({ lastError: "parse failure" }), SHORTLY_AFTER_BASE_SYNC)).toBe("degraded");
  });

  it("is inactive when the source is turned off", () => {
    expect(getSourceHealth(baseSource({ active: false }), SHORTLY_AFTER_BASE_SYNC)).toBe("inactive");
  });

  it("is discovery-only when there is no ingestion adapter", () => {
    expect(getSourceHealth(baseSource({ adapter: null, eventsFound: 0, lastSuccessfulSync: null }), SHORTLY_AFTER_BASE_SYNC)).toBe(
      "discovery-only",
    );
  });

  describe("staleness (freshness threshold from syncFrequency)", () => {
    const NOW = new Date("2026-08-15T12:00:00+02:00");

    it("is ok when the last successful sync is within the threshold", () => {
      // "every 6h" -> stale past 12h; 5h ago is comfortably fresh.
      const source = baseSource({ lastSuccessfulSync: "2026-08-15T07:00:00+02:00" });
      expect(getSourceHealth(source, NOW)).toBe("ok");
      expect(isStale(source, NOW)).toBe(false);
    });

    it("tolerates one missed/delayed cycle without flagging stale", () => {
      // 6h late (one missed cycle) is still under the 2x/12h threshold.
      const source = baseSource({ lastSuccessfulSync: "2026-08-15T00:00:00+02:00" });
      expect(getSourceHealth(source, NOW)).toBe("ok");
    });

    it("is stale once elapsed time exceeds 2x syncFrequency", () => {
      // 13h since last success, past the 12h (2x 6h) threshold.
      const source = baseSource({ lastSuccessfulSync: "2026-08-14T23:00:00+02:00" });
      expect(getSourceHealth(source, NOW)).toBe("stale");
      expect(isStale(source, NOW)).toBe(true);
      expect(describeSourceHealth(source, NOW)).toContain("every 6h");
    });

    it("a recorded error takes precedence over staleness", () => {
      const source = baseSource({
        lastSuccessfulSync: "2026-08-14T23:00:00+02:00", // would otherwise be stale
        lastError: "fetch failed: ENOTFOUND",
      });
      expect(getSourceHealth(source, NOW)).toBe("degraded");
    });

    it("never flags staleness for a source that has not had a first successful sync yet", () => {
      const source = baseSource({ lastSuccessfulSync: null });
      expect(getSourceHealth(source, NOW)).toBe("ok");
    });

    it("never flags staleness for non-fixed-cadence sources (manual coverage check)", () => {
      const source = baseSource({
        syncFrequency: "manual coverage check",
        lastSuccessfulSync: "2020-01-01T00:00:00+02:00", // years stale by any fixed cadence
      });
      expect(isStale(source, NOW)).toBe(false);
      expect(getSourceHealth(source, NOW)).toBe("ok");
    });

    it("never flags staleness for an inactive source (inactive wins)", () => {
      const source = baseSource({ active: false, lastSuccessfulSync: "2020-01-01T00:00:00+02:00" });
      expect(getSourceHealth(source, NOW)).toBe("inactive");
    });
  });

  describe("parseSyncFrequencyMs", () => {
    it("parses hour cadences", () => {
      expect(parseSyncFrequencyMs("every 6h")).toBe(6 * 60 * 60 * 1000);
      expect(parseSyncFrequencyMs("every 12 hours")).toBe(12 * 60 * 60 * 1000);
    });

    it("parses minute and day cadences", () => {
      expect(parseSyncFrequencyMs("every 30m")).toBe(30 * 60 * 1000);
      expect(parseSyncFrequencyMs("every 1 day")).toBe(24 * 60 * 60 * 1000);
    });

    it("returns null for non-fixed-cadence descriptions", () => {
      expect(parseSyncFrequencyMs("manual coverage check")).toBeNull();
      expect(parseSyncFrequencyMs("manual")).toBeNull();
    });
  });
});
