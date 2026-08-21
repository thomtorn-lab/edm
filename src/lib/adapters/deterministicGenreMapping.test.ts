import { describe, expect, it } from "vitest";
import { deterministicGenreFromText, refineGenreFromText } from "./deterministicGenreMapping";

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

describe("refineGenreFromText (genre precision, Workstream B)", () => {
  it("distinguishes Trance vs Psytrance: refines a generic 'trance' category to psytrance when the event's own text says so (Infected Mushroom-type evidence)", () => {
    expect(refineGenreFromText("trance", "Infected Mushroom brings their legendary psytrance sound to Copenhagen.")).toBe(
      "psytrance",
    );
    expect(refineGenreFromText("trance", "A night of psy vibes and visuals.")).toBe("psytrance");
  });

  it("leaves a genuine trance event as trance when the text has no psytrance-specific evidence", () => {
    expect(refineGenreFromText("trance", "A night of uplifting trance anthems.")).toBe("trance");
  });

  it("refines a generic 'techno' category to a specific sibling when the text names one (e.g. industrial techno -> industrial)", () => {
    expect(refineGenreFromText("techno", "An industrial techno showcase.")).toBe("industrial");
    expect(refineGenreFromText("techno", "Melodic techno all night long.")).toBe("melodic-techno");
  });

  it("refines a generic 'house' category to a specific sibling when the text names one", () => {
    expect(refineGenreFromText("house", "Progressive house from local selectors.")).toBe("progressive-house");
    expect(refineGenreFromText("house", "Deep house grooves until sunrise.")).toBe("deep-house");
  });

  it("never crosses into an unrelated genre family", () => {
    expect(refineGenreFromText("house", "A night of psytrance.")).toBe("house");
  });

  it("is a no-op for a genre with no declared refinement siblings", () => {
    expect(refineGenreFromText("disco", "Industrial techno night.")).toBe("disco");
    expect(refineGenreFromText("psytrance", "A generic trance description.")).toBe("psytrance");
  });
});
