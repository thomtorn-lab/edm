import { describe, expect, it } from "vitest";
import {
  assessRelevance,
  hasExplicitElectronicAssertion,
  hasExplicitNonElectronicIdentityAssertion,
  hasNonElectronicGenreSignal,
} from "./relevance";

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
        hasExplicitNonElectronicIdentityAssertion: false,
        hasCorroboratingArtistGenreEvidence: false,
      }),
    ).toBe("strong");
  });

  it("is 'weak' for the generic category floor alone, with no corroboration (venue tag only, no real evidence either way)", () => {
    expect(
      assessRelevance({
        genre: "electronic-other",
        hasExplicitElectronicAssertion: false,
        hasTrustedElectronicTicketing: false,
        hasNonElectronicGenreSignal: false,
        hasExplicitNonElectronicIdentityAssertion: false,
        hasCorroboratingArtistGenreEvidence: false,
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
        hasExplicitNonElectronicIdentityAssertion: false,
        hasCorroboratingArtistGenreEvidence: false,
      }),
    ).toBe("none");
  });

  it("is 'weak' (not 'none') when a real non-electronic signal is offset by TWO genuine strong signals and is not an explicit scene/genre identity claim (STVW pres. Punk Rave-type — own copy names both 'EDM og trance' AND 'pop-punk, emo og rock', a genuine two-sided crossover)", () => {
    expect(
      assessRelevance({
        genre: "trance",
        hasExplicitElectronicAssertion: true,
        hasTrustedElectronicTicketing: false,
        hasNonElectronicGenreSignal: true,
        hasExplicitNonElectronicIdentityAssertion: false,
        hasCorroboratingArtistGenreEvidence: false,
      }),
    ).toBe("weak");
  });

  it("is 'none' (not 'weak') when a real non-electronic signal is an explicit scene/genre identity claim offset by only ONE weak/incidental strong signal (MASTER BOOT RECORD + Fulci-type — the event's own intro calls itself part of 'metalscenen'; a single stray 'techno' mention buried in a third support act's blend description must not be enough to soften this to REVIEW)", () => {
    expect(
      assessRelevance({
        genre: "techno",
        hasExplicitElectronicAssertion: false,
        hasTrustedElectronicTicketing: false,
        hasNonElectronicGenreSignal: true,
        hasExplicitNonElectronicIdentityAssertion: true,
        hasCorroboratingArtistGenreEvidence: false,
      }),
    ).toBe("none");
  });

  it("is 'strong' from trusted RA ticketing corroboration alone, even with only the generic category floor genre", () => {
    expect(
      assessRelevance({
        genre: "electronic-other",
        hasExplicitElectronicAssertion: false,
        hasTrustedElectronicTicketing: true,
        hasNonElectronicGenreSignal: false,
        hasExplicitNonElectronicIdentityAssertion: false,
        hasCorroboratingArtistGenreEvidence: false,
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
        hasExplicitNonElectronicIdentityAssertion: false,
        hasCorroboratingArtistGenreEvidence: false,
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
        hasExplicitNonElectronicIdentityAssertion: false,
        hasCorroboratingArtistGenreEvidence: false,
      }),
    ).toBe("none");
  });

  it("is 'strong' from independent Discogs artist-genre corroboration alone, even with only the generic category floor genre (follow-up review — weak-evidence enrichment)", () => {
    expect(
      assessRelevance({
        genre: "electronic-other",
        hasExplicitElectronicAssertion: false,
        hasTrustedElectronicTicketing: false,
        hasNonElectronicGenreSignal: false,
        hasExplicitNonElectronicIdentityAssertion: false,
        hasCorroboratingArtistGenreEvidence: true,
      }),
    ).toBe("strong");
  });

  it("stays 'weak' when Discogs corroboration is absent — absence of Discogs data must never itself become negative evidence, it just leaves the category floor as-is", () => {
    expect(
      assessRelevance({
        genre: "electronic-other",
        hasExplicitElectronicAssertion: false,
        hasTrustedElectronicTicketing: false,
        hasNonElectronicGenreSignal: false,
        hasExplicitNonElectronicIdentityAssertion: false,
        hasCorroboratingArtistGenreEvidence: false,
      }),
    ).toBe("weak");
  });
});

describe("hasExplicitNonElectronicIdentityAssertion (follow-up review — evidence weighting, not artist/event hardcoding)", () => {
  it("is true for an explicit first-party 'X scene' identity claim (MASTER BOOT RECORD + Fulci's own intro)", () => {
    expect(
      hasExplicitNonElectronicIdentityAssertion(
        "To af metalscenens mest unikke navne forener kræfterne, når italienske Fulci og Master Boot Record (MBR) bringer deres cinematiske og teknologiske lyduniverser til Pumpehuset.",
      ),
    ).toBe(true);
  });

  it("is true for an explicit first-party 'X genre' identity claim ('har genopfundet death metal-genren')", () => {
    expect(
      hasExplicitNonElectronicIdentityAssertion(
        "Fulci, opkaldt efter den legendariske italienske filmmager og Godfather of Gore, Lucio Fulci, har genopfundet death metal-genren.",
      ),
    ).toBe(true);
  });

  it("is true for the real Dizzee Rascal production text ('den britiske rapscene')", () => {
    expect(
      hasExplicitNonElectronicIdentityAssertion(
        "Siden begyndelsen af 00'erne har Dizzee Rascal været en central skikkelse på den britiske rapscene.",
      ),
    ).toBe(true);
  });

  it("is false for a stray genre word with no scene/genre identity framing (a real signal, just not an identity claim)", () => {
    expect(
      hasExplicitNonElectronicIdentityAssertion(
        "Som support har de italienske arottenbit, det eksperimenterende musikprojekt der blander chiptune, sludge metal, techno og hardcore punk i et elektronisk univers.",
      ),
    ).toBe(false);
  });

  it("is false when there is no non-electronic signal at all", () => {
    expect(hasExplicitNonElectronicIdentityAssertion("A night of industrial techno at Poolen.")).toBe(false);
  });
});

describe("hasNonElectronicGenreSignal — historical performance credits (follow-up review, data-quality Workstream A)", () => {
  it("does not flag a genre word describing a PAST stage credit at a different, separately-named event (real production evidence: tonser's own Pumpehuset bio — genuinely electronic self-description, closing with a credit for once playing a different hip-hop night, KØL)", () => {
    const text =
      "tonser laver overjordiske sange om kærlighed, indhyllet i effektfuld elektronisk produktion. Hans musik blender euforisk og maksimalistisk EDM med R&B- og K-pop-inspirerede toplines. For nylig kunne han også opleves på scenen i Pumpehuset til det udsolgte, og ekstremt hypede, hiphop-event KØL.";
    expect(hasNonElectronicGenreSignal(text, ["tonser"])).toBe(false);
  });

  it("still flags a genre word describing the event's OWN current programming, not offset by a historical-credit cue (regression guard: the new cue must not over-suppress)", () => {
    expect(hasNonElectronicGenreSignal("Dizzee Rascal is a pioneering grime and hip hop MC.")).toBe(true);
  });
});
