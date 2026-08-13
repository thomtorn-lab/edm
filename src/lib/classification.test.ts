import { describe, expect, it } from "vitest";
import { evaluateQualityGate, genreConfidenceForEvidence, resolveByCanonicalPriority } from "./classification";

describe("evaluateQualityGate", () => {
  const base = {
    hasTitle: true,
    hasDate: true,
    hasVenue: true,
    hasSourceUrl: true,
    hasCredibleElectronicRelevance: true,
    genreConfidence: "high" as const,
  };

  it("auto-publishes a complete, high-confidence record", () => {
    expect(evaluateQualityGate(base)).toBe("auto_publish");
  });

  it("sends a medium-confidence record to the review queue", () => {
    expect(evaluateQualityGate({ ...base, genreConfidence: "medium" })).toBe("review_queue");
  });

  it("holds a low-confidence record instead of auto-publishing", () => {
    expect(evaluateQualityGate({ ...base, genreConfidence: "low" })).toBe("hold");
  });

  it("holds when a mandatory field is missing even with high genre confidence", () => {
    expect(evaluateQualityGate({ ...base, hasVenue: false })).toBe("hold");
    expect(evaluateQualityGate({ ...base, hasTitle: false })).toBe("hold");
    expect(evaluateQualityGate({ ...base, hasDate: false })).toBe("hold");
    expect(evaluateQualityGate({ ...base, hasSourceUrl: false })).toBe("hold");
  });

  it("holds when electronic relevance is not credible regardless of other fields", () => {
    expect(evaluateQualityGate({ ...base, hasCredibleElectronicRelevance: false })).toBe("hold");
  });

  it("does not require price, image, end time or description", () => {
    // These fields simply aren't part of the gate input at all — the gate
    // input intentionally has no hasPrice/hasImage/hasEndTime/hasDescription flags.
    expect(evaluateQualityGate(base)).toBe("auto_publish");
  });
});

describe("genreConfidenceForEvidence", () => {
  it("ranks evidence tiers as high/medium/low per the spec's evidence order", () => {
    expect(genreConfidenceForEvidence("official-source-metadata")).toBe("high");
    expect(genreConfidenceForEvidence("official-description")).toBe("high");
    expect(genreConfidenceForEvidence("venue-promoter-metadata")).toBe("medium");
    expect(genreConfidenceForEvidence("artist-lineup-metadata")).toBe("medium");
    expect(genreConfidenceForEvidence("deterministic-mapping")).toBe("medium");
    expect(genreConfidenceForEvidence("ai-assisted")).toBe("low");
    expect(genreConfidenceForEvidence("manual-review")).toBe("low");
  });
});

describe("resolveByCanonicalPriority", () => {
  it("prefers the official promoter over venue, ticketing and aggregators", () => {
    const result = resolveByCanonicalPriority([
      { sourceType: "general-aggregator", value: "20:00" },
      { sourceType: "official-venue", value: "23:00" },
      { sourceType: "official-promoter", value: "23:30" },
      { sourceType: "ticketing", value: "23:00" },
    ]);
    expect(result?.value).toBe("23:30");
  });

  it("never lets a social source outrank an official venue value", () => {
    const result = resolveByCanonicalPriority([
      { sourceType: "social", value: "cancelled-rumor" },
      { sourceType: "official-venue", value: "confirmed" },
    ]);
    expect(result?.value).toBe("confirmed");
  });

  it("returns null for an empty candidate list", () => {
    expect(resolveByCanonicalPriority([])).toBeNull();
  });
});
