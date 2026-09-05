import { describe, expect, it } from "vitest";
import { deterministicGenreFromText, hasRichGenreEvidence, refineGenreFromText } from "./deterministicGenreMapping";

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

  it("matches compound forms with no space (QA audit, 2026-08-29: the real ETNICA 30 Years event text)", () => {
    expect(deterministicGenreFromText("Copenhagen's most authentic psytrancefest")).toBe("psytrance");
    expect(deterministicGenreFromText("reviving the electric atmosphere of the 90s/00s psytrancescene")).toBe("psytrance");
  });

  it("does not false-positive on unrelated words containing 'psy'", () => {
    expect(deterministicGenreFromText("A talk on psychology and psychedelic art")).toBeNull();
    expect(deterministicGenreFromText("Psycho Killer live")).toBeNull();
  });

  it("returns null when no keyword matches at all", () => {
    expect(deterministicGenreFromText("Gerd Janson, Harrison Heat, NAT")).toBeNull();
  });

  it("does not false-positive on 'trance-inducing'/'trance-like' as an adjective, not the genre (the real ALICE Aïta Mon Amour bio text)", () => {
    expect(
      deterministicGenreFromText(
        "On stage, Aïta Mon Amour unfolds a captivating universe where trance-inducing rhythms, poetry, and club energy merge into a concert experience.",
      ),
    ).toBeNull();
    expect(deterministicGenreFromText("A trance-like ritual of drums and chanting.")).toBeNull();
  });

  it("still matches bare 'trance' and 'trance music' unconditionally", () => {
    expect(deterministicGenreFromText("A night of uplifting trance anthems.")).toBe("trance");
    expect(deterministicGenreFromText("Live trance music all night.")).toBe("trance");
  });

  it("does not false-positive on 'a trance state' as a psychological/hypnotic state, not the genre (the real ALICE Laryssa Kim bio text)", () => {
    expect(
      deterministicGenreFromText(
        "Laryssa Kim crafts an immersive sound odyssey where the boundaries between song, sound art, and dream dissolve—a captivating trance state that awakens the senses.",
      ),
    ).toBeNull();
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

describe("gap 4A: influence/style qualifiers affect confidence, never whether a genre resolves at all (KultuNaut publish work package, 2026-09-05)", () => {
  it("still matches a direct 'house event' claim (positive control)", () => {
    expect(deterministicGenreFromText("Welcome to our house event, all night long")).toBe("house");
    expect(hasRichGenreEvidence("Welcome to our house event, all night long, straight to the dancefloor")).toBe(true);
  });

  it("'house-inspired pop' still resolves a genre (real regression guard: Demi Riquísimo's own Culture Box bio — 'acid, italo house inspired sonic palette' — is the artist's ONLY genre evidence and must not be discarded), but does not count as rich/direct evidence on its own", () => {
    expect(deterministicGenreFromText("A night of house-inspired pop from the local scene")).toBe("house");
    expect(hasRichGenreEvidence("A night of house-inspired pop from the local scene")).toBe(false);
    expect(hasRichGenreEvidence("his standout acid, italo house inspired sonic palette")).toBe(false);
  });

  it("'influenced by house' / 'inspiration from house' / 'elements of house' are not rich/direct evidence either", () => {
    expect(hasRichGenreEvidence("Her sound is influenced by house and disco")).toBe(false);
    expect(hasRichGenreEvidence("Drawing inspiration from house music of the 90s")).toBe(false);
    expect(hasRichGenreEvidence("A pop show with elements of house woven in")).toBe(false);
  });

  it("a direct genre elsewhere in the same text still counts as rich evidence even when an influence qualifier is also present", () => {
    expect(deterministicGenreFromText("House-inspired pop opens, followed by a full techno set on the dancefloor")).toBe("techno");
    expect(hasRichGenreEvidence("House-inspired pop opens, followed by a full techno set on the dancefloor")).toBe(true);
  });
});

describe("gap 4B: genre words inside a historical/eclectic style list affect confidence, never whether a genre resolves at all (KultuNaut publish work package, 2026-09-05)", () => {
  it("a genre named only inside a 'has moved between...' historical list still resolves (real Næb-type evidence) but is not rich/direct evidence of the current event", () => {
    const text = "Over the years the duo has moved between synthpop, krautrock, big beat, house, reggae and more.";
    expect(deterministicGenreFromText(text)).toBe("house");
    expect(hasRichGenreEvidence(text)).toBe(false);
  });

  it("a direct, present-tense genre assertion elsewhere in the same text still counts as rich evidence", () => {
    const text =
      "The duo has moved between synthpop, krautrock, big beat and reggae across their career. Tonight is a pure techno set on the dancefloor.";
    expect(deterministicGenreFromText(text)).toBe("techno");
    expect(hasRichGenreEvidence(text)).toBe(true);
  });
});

describe("gap 4E: format terms containing a genre word (KultuNaut publish work package, 2026-09-05)", () => {
  it("does not read 'silent disco' as the disco genre", () => {
    expect(deterministicGenreFromText("Join our silent disco on the rooftop, three channels of music")).toBeNull();
  });

  it("still detects a genuine disco event", () => {
    expect(deterministicGenreFromText("A night of classic disco and boogie")).toBe("disco");
  });
});

describe("hasRichGenreEvidence (gap 4D, KultuNaut publish work package, 2026-09-05)", () => {
  it("is false for a minimal, uncorroborated fragment (the real 'Live experimental electronics' KultuNaut evidence)", () => {
    expect(hasRichGenreEvidence("Live experimental electronics")).toBe(false);
  });

  it("is true for rich, explicit psytrance + dancefloor-context evidence", () => {
    expect(
      hasRichGenreEvidence("A full night of psytrance across two rooms, all killer no filler, straight to the dancefloor until sunrise."),
    ).toBe(true);
  });

  it("is true when two distinct genre families are both named, even without dance-context corroboration", () => {
    expect(hasRichGenreEvidence("A double bill spanning techno and drum and bass.")).toBe(true);
  });

  it("is false for a single bare specific-genre mention with no corroboration", () => {
    expect(hasRichGenreEvidence("A house track played once during the set.")).toBe(false);
  });

  it("is true for a single specific genre corroborated by explicit club/dancefloor language", () => {
    expect(hasRichGenreEvidence("Tech house all night on the dancefloor at our club night.")).toBe(true);
  });

  it("stays false for an Electro Werkz-type event with one crossover act named alongside otherwise-electronic evidence when that evidence is itself minimal", () => {
    // Regression guard: a single named act's rock crossover must not itself
    // manufacture richness — richness is about the EVENT's own genre/context
    // density, never about how many acts are named.
    expect(hasRichGenreEvidence("Electro night, one act.")).toBe(false);
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
