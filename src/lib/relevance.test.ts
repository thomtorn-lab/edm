import { describe, expect, it } from "vitest";
import { assessRelevance, hasExplicitElectronicAssertion, hasNonElectronicGenreSignal } from "./relevance";

describe("hasNonElectronicGenreSignal (data-quality Workstream A)", () => {
  it("flags grime/rap copy (Dizzee Rascal-type evidence)", () => {
    expect(hasNonElectronicGenreSignal("Dizzee Rascal is a pioneering grime and hip hop MC.")).toBe(true);
    expect(hasNonElectronicGenreSignal("A legendary UK rapper returns to Copenhagen.")).toBe(true);
  });

  it("flags metal copy (MASTER BOOT RECORD + Fulci-type evidence)", () => {
    expect(hasNonElectronicGenreSignal("MASTER BOOT RECORD blends chiptune and industrial metal.")).toBe(true);
    expect(hasNonElectronicGenreSignal("Fulci is an Italian death metal band.")).toBe(true);
    expect(hasNonElectronicGenreSignal("A night of pure heavy metal riffs.")).toBe(true);
  });

  it("does not flag genuinely electronic copy, including 'industrial techno'", () => {
    expect(hasNonElectronicGenreSignal("A night of industrial techno at Poolen.")).toBe(false);
    expect(hasNonElectronicGenreSignal("Melodic techno and deep house all night.")).toBe(false);
    expect(hasNonElectronicGenreSignal("Psytrance vibes with Infected Mushroom.")).toBe(false);
  });

  it("does not false-positive on unrelated words", () => {
    expect(hasNonElectronicGenreSignal("Doors open at 8pm, drinks and vibes.")).toBe(false);
  });

  it("does not false-positive on a genuinely electronic artist's own bio describing musical influences/lineage (real production evidence: Hangaren)", () => {
    expect(
      hasNonElectronicGenreSignal(
        "Danilo Plessow (MCDE), Harrison heat, tamara A DJ's DJ, technically crafty, instinctually curious and armed with an expansive knowledge shaped by jazz, soul and disco roots.",
      ),
    ).toBe(false);
    expect(
      hasNonElectronicGenreSignal(
        "Mika Heggemann is pioneering Nu Trance, taking cues from breakbeat and rap culture the way Nu Metal once redefined rock.",
      ),
    ).toBe(false);
    expect(
      hasNonElectronicGenreSignal(
        "never leave's lyd flyder et sted mellem techno, trance og UK garage. Søren Gades vokal spænder over kraftfuld sang, blid croon og rap.",
      ),
    ).toBe(false);
  });

  it("flags comedy/bingo/quiz programming that a generalist venue might otherwise tag broadly", () => {
    expect(hasNonElectronicGenreSignal("Friday night bingo with prizes.")).toBe(true);
    expect(hasNonElectronicGenreSignal("A stand-up comedy showcase.")).toBe(true);
  });

  it("does not fail an otherwise clearly electronic event because an ARTIST is literally named 'Bingo Fuel' (Culture Box regression case — must specifically be covered)", () => {
    const text =
      "Black Box: WHAT HAPPENS / PERCEPTIONS · Red Box: WHAT HAPPENS / PERCEPTIONS Luca Abayan from Rosario takes the headline spot in Red Box. Borgo B2B Bingo Fuel, Marsans, and ANEXA round off a truly special lineup.";
    const artists = ["KEVIN DI SERNA", "TIM ANDRESEN", "ALBANO BASTONERO", "LUCA ABAYAN", "BINGO FUEL", "MARSANS", "ANEXA"];
    expect(hasNonElectronicGenreSignal(text, artists)).toBe(false);
  });

  it("does not treat a famous artist's name mentioned as an influence/reference as genre evidence about THIS event (real production evidence: Cassius/Trinix's own Pumpehuset copy referencing Daft Punk)", () => {
    expect(
      hasNonElectronicGenreSignal(
        "Frankrig har en stolt tradition, når det kommer til elektronisk musik – bare tænk på Daft Punk, Air, Justice og David Guetta.",
        [],
      ),
    ).toBe(false);
    expect(
      hasNonElectronicGenreSignal(
        "Cassius har samarbejdet med kunstnere som Pharrell Williams, Daft Punk og Wu-Tang Clan.",
        ["Cassius"],
      ),
    ).toBe(false);
  });

  it("still flags a genuinely capitalized sentence-initial genre reference (capitalization alone is not the signal — mid-sentence position is what matters)", () => {
    expect(hasNonElectronicGenreSignal("Grime is the sound running through the whole night.")).toBe(true);
  });
});

describe("hasExplicitElectronicAssertion (data-quality Workstream A)", () => {
  it("matches an event-specific first-party statement that the artist/event's own sound is electronic (real Pumpehuset evidence)", () => {
    expect(hasExplicitElectronicAssertion("sin dragende, elektroniske lyd")).toBe(true);
    expect(hasExplicitElectronicAssertion("blande følelsesladet elektronisk musik med visuals")).toBe(true);
    expect(hasExplicitElectronicAssertion("indhyllet i effektfuld elektronisk produktion")).toBe(true);
    expect(hasExplicitElectronicAssertion("en hel æra af elektronisk musik")).toBe(true);
    expect(hasExplicitElectronicAssertion("maksimalistisk EDM med R&B-toplines")).toBe(true);
    expect(hasExplicitElectronicAssertion("mørk electronica og industriel phonk")).toBe(true);
  });

  it("does not match generic text with no explicit assertion", () => {
    expect(hasExplicitElectronicAssertion("PUMPEHUSET og Live Nation Præsenterer")).toBe(false);
    expect(hasExplicitElectronicAssertion("A night of dancing and drinks.")).toBe(false);
  });
});

describe("assessRelevance (data-quality Workstream A — multi-signal evidence hierarchy)", () => {
  it("is 'strong' for a generic category floor genre when corroborated by an explicit electronic assertion (WITCHZ-type case — genuine event auto-publishes even without a named specific subgenre)", () => {
    expect(
      assessRelevance({
        genre: "electronic-other",
        hasExplicitElectronicAssertion: true,
        hasTrustedElectronicTicketing: false,
        hasNonElectronicGenreSignal: false,
      }),
    ).toBe("strong");
  });

  it("is 'weak' for the generic category floor alone, with no corroboration (Dizzee Rascal-type — venue tag only, no real evidence either way)", () => {
    expect(
      assessRelevance({
        genre: "electronic-other",
        hasExplicitElectronicAssertion: false,
        hasTrustedElectronicTicketing: false,
        hasNonElectronicGenreSignal: false,
      }),
    ).toBe("weak");
  });

  it("is 'none' for the generic category floor plus a real non-electronic signal and no strong signal to offset it (Dizzee Rascal, once grime/rap evidence is present)", () => {
    expect(
      assessRelevance({
        genre: "electronic-other",
        hasExplicitElectronicAssertion: false,
        hasTrustedElectronicTicketing: false,
        hasNonElectronicGenreSignal: true,
      }),
    ).toBe("none");
  });

  it("is 'weak' (not 'none') when a real non-electronic signal is offset by a genuine strong signal (MASTER BOOT RECORD + Fulci — 'techno' genuinely matched, but the same text centers on metal)", () => {
    expect(
      assessRelevance({
        genre: "techno",
        hasExplicitElectronicAssertion: false,
        hasTrustedElectronicTicketing: false,
        hasNonElectronicGenreSignal: true,
      }),
    ).toBe("weak");
  });

  it("is 'strong' from trusted RA ticketing corroboration alone, even with only the generic category floor genre", () => {
    expect(
      assessRelevance({
        genre: "electronic-other",
        hasExplicitElectronicAssertion: false,
        hasTrustedElectronicTicketing: true,
        hasNonElectronicGenreSignal: false,
      }),
    ).toBe("strong");
  });

  it("is 'strong' for a genuinely specific genre match with no contradiction", () => {
    expect(
      assessRelevance({
        genre: "house",
        hasExplicitElectronicAssertion: false,
        hasTrustedElectronicTicketing: false,
        hasNonElectronicGenreSignal: false,
      }),
    ).toBe("strong");
  });

  it("is 'none' when nothing resolved at all", () => {
    expect(
      assessRelevance({
        genre: null,
        hasExplicitElectronicAssertion: false,
        hasTrustedElectronicTicketing: false,
        hasNonElectronicGenreSignal: false,
      }),
    ).toBe("none");
  });
});
