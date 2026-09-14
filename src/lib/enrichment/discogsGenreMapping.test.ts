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

  describe("Dubstep/Hardstyle/Rawstyle/Hardcore automation (genre taxonomy audit follow-up, 2026-09-14)", () => {
    it("maps the 'Dubstep' style", () => {
      expect(mapDiscogsEvidenceToGenre([{ genres: ["Electronic"], styles: ["Dubstep"] }]).genre).toBe("dubstep");
    });

    it("maps the 'Hardstyle' style", () => {
      expect(mapDiscogsEvidenceToGenre([{ genres: ["Electronic"], styles: ["Hardstyle"] }]).genre).toBe("hardstyle");
    });

    it("maps the bare 'Hardcore' style to hardcore (Discogs' Electronic-genre gabber/uptempo lineage style, distinct from 'Hardcore Punk')", () => {
      expect(mapDiscogsEvidenceToGenre([{ genres: ["Electronic"], styles: ["Hardcore"] }]).genre).toBe("hardcore");
    });

    it("maps 'Gabber' and 'Frenchcore' to hardcore", () => {
      expect(mapDiscogsEvidenceToGenre([{ genres: ["Electronic"], styles: ["Gabber"] }]).genre).toBe("hardcore");
      expect(mapDiscogsEvidenceToGenre([{ genres: ["Electronic"], styles: ["Frenchcore"] }]).genre).toBe("hardcore");
    });

    it("does NOT map 'Hardcore Punk' to hardcore — exact normalized matching keeps it a distinct, unmapped token (real Billetto false-positive precedent, see billettoAdapter.ts)", () => {
      const result = mapDiscogsEvidenceToGenre([{ genres: ["Rock"], styles: ["Hardcore Punk"] }]);
      expect(result.genre).toBeNull();
      expect(result.matchedStyles).toEqual([]);
    });

    it("does NOT guess a 'Rawstyle' mapping — no distinct Discogs style token is confirmed, so it falls through to electronic-other rather than being invented", () => {
      const result = mapDiscogsEvidenceToGenre([{ genres: ["Electronic"], styles: ["Rawstyle"] }]);
      expect(result.genre).toBe("electronic-other");
      expect(result.matchedStyles).toEqual([]);
      expect(result.confirmedElectronic).toBe(true);
    });

    it("does NOT guess 'Uptempo Hardcore' / 'Industrial Hardcore' as distinct Discogs style tokens — left unmapped here, reachable only via the deterministic text path", () => {
      expect(mapDiscogsEvidenceToGenre([{ genres: ["Electronic"], styles: ["Uptempo Hardcore"] }]).matchedStyles).toEqual([]);
      expect(mapDiscogsEvidenceToGenre([{ genres: ["Electronic"], styles: ["Industrial Hardcore"] }]).matchedStyles).toEqual([]);
    });
  });
});
