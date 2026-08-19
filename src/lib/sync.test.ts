import { describe, expect, it } from "vitest";
import {
  buildDiscoveryQueueClassificationPatch,
  buildSyncPatch,
  decideSyncLeaseAcquisition,
  findPendingRowToResolve,
  findSyncMatch,
  summarizeWriteErrors,
  type DiscoveryQueueTarget,
  type SyncTargetEvent,
} from "./sync";
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

describe("findPendingRowToResolve", () => {
  // Regression coverage: Culture Box publishing diagnosis, orphaned
  // discovery_queue rows fix. A candidate that reaches auto_publish on a
  // later sync than the one that first queued it (e.g. Culture Box's own
  // detail-page evidence arriving after an earlier listing-only sync) must
  // have its earlier pending row resolved, not left behind as a stale
  // "needs review" duplicate of an already-published event.

  it("finds the pending row keyed to exactly this candidate's dedupKey", () => {
    const pendingByUrl = new Map([
      ["https://culture-box.com/event/fri-28-august/#black-box", { id: "dq-target" }],
    ]);
    expect(findPendingRowToResolve("https://culture-box.com/event/fri-28-august/#black-box", pendingByUrl)).toBe(
      "dq-target",
    );
  });

  it("returns null when no pending row exists for this dedupKey — nothing to resolve, nothing touched", () => {
    const pendingByUrl = new Map([["https://culture-box.com/event/fri-28-august/#black-box", { id: "dq-target" }]]);
    expect(findPendingRowToResolve("https://culture-box.com/event/sat-22-august-2026/#black-box", pendingByUrl)).toBeNull();
  });

  it("never returns an unrelated candidate's row — only an exact dedupKey match, even when many rows are pending", () => {
    const pendingByUrl = new Map([
      ["https://culture-box.com/event/fri-28-august/#black-box", { id: "dq-black-box" }],
      ["https://culture-box.com/event/fri-28-august/#red-box", { id: "dq-red-box" }],
      ["https://culture-box.com/event/sat-22-august-2026/#black-box", { id: "dq-other-night" }],
    ]);
    expect(findPendingRowToResolve("https://culture-box.com/event/fri-28-august/#red-box", pendingByUrl)).toBe(
      "dq-red-box",
    );
  });

  it("empty pending map -> null", () => {
    expect(findPendingRowToResolve("https://culture-box.com/event/fri-28-august/#black-box", new Map())).toBeNull();
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

function pendingDiscoveryTarget(overrides: Partial<DiscoveryQueueTarget> = {}): DiscoveryQueueTarget {
  return {
    status: "pending",
    predictedGenre: null,
    overriddenFields: [],
    overallConfidence: "low",
    ...overrides,
  };
}

describe("buildDiscoveryQueueClassificationPatch", () => {
  // Real production cases (verified against the live Preview database): both
  // rows sat unresolved (predicted_genre: null) across a prior sync because
  // src/db/sync.ts used to just `continue` on an already-pending duplicate,
  // discarding a freshly-resolved genre instead of ever persisting it.

  it("Sunday Psy: an existing pending item receives a newly-available predicted genre (deterministic 'psy' mapping)", () => {
    // Was queued with no genre evidence at all (predictedGenre null,
    // overallConfidence "low" — a "hold" outcome). A later sync resolves a
    // medium-confidence genre, so the decision is now "review_queue": both
    // genreConfidence AND overallConfidence move together.
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "psytrance", genreConfidence: "medium", decision: "review_queue" },
      pendingDiscoveryTarget({ predictedGenre: null, overallConfidence: "low" }),
    );
    expect(patch).toEqual({ predictedGenre: "psytrance", genreConfidence: "medium", overallConfidence: "medium" });
  });

  it("Oliver Koletzki: an existing pending item receives a newly-available predicted genre (Discogs enrichment)", () => {
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "tech-house", genreConfidence: "medium", decision: "review_queue" },
      pendingDiscoveryTarget({ predictedGenre: null, overallConfidence: "low" }),
    );
    expect(patch).toEqual({ predictedGenre: "tech-house", genreConfidence: "medium", overallConfidence: "medium" });
  });

  it("second identical sync is idempotent — no patch when the fresh genre already matches what's stored", () => {
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "psytrance", genreConfidence: "medium", decision: "review_queue" },
      pendingDiscoveryTarget({ predictedGenre: "psytrance", overallConfidence: "medium" }),
    );
    expect(patch).toEqual({});
  });

  it("a transient lookup failure (fresh genre unresolved) never clears a previously-resolved genre", () => {
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: null, genreConfidence: "low", decision: "hold" },
      pendingDiscoveryTarget({ predictedGenre: "psytrance", overallConfidence: "medium" }),
    );
    expect(patch).toEqual({});
  });

  it("never overwrites an admin's manual predictedGenre correction", () => {
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "tech-house", genreConfidence: "medium", decision: "review_queue" },
      pendingDiscoveryTarget({ predictedGenre: "house", overriddenFields: ["predictedGenre"], overallConfidence: "low" }),
    );
    expect(patch).toEqual({});
  });

  it("a manual edit to an unrelated field (e.g. probableTitle) does not block a genre refresh", () => {
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "tech-house", genreConfidence: "medium", decision: "review_queue" },
      pendingDiscoveryTarget({ predictedGenre: null, overriddenFields: ["probableTitle"], overallConfidence: "low" }),
    );
    expect(patch).toEqual({ predictedGenre: "tech-house", genreConfidence: "medium", overallConfidence: "medium" });
  });

  it("never proposes a status change — the patch shape can only ever contain classification fields, so a medium-confidence suggestion keeps the item in review", () => {
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "psytrance", genreConfidence: "medium", decision: "review_queue" },
      pendingDiscoveryTarget({ predictedGenre: null, overallConfidence: "low" }),
    );
    expect(Object.keys(patch).sort()).toEqual(["genreConfidence", "overallConfidence", "predictedGenre"]);
    expect(patch).not.toHaveProperty("status");
  });

  it("published rows are unaffected — a non-pending item never receives a patch even with a differing fresh genre", () => {
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "tech-house", genreConfidence: "medium", decision: "review_queue" },
      pendingDiscoveryTarget({ status: "published", predictedGenre: null }),
    );
    expect(patch).toEqual({});
  });

  it("ignored and merged rows are equally frozen", () => {
    expect(
      buildDiscoveryQueueClassificationPatch(
        { genre: "tech-house", genreConfidence: "medium", decision: "review_queue" },
        pendingDiscoveryTarget({ status: "ignored" }),
      ),
    ).toEqual({});
    expect(
      buildDiscoveryQueueClassificationPatch(
        { genre: "tech-house", genreConfidence: "medium", decision: "review_queue" },
        pendingDiscoveryTarget({ status: "merged" }),
      ),
    ).toEqual({});
  });

  // ---- Regression coverage: Culture Box publishing diagnosis, Phase 2 Part A ----
  // Live Production bug: 6 src-culture-box discovery_queue rows had
  // genre_confidence "medium" (correctly resolved by a later Discogs pass)
  // sitting next to overall_confidence still stuck at "low" (from the
  // original insert, when genre was still unresolved). E.g. "Red Box: WHAT
  // HAPPENS" (2026-09-19): predictedGenre resolved to "electronic-other" at
  // medium confidence, but overallConfidence never moved off "low".

  it("bug repro: a stale 'low' overallConfidence recovers to 'medium' when a later sync resolves genre at medium confidence (Culture Box 'Red Box: WHAT HAPPENS' case)", () => {
    const staleRow = pendingDiscoveryTarget({ predictedGenre: null, overallConfidence: "low" });
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "electronic-other", genreConfidence: "medium", decision: "review_queue" },
      staleRow,
    );
    expect(patch).toEqual({
      predictedGenre: "electronic-other",
      genreConfidence: "medium",
      overallConfidence: "medium",
    });
  });

  it("bug repro: still recovers when the row already had SOME genre guess (not just null) but the wrong overallConfidence", () => {
    // Guards against a narrower fix that only checked `predictedGenre === null`
    // instead of comparing overallConfidence directly.
    const staleRow = pendingDiscoveryTarget({ predictedGenre: "house", overallConfidence: "low" });
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "tech-house", genreConfidence: "medium", decision: "review_queue" },
      staleRow,
    );
    expect(patch.overallConfidence).toBe("medium");
  });

  it("existing correct rows remain unchanged: overallConfidence is omitted from the patch when it already matches the fresh decision", () => {
    // The row was already correctly "medium" (review_queue) from a prior
    // sync; this sync just swaps which medium-confidence genre applies.
    // Only the genre fields should move — overallConfidence must NOT appear
    // in the patch (it's already right, so no write is proposed for it).
    const alreadyCorrectRow = pendingDiscoveryTarget({ predictedGenre: "techno", overallConfidence: "medium" });
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "tech-house", genreConfidence: "medium", decision: "review_queue" },
      alreadyCorrectRow,
    );
    expect(patch).toEqual({ predictedGenre: "tech-house", genreConfidence: "medium" });
    expect(patch).not.toHaveProperty("overallConfidence");
  });

  it("existing correct rows remain unchanged: a 'hold' row with an already-correct 'low' overallConfidence gets no overallConfidence write even as its (still low-confidence) genre guess changes", () => {
    const alreadyCorrectRow = pendingDiscoveryTarget({ predictedGenre: "house", overallConfidence: "low" });
    // Note: genreConfidence "low" candidates never reach this function with a
    // non-null genre in production (see pipeline.ts), but the pure function
    // itself must still behave correctly if it did.
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "techno", genreConfidence: "low", decision: "hold" },
      alreadyCorrectRow,
    );
    expect(patch).toEqual({ predictedGenre: "techno", genreConfidence: "low" });
    expect(patch).not.toHaveProperty("overallConfidence");
  });

  it("no candidate can move to auto_publish solely because of this fix — the patch never contains a status field, and overallConfidence has no 'high' branch to fall into", () => {
    // In real usage `fresh.decision` is always "review_queue" or "hold" (an
    // "auto_publish" candidate is created as an event directly by a different
    // code path in src/db/sync.ts and never reaches this function at all —
    // see this function's own doc comment). Even if a caller mistakenly
    // passed "auto_publish" here, the recompute rule
    // (`decision === "review_queue" ? "medium" : "low"`) has only two
    // possible outputs — there is no code path that can ever produce "high",
    // and the returned patch shape can never include a status/published key.
    const row = pendingDiscoveryTarget({ predictedGenre: null, overallConfidence: "low" });
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "techno", genreConfidence: "high", decision: "auto_publish" },
      row,
    );
    expect(patch.overallConfidence).not.toBe("high");
    expect(["low", "medium", undefined]).toContain(patch.overallConfidence);
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("published");
    expect(Object.keys(patch).every((k) => ["predictedGenre", "genreConfidence", "overallConfidence"].includes(k))).toBe(true);
  });

  // ---- Regression coverage: closing the remaining stale overallConfidence
  // gap (Culture Box publishing diagnosis, follow-up fix). Part A only
  // recomputed overallConfidence as a side effect of predictedGenre also
  // changing on that same sync — a row whose genre was already correct
  // BEFORE Part A shipped (so genre never changes again on a later sync)
  // stayed stuck at its stale overallConfidence forever. These 4 real live
  // Culture Box rows (e.g. "Red Box: WHAT HAPPENS") had exactly this shape:
  // genre_confidence "medium", overall_confidence stuck at "low".

  it("recovers a stale overallConfidence on a plain re-sync even when predictedGenre is UNCHANGED", () => {
    const staleRow = pendingDiscoveryTarget({ predictedGenre: "electronic-other", overallConfidence: "low" });
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "electronic-other", genreConfidence: "medium", decision: "review_queue" },
      staleRow,
    );
    expect(patch).toEqual({ overallConfidence: "medium" });
    expect(patch).not.toHaveProperty("predictedGenre");
    expect(patch).not.toHaveProperty("genreConfidence");
  });

  it("does not change genre when only overallConfidence needed correcting — genre patch logic is untouched", () => {
    // Same scenario as above, phrased the other way: the genre-patch
    // condition (`fresh.genre !== existing.predictedGenre`) is false here,
    // so predictedGenre/genreConfidence must never appear in the patch,
    // regardless of what overallConfidence does.
    const staleRow = pendingDiscoveryTarget({ predictedGenre: "techno", overallConfidence: "low" });
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "techno", genreConfidence: "medium", decision: "review_queue" },
      staleRow,
    );
    expect(Object.keys(patch)).toEqual(["overallConfidence"]);
  });

  it("a transient lookup failure this run still freezes the ENTIRE row, overallConfidence included — not just predictedGenre", () => {
    // Guards the exact regression this fix could have introduced: without
    // the `!fresh.genre` short-circuit staying a full early return, a
    // failed lookup (fresh.genre null) would compute freshOverallConfidence
    // from decision "hold" -> "low" and silently downgrade an
    // already-correct medium/medium row on a transient blip.
    const healthyRow = pendingDiscoveryTarget({ predictedGenre: "techno", overallConfidence: "medium" });
    const patch = buildDiscoveryQueueClassificationPatch({ genre: null, genreConfidence: "low", decision: "hold" }, healthyRow);
    expect(patch).toEqual({});
  });

  it("still a no-op when both predictedGenre and overallConfidence already correctly match — fully idempotent", () => {
    const correctRow = pendingDiscoveryTarget({ predictedGenre: "techno", overallConfidence: "medium" });
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "techno", genreConfidence: "medium", decision: "review_queue" },
      correctRow,
    );
    expect(patch).toEqual({});
  });

  it("an admin's manual predictedGenre override still freezes overallConfidence too — the override guard applies to the whole row, not just the genre fields", () => {
    const overriddenRow = pendingDiscoveryTarget({
      predictedGenre: "house",
      overriddenFields: ["predictedGenre"],
      overallConfidence: "low",
    });
    const patch = buildDiscoveryQueueClassificationPatch(
      { genre: "techno", genreConfidence: "medium", decision: "review_queue" },
      overriddenRow,
    );
    expect(patch).toEqual({});
  });
});

describe("summarizeWriteErrors", () => {
  it("is ok with no error message when nothing failed", () => {
    expect(summarizeWriteErrors([], 9)).toEqual({ outcome: "ok", lastErrorMessage: null });
  });

  it("degrades to partial_failure and surfaces a count + detail when any candidate failed to write", () => {
    const result = summarizeWriteErrors(["Kander: duplicate key value violates unique constraint"], 9);
    expect(result.outcome).toBe("partial_failure");
    expect(result.lastErrorMessage).toContain("1/9");
    expect(result.lastErrorMessage).toContain("duplicate key value violates unique constraint");
  });

  it("reports the full failure count against the total candidates found, not just the failed ones", () => {
    const result = summarizeWriteErrors(["A: boom", "B: boom"], 9);
    expect(result.lastErrorMessage).toContain("2/9");
  });
});

describe("decideSyncLeaseAcquisition", () => {
  const now = new Date("2026-08-19T12:00:00Z");

  it("grants when no lease row exists for this source", () => {
    expect(decideSyncLeaseAcquisition(null, now)).toBe(true);
  });

  it("denies when an existing lease has not yet expired", () => {
    const stillValid = { lockToken: "held-by-someone-else", expiresAt: new Date("2026-08-19T12:04:59Z") };
    expect(decideSyncLeaseAcquisition(stillValid, now)).toBe(false);
  });

  it("grants once an existing lease's expiry has passed — the mechanism that guarantees no permanent lock survives a crashed sync", () => {
    const expired = { lockToken: "abandoned-by-a-crashed-request", expiresAt: new Date("2026-08-19T11:59:00Z") };
    expect(decideSyncLeaseAcquisition(expired, now)).toBe(true);
  });

  it("grants exactly at the expiry instant (matches the real SQL's <= boundary)", () => {
    const expiringNow = { lockToken: "expiring-right-now", expiresAt: now };
    expect(decideSyncLeaseAcquisition(expiringNow, now)).toBe(true);
  });
});
