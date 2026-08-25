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

  it("a real registry-shaped source carrying a non-null staged/fabricated error never lets it reach a production row", () => {
    // Regression fixture for the "0 events parsed, needs adapter review"
    // staged-degraded case (spec section 43): src-gravity used to carry
    // exactly this fabricated lastError as a deliberately-staged demo
    // example, before being repaired into a real working adapter
    // (gravityAdapter.ts, 2026-08-25) with a genuinely clean lastError. The
    // stripping behavior this test guards still needs coverage against a
    // real registry-shaped object (not just the fully-synthetic fixture in
    // the first test above), so it's reproduced locally here instead of
    // depending on any one SOURCES entry staying in a staged state forever.
    const staged = sourceFixture({
      id: "src-gravity",
      sourceName: "Gravity Copenhagen",
      lastError: "0 events parsed from the last 3 attempts — likely page structure change, needs adapter review",
    });
    const { insertRow, updateSet } = toProductionSourceRow(staged);
    expect(insertRow.lastError).toBeNull();
    expect(updateSet).not.toHaveProperty("lastError");
  });
});
