import { describe, expect, it } from "vitest";
import { mapDiscogsEvidenceToGenre } from "./discogsGenreMapping";

describe("mapDiscogsEvidenceToGenre", () => {
  it("resolves a single, unambiguous style match", () => {
    const result = mapDiscogsEvidenceToGenre([{ genres: ["Electronic"], styles: ["Tech House"] }]);
    expect(result.genre).toBe("tech-house");
    expect(result.confirmedElectronic).toBe(true);
    expect(result.conflicting).toBe(false);
    expect(result.matchedStyles).toEqual(["Tech House"]);
  });

  it("agrees across multiple releases naming the same style", () => {
    const result = mapDiscogsEvidenceToGenre([
      { genres: ["Electronic"], styles: ["Deep House"] },
      { genres: ["Electronic"], styles: ["Deep House"] },
    ]);
    expect(result.genre).toBe("deep-house");
    expect(result.conflicting).toBe(false);
  });

  it("does not force a single genre when releases disagree — multi-genre evidence stays unresolved", () => {
    const result = mapDiscogsEvidenceToGenre([
      { genres: ["Electronic"], styles: ["Trance"] },
      { genres: ["Electronic"], styles: ["Techno"] },
    ]);
    expect(result.genre).toBeNull();
    expect(result.conflicting).toBe(true);
  });

  it("maps to electronic-other only when Electronic is confirmed but no specific style matches", () => {
    const result = mapDiscogsEvidenceToGenre([{ genres: ["Electronic"], styles: ["Downtempo"] }]);
    expect(result.genre).toBe("electronic-other");
    expect(result.confirmedElectronic).toBe(true);
  });

  it("does not guess electronic-other for a non-electronic artist", () => {
    const result = mapDiscogsEvidenceToGenre([{ genres: ["Rock"], styles: ["Indie Rock"] }]);
    expect(result.genre).toBeNull();
    expect(result.confirmedElectronic).toBe(false);
  });

  it("handles no release evidence at all", () => {
    const result = mapDiscogsEvidenceToGenre([]);
    expect(result.genre).toBeNull();
    expect(result.confirmedElectronic).toBe(false);
  });

  it("is case- and hyphenation-insensitive for known styles", () => {
    expect(mapDiscogsEvidenceToGenre([{ genres: ["Electronic"], styles: ["psy-trance"] }]).genre).toBe("psytrance");
    expect(mapDiscogsEvidenceToGenre([{ genres: ["Electronic"], styles: ["PSYTRANCE"] }]).genre).toBe("psytrance");
    expect(mapDiscogsEvidenceToGenre([{ genres: ["Electronic"], styles: ["Drum n Bass"] }]).genre).toBe("drum-and-bass");
  });

  it("does not fold 'Hard House' into 'house' — falls through to electronic-other, consistent with hard-techno staying separate from techno", () => {
    // Real production evidence: Kyle Starkey, "Electronic / Hard House".
    const result = mapDiscogsEvidenceToGenre([{ genres: ["Electronic"], styles: ["Hard House"] }]);
    expect(result.genre).toBe("electronic-other");
    expect(result.matchedStyles).toEqual([]);
    expect(result.confirmedElectronic).toBe(true);
  });
});
