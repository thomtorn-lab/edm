import { describe, expect, it } from "vitest";
import { toProductionSourceRow } from "./sourceRegistry";
import { SOURCES } from "./data/sources";
import type { Source } from "./types";

/**
 * Pure-logic coverage for the production-bootstrap safety property: no
 * fabricated source sync-health ever reaches a production insert/update.
 * The DB-touching half (seedVenues/seedSourcesProduction actually writing
 * to Postgres) is covered by src/db/verifyProductionBootstrap.ts, which
 * needs a live database and isn't part of this unit-test suite.
 */

function sourceFixture(overrides: Partial<Source> = {}): Source {
  return {
    id: "src-test",
    sourceName: "Test Source",
    sourceType: "official-venue",
    baseUrl: "https://example.com/",
    roles: ["discovery", "ingestion"],
    adapter: "test-adapter",
    trustLevel: "high",
    autoPublish: true,
    syncFrequency: "every 6h",
    active: true,
    lastSuccessfulSync: "2026-08-13T07:00:00+02:00",
    lastAttemptedSync: "2026-08-13T07:00:00+02:00",
    lastError: "fabricated demo error — never a real sync",
    eventsFound: 42,
    eventsUpdated: 7,
    integrationNote: "test",
    ...overrides,
  };
}

describe("toProductionSourceRow", () => {
  it("strips every fabricated health field down to a neutral 'never synced' state on insert", () => {
    const { insertRow } = toProductionSourceRow(sourceFixture());
    expect(insertRow.lastSuccessfulSync).toBeNull();
    expect(insertRow.lastAttemptedSync).toBeNull();
    expect(insertRow.lastError).toBeNull();
    expect(insertRow.eventsFound).toBe(0);
    expect(insertRow.eventsUpdated).toBe(0);
  });

  it("preserves all static configuration fields on insert", () => {
    const fixture = sourceFixture();
    const { insertRow } = toProductionSourceRow(fixture);
    expect(insertRow.id).toBe(fixture.id);
    expect(insertRow.sourceName).toBe(fixture.sourceName);
    expect(insertRow.sourceType).toBe(fixture.sourceType);
    expect(insertRow.baseUrl).toBe(fixture.baseUrl);
    expect(insertRow.roles).toEqual(fixture.roles);
    expect(insertRow.adapter).toBe(fixture.adapter);
    expect(insertRow.trustLevel).toBe(fixture.trustLevel);
    expect(insertRow.autoPublish).toBe(fixture.autoPublish);
    expect(insertRow.syncFrequency).toBe(fixture.syncFrequency);
    expect(insertRow.active).toBe(fixture.active);
    expect(insertRow.integrationNote).toBe(fixture.integrationNote);
  });

  it("the update-on-conflict set contains NO health fields at all — a re-run can never reset real accumulated sync history", () => {
    const { updateSet } = toProductionSourceRow(sourceFixture());
    expect(updateSet).not.toHaveProperty("lastSuccessfulSync");
    expect(updateSet).not.toHaveProperty("lastAttemptedSync");
    expect(updateSet).not.toHaveProperty("lastError");
    expect(updateSet).not.toHaveProperty("eventsFound");
    expect(updateSet).not.toHaveProperty("eventsUpdated");
  });

  it("holds for every real source in the registry, not just a synthetic fixture", () => {
    for (const source of SOURCES) {
      const { insertRow, updateSet } = toProductionSourceRow(source);
      expect(insertRow.eventsFound).toBe(0);
      expect(insertRow.lastError).toBeNull();
      expect(updateSet).not.toHaveProperty("eventsFound");
      expect(updateSet).not.toHaveProperty("lastError");
    }
  });

  it("Gravity's fabricated staged-degraded demo error specifically never reaches a production row", () => {
    const gravity = SOURCES.find((s) => s.id === "src-gravity")!;
    expect(gravity.lastError).toContain("0 events parsed"); // sanity: the fixture really is staged
    const { insertRow, updateSet } = toProductionSourceRow(gravity);
    expect(insertRow.lastError).toBeNull();
    expect(updateSet).not.toHaveProperty("lastError");
  });
});
