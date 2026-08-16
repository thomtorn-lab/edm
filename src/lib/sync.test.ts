import { describe, expect, it } from "vitest";
import { buildSyncPatch, findSyncMatch, type SyncTargetEvent } from "./sync";
import { stripOverriddenFields } from "./override";
import type { RawCandidateEvent } from "./adapters/types";

function raw(overrides: Partial<RawCandidateEvent> = {}): RawCandidateEvent {
  return {
    sourceId: "src-hangaren",
    sourceUrl: "https://www.hangaren.dk/events",
    title: "Kander",
    description: "Hard Bounce, Schranz and Techno.",
    artists: ["Kander"],
    startDatetime: "2026-08-15T18:00:00.000Z",
    endDatetime: "2026-08-16T04:00:00.000Z",
    venueName: "Hangaren",
    officialEventUrl: "https://www.hangaren.dk/events/20268/0815/kander",
    ticketUrl: "https://ra.co/events/2461529",
    facebookUrl: null,
    residentAdvisorUrl: "https://ra.co/events/2461529",
    imageUrl: "https://images.squarespace-cdn.com/kander.png",
    priceFrom: null,
    genreHint: null,
    genreConfidenceHint: null,
    ...overrides,
  };
}

function target(overrides: Partial<SyncTargetEvent> = {}): SyncTargetEvent {
  return {
    id: "e-kander",
    title: "Kander",
    description: "Hard Bounce, Schranz and Techno.",
    artists: ["Kander"],
    venueId: "v-hangaren",
    startDatetime: "2026-08-15T18:00:00.000Z",
    endDatetime: "2026-08-16T04:00:00.000Z",
    officialEventUrl: "https://www.hangaren.dk/events/20268/0815/kander",
    ticketUrl: "https://ra.co/events/2461529",
    facebookUrl: null,
    residentAdvisorUrl: "https://ra.co/events/2461529",
    imageUrl: "https://images.squarespace-cdn.com/kander.png",
    primaryGenre: "techno",
    overriddenFields: [],
    ...overrides,
  };
}

const resolved = { resolvedVenueId: "v-hangaren", normalizedArtists: ["Kander"], genre: "techno" as const, genreConfidence: "medium" as const };

describe("findSyncMatch", () => {
  it("prefers a direct provenance link over a fuzzy duplicate", () => {
    const m = findSyncMatch("e-linked", "e-fuzzy", "high");
    expect(m).toEqual({ kind: "linked", eventId: "e-linked" });
  });

  it("falls back to a high-confidence duplicate when there's no direct link", () => {
    const m = findSyncMatch(null, "e-fuzzy", "high");
    expect(m).toEqual({ kind: "high-confidence-duplicate", eventId: "e-fuzzy" });
  });

  it("does not auto-attach a medium or low confidence duplicate — leaves it for review", () => {
    expect(findSyncMatch(null, "e-fuzzy", "medium")).toBeNull();
    expect(findSyncMatch(null, "e-fuzzy", "low")).toBeNull();
  });

  it("returns null when nothing matches at all", () => {
    expect(findSyncMatch(null, null, "none")).toBeNull();
  });
});

describe("buildSyncPatch", () => {
  it("produces an empty patch when nothing actually changed (a routine no-op re-sync)", () => {
    const { patch, dateChanged, timeChanged } = buildSyncPatch(raw(), resolved, target());
    expect(patch).toEqual({});
    expect(dateChanged).toBe(false);
    expect(timeChanged).toBe(false);
  });

  it("flags a full date change (moved to a different calendar day)", () => {
    const moved = raw({ startDatetime: "2026-08-22T18:00:00.000Z", endDatetime: "2026-08-23T04:00:00.000Z" });
    const { patch, dateChanged, timeChanged } = buildSyncPatch(moved, resolved, target());
    expect(patch.startDatetime).toEqual(new Date("2026-08-22T18:00:00.000Z"));
    expect(patch.dateChanged).toBe(true);
    expect(dateChanged).toBe(true);
    expect(timeChanged).toBe(false);
  });

  it("flags a time-only change (same night, different door time)", () => {
    const laterDoors = raw({ startDatetime: "2026-08-15T20:00:00.000Z" }); // same date, +2h
    const { patch, dateChanged, timeChanged } = buildSyncPatch(laterDoors, resolved, target());
    expect(patch.timeChanged).toBe(true);
    expect(dateChanged).toBe(false);
    expect(timeChanged).toBe(true);
  });

  it("detects a lineup change", () => {
    const newLineup = { ...resolved, normalizedArtists: ["Kander", "Guest DJ"] };
    const { patch } = buildSyncPatch(raw(), newLineup, target());
    expect(patch.artists).toEqual(["Kander", "Guest DJ"]);
  });

  it("never proposes overridden fields — the caller (applySourceSyncPatch) strips them, but the patch itself still reflects the source's current value", () => {
    // buildSyncPatch itself is override-agnostic by design: stripping happens
    // one layer down (src/lib/override.ts) so this stays a pure "what does
    // the source say now" function, independent of admin edit history.
    const renamed = raw({ title: "Kander (rescheduled)" });
    const { patch } = buildSyncPatch(renamed, resolved, target({ overriddenFields: ["title"] }));
    expect(patch.title).toBe("Kander (rescheduled)");
  });

  it("does not null out a known end time when the source omits it on this pass", () => {
    const noEnd = raw({ endDatetime: null });
    const { patch } = buildSyncPatch(noEnd, resolved, target());
    expect(patch.endDatetime).toBeUndefined();
  });

  it("a manually-corrected genre survives a sync even when Discogs enrichment proposes a different one", () => {
    // Simulates: admin previously hand-set primaryGenre (overriddenFields
    // includes "primaryGenre"/"subgenres"), then a later sync's genre
    // enrichment (src/db/enrichment.ts) resolves a DIFFERENT genre for this
    // same event's artist. buildSyncPatch itself is override-agnostic (see
    // the test above) — the actual protection is stripOverriddenFields,
    // exercised here exactly as applySourceSyncPatch (src/db/writes.ts)
    // calls it in production.
    const enrichmentResolved = { ...resolved, genre: "psytrance" as const, genreConfidence: "medium" as const };
    const existing = target({ primaryGenre: "techno", overriddenFields: ["primaryGenre", "subgenres"] });
    const { patch } = buildSyncPatch(raw(), enrichmentResolved, existing);
    expect(patch.primaryGenre).toBe("psytrance"); // buildSyncPatch still proposes it...

    const safePatch = stripOverriddenFields(patch, existing.overriddenFields);
    expect(safePatch.primaryGenre).toBeUndefined(); // ...but the admin's choice is never actually written
    expect(safePatch.subgenres).toBeUndefined();
  });
});
