import { describe, expect, it } from "vitest";
import { getSourceHealth } from "./sourceHealth";
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

describe("getSourceHealth", () => {
  it("is ok for an active, error-free, non-zero source", () => {
    expect(getSourceHealth(baseSource())).toBe("ok");
  });

  it("flags an unexpected zero-event reading as degraded, not inactive", () => {
    expect(getSourceHealth(baseSource({ eventsFound: 0 }))).toBe("degraded");
  });

  it("flags a sync error as degraded", () => {
    expect(getSourceHealth(baseSource({ lastError: "parse failure" }))).toBe("degraded");
  });

  it("is inactive when the source is turned off", () => {
    expect(getSourceHealth(baseSource({ active: false }))).toBe("inactive");
  });

  it("is discovery-only when there is no ingestion adapter", () => {
    expect(getSourceHealth(baseSource({ adapter: null, eventsFound: 0, lastSuccessfulSync: null }))).toBe("discovery-only");
  });
});
