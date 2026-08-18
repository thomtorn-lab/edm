import { describe, expect, it } from "vitest";
import { deterministicGenreFromText } from "./deterministicGenreMapping";

describe("deterministicGenreFromText", () => {
  it("maps the standalone word 'psy' to psytrance", () => {
    expect(deterministicGenreFromText("Sunday Psy: Agata, Neri J, Matriark")).toBe("psytrance");
  });

  it("matches 'psy' case-insensitively", () => {
    expect(deterministicGenreFromText("PSY night")).toBe("psytrance");
    expect(deterministicGenreFromText("psy night")).toBe("psytrance");
    expect(deterministicGenreFromText("PsY night")).toBe("psytrance");
  });

  it("still matches the full word 'psytrance' directly", () => {
    expect(deterministicGenreFromText("A night of psytrance")).toBe("psytrance");
  });

  it("does not false-positive on unrelated words containing 'psy'", () => {
    expect(deterministicGenreFromText("A talk on psychology and psychedelic art")).toBeNull();
    expect(deterministicGenreFromText("Psycho Killer live")).toBeNull();
  });

  it("returns null when no keyword matches at all", () => {
    expect(deterministicGenreFromText("Gerd Janson, Harrison Heat, NAT")).toBeNull();
  });

  describe("ambient / experimental evidence quality", () => {
    it("matches bare 'ambient' unconditionally — a specific, low-ambiguity genre word", () => {
      expect(deterministicGenreFromText("An evening of ambient soundscapes")).toBe("ambient-experimental");
    });

    it("does NOT match a generic, non-electronic use of 'experimental' with no electronic-music context nearby (the real Ca7riel y Paco Amoroso bio text)", () => {
      expect(
        deterministicGenreFromText(
          "CA7RIEL & Paco Amoroso expand their already unpredictable blend of trap, rock, pop and experimental elements into something bigger, sharper and more emotionally open without losing the humour, volatility and musicianship that have made them one of Latin America's most talked-about acts.",
        ),
      ).toBeNull();
    });

    it("does not match other generic non-musical uses of 'experimental' either", () => {
      expect(deterministicGenreFromText("An experimental theatre piece exploring memory and language")).toBeNull();
      expect(deterministicGenreFromText("A night of experimental comedy and spoken word")).toBeNull();
    });

    it("matches 'experimental' when it appears together with 'electronic' in the same text", () => {
      expect(deterministicGenreFromText("A night of experimental electronic music and visuals")).toBe("ambient-experimental");
      expect(deterministicGenreFromText("Electronic, ambient and experimental soundscapes")).toBe("ambient-experimental");
    });

    it("matches 'experimental' near 'electronica' too", () => {
      expect(deterministicGenreFromText("Forward-leaning experimental electronica from Berlin")).toBe("ambient-experimental");
    });

    it("does not let a distant, unrelated 'electronic' elsewhere in a long bio manufacture a match", () => {
      // "electronic" and "experimental" both present, but far apart and describing unrelated things.
      const longUnrelatedText =
        "Doors open at 19:00, please bring a valid electronic ticket for entry. ".padEnd(200, "x") +
        " Paco Amoroso's new album blends trap, rock and experimental pop influences.";
      expect(deterministicGenreFromText(longUnrelatedText)).toBeNull();
    });
  });
});
