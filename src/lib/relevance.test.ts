import { describe, expect, it } from "vitest";
import {
  assessRelevance,
  hasExplicitElectronicAssertion,
  hasExplicitNonElectronicIdentityAssertion,
  hasNonElectronicGenreSignal,
  hasNonElectronicCategorySignal,
  countNonElectronicGenreFamilies,
  hasElectronicsAsInstrumentationOnly,
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

  it("flags 'rock' compounded without a separating space, the same Danish-style compounding gap already fixed for 'postpunk' (admin Discovery Queue cleanup quality audit, 2026-09-06 — real KultuNaut evidence: Mikael Simpson's own description names 'stemningsfuld indierock')", () => {
    expect(hasNonElectronicGenreSignal("Med elektroniske beats og stemningsfuld indierock leverer Simpson forunderlige dansk lyrik.")).toBe(true);
    expect(hasNonElectronicGenreSignal("A night of pure poprock energy.")).toBe(true);
    // Bare, space-separated "rock" already worked before this fix — still does.
    expect(hasNonElectronicGenreSignal("A blend of indie rock and electronic textures.")).toBe(true);
  });

  it("does not let the compound-'rock' pattern collide with an event's own listed artist name (masking still applies)", () => {
    expect(hasNonElectronicGenreSignal("Brock brings his signature electronic sound to the club.", ["Brock"])).toBe(false);
  });
});

describe("hasNonElectronicGenreSignal — goth/postpunk (Final EDM Relevance Rule follow-up, 2026-08-30)", () => {
  it("flags a real mixed dark-electronic/goth/postpunk bill (RUST's 'Electronic Equinox Gathering' evidence)", () => {
    expect(
      hasNonElectronicGenreSignal(
        "Electronic Equinox Gathering byder på noget af det bedste inden for den mørke elektroniske musik: synth/goth/industrial/EBM/postpunk/darkwave natklub med DJ's.",
      ),
    ).toBe(true);
  });

  it("flags 'postpunk' as one unhyphenated compound word, distinct from the existing bare \\bpunk\\b match", () => {
    expect(hasNonElectronicGenreSignal("A night of postpunk and shoegaze.")).toBe(true);
    expect(hasNonElectronicGenreSignal("A night of post-punk and shoegaze.")).toBe(true);
    expect(hasNonElectronicGenreSignal("A night of post punk and shoegaze.")).toBe(true);
  });

  it("does not flag a clean industrial/EBM/darkwave EDM night with no goth/postpunk mention (industrial/EBM/darkwave remain real dance-adjacent EDM evidence on their own)", () => {
    expect(
      hasNonElectronicGenreSignal("A hard-hitting night of industrial and EBM. Dark electronic dance music, DJs all night, darkwave and techno."),
    ).toBe(false);
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
        hasPopOrRnbSignal: false,
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
        hasPopOrRnbSignal: false,
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
        hasPopOrRnbSignal: false,
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
        hasPopOrRnbSignal: false,
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
        hasPopOrRnbSignal: false,
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
        hasPopOrRnbSignal: false,
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
        hasPopOrRnbSignal: false,
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
        hasPopOrRnbSignal: false,
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
        hasPopOrRnbSignal: false,
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
        hasPopOrRnbSignal: false,
      }),
    ).toBe("weak");
  });

  it("is 'weak' (review), not 'strong' (auto-publish) or 'none' (hold), for the real Electronic Equinox Gathering evidence — a genuinely mixed dark-electronic/goth/postpunk bill offset by two real strong signals (specific 'industrial' genre + explicit electronic assertion), with no explicit goth/postpunk scene-identity claim (Final EDM Relevance Rule follow-up, 2026-08-30)", () => {
    expect(
      assessRelevance({
        genre: "industrial",
        hasExplicitElectronicAssertion: true,
        hasTrustedElectronicTicketing: false,
        hasNonElectronicGenreSignal: true,
        hasExplicitNonElectronicIdentityAssertion: false,
        hasCorroboratingArtistGenreEvidence: false,
        hasPopOrRnbSignal: false,
      }),
    ).toBe("weak");
  });

  it("is 'strong' for a clean industrial/EBM/darkwave EDM night with no goth/postpunk contradiction — genuine EDM using this vocabulary must still qualify", () => {
    expect(
      assessRelevance({
        genre: "industrial",
        hasExplicitElectronicAssertion: true,
        hasTrustedElectronicTicketing: false,
        hasNonElectronicGenreSignal: false,
        hasExplicitNonElectronicIdentityAssertion: false,
        hasCorroboratingArtistGenreEvidence: false,
        hasPopOrRnbSignal: false,
      }),
    ).toBe("strong");
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

describe("hasNonElectronicCategorySignal (data-quality Workstream, Billetto queue audit 2026-08-24 — real observed Production titles)", () => {
  it("flags the real 'SpeedDating i København 25-35 år' / 'QualityDating' Billetto titles", () => {
    expect(hasNonElectronicCategorySignal("SpeedDating i København 25-35 år")).toBe(true);
    expect(hasNonElectronicCategorySignal("QualityDating i København 30-45 år")).toBe(true);
  });

  it("flags real makeup-masterclass, wine/beer-tasting, flea-market, chamber-music and guided-tour titles", () => {
    expect(hasNonElectronicCategorySignal("DRAG MAKEUP MASTERCLASS")).toBe(true);
    expect(hasNonElectronicCategorySignal("Sparkling Wine Festival København - 20% early bird")).toBe(true);
    expect(hasNonElectronicCategorySignal("Ølsmagning med Brygmester")).toBe(true);
    expect(hasNonElectronicCategorySignal("Sams Loppemarked i Remisen")).toBe(true);
    expect(hasNonElectronicCategorySignal("Byens Lopper X Trianglen")).toBe(true);
    expect(hasNonElectronicCategorySignal("Unge Talenter // Kammermusikforeningen af 1911")).toBe(true);
    expect(hasNonElectronicCategorySignal("By, brand og borgere – en byvandring i Københavns Kulturkvarter")).toBe(true);
    expect(hasNonElectronicCategorySignal("Guided Bike Tour - Ørestad and Sydhavn")).toBe(true);
    expect(hasNonElectronicCategorySignal("Self Care Sunday Soundbath™ w/Lori Webb")).toBe(true);
    expect(hasNonElectronicCategorySignal("Body Temple - Mindful Cuddling")).toBe(true);
  });

  it("does not flag an ordinary electronic-event title with none of these signals", () => {
    expect(hasNonElectronicCategorySignal("Dengue Dengue Dengue — a night of techno")).toBe(false);
    expect(hasNonElectronicCategorySignal("A night of house and disco at Culture Box")).toBe(false);
  });

  it("masks a known artist's own name first, same as hasNonElectronicGenreSignal", () => {
    // Contrived but proves the masking wiring: an artist literally named
    // "DJ Soundbath" must never fail relevance because of their own name.
    expect(hasNonElectronicCategorySignal("DJ Soundbath live at Culture Box", ["DJ Soundbath"])).toBe(false);
  });

  it("flags the real 'Depeche Modes Violator - musikforedrag' KultuNaut title (source audit, 2026-08-25/2026-09-05) — a lecture, not a performance, even though its own description text is separately dense with 'elektronisk'/'elektroniske' describing the album's sound (that description text alone, real evidence: 'Nu skal sangen omsættes til et elektronisk univers', never itself says 'musikforedrag' — the category signal is real evidence on the TITLE, matching how this source's own listing/detail pages label the event)", () => {
    expect(hasNonElectronicCategorySignal("Depeche Modes Violator - musikforedrag")).toBe(true);
    expect(hasNonElectronicCategorySignal("Nu skal sangen omsættes til et elektronisk univers.")).toBe(false);
  });

  it("gap 4C (KultuNaut publish work package, 2026-09-05): flags exhibition/vernissage/lecture/workshop/performance-art formats even when a strong genre word appears in the same text (real Mærk. Bemærk. evidence: an explicit 'drum and bass' mention inside a gallery vernissage)", () => {
    expect(hasNonElectronicCategorySignal("Mærk. Bemærk. — vernissage med drum and bass i baggrunden")).toBe(true);
    expect(hasNonElectronicCategorySignal("Fernisering på ny kunstudstilling, med techno fra en lokal DJ")).toBe(true);
    expect(hasNonElectronicCategorySignal("Foredrag om house-musikkens historie")).toBe(true);
    expect(hasNonElectronicCategorySignal("Vinyl workshop med fokus på techno-produktion")).toBe(true);
  });

  it("gap 4C does not flag an ordinary club night with none of these format words", () => {
    expect(hasNonElectronicCategorySignal("Teletech Copenhagen — a night of techno at Poolen")).toBe(false);
  });
});

describe("round 3 quality audit, 2026-09-06 — new non-electronic signals from real ALICE evidence", () => {
  it("flags flamenco (real evidence: Yerai Cortés ES — 'one of flamenco's brightest new stars', 'a leading figure in a new era of flamenco')", () => {
    expect(hasNonElectronicGenreSignal("Yerai Cortés has established himself as one of the most distinctive voices of flamenco's new generation.")).toBe(true);
  });

  it("flags 'Música Popular Brasileira'/'(MPB)' as a category-style bypass signal, same as the existing Kammermusikforeningen entry (real evidence: Bruno Berle BR — 'is gently expanding the boundaries of Música Popular Brasileira (MPB)')", () => {
    expect(hasNonElectronicCategorySignal("the composer is gently expanding the boundaries of Música Popular Brasileira (MPB) — the influential movement that emerged in the 1960s.")).toBe(true);
    expect(hasNonElectronicCategorySignal("A night of Música Popular Brasileira at ALICE.")).toBe(true);
  });

  it("flags the English 'chamber music' spelling alongside the existing Danish 'kammermusik' entry (real evidence: Daniel Sommer/Arve Henriksen/Johannes Lundberg's own bio — 'Drawing on jazz, chamber music, ambient and free improvisation')", () => {
    expect(hasNonElectronicCategorySignal("Drawing on jazz, chamber music, ambient and free improvisation, the trio creates a shared musical language.")).toBe(true);
  });

  it("does not flag an ordinary electronic-event title with none of these new signals", () => {
    expect(hasNonElectronicGenreSignal("Dengue Dengue Dengue — a night of techno")).toBe(false);
    expect(hasNonElectronicCategorySignal("A night of house and disco at Culture Box")).toBe(false);
  });
});

describe("countNonElectronicGenreFamilies (round 3 quality audit, 2026-09-06)", () => {
  it("counts each DISTINCT non-electronic genre family once, not every raw occurrence (real evidence: Nubiyan Twist UK — 'genre-blending sound drawing on jazz, hip hop, afrobeat, dancehall, soul, reggae and electronic music')", () => {
    // jazz, hip hop, reggae are recognized families here (afrobeat/dancehall/soul
    // aren't in the fixed NON_ELECTRONIC_GENRE_SIGNALS list — the count only
    // reflects patterns this module actually recognizes).
    const count = countNonElectronicGenreFamilies(
      "Nubiyan Twist deliver an energetic fusion of jazz, funk and soul. Their genre-blending sound draws on jazz, hip hop, afrobeat, dancehall, soul, reggae and electronic music.",
    );
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it("counts a single repeated family only once (real evidence: Mikael Simpson's genuine indierock crossover, a single contradiction, must stay at 1)", () => {
    const count = countNonElectronicGenreFamilies(
      "Med elektroniske, knitrende beats og stemningsfuld indierock leverer Simpson forunderlige dansk lyrik. En stemningsfuld indierock-aften.",
    );
    expect(count).toBe(1);
  });

  it("returns 0 for text with no non-electronic genre signal at all", () => {
    expect(countNonElectronicGenreFamilies("A night of techno and house at Culture Box.")).toBe(0);
  });

  it("masks a known artist's own name first, same as hasNonElectronicGenreSignal", () => {
    expect(countNonElectronicGenreFamilies("Brock brings his signature electronic sound to the club.", ["Brock"])).toBe(0);
  });
});

describe("assessRelevance — hasBroadNonElectronicGenreMix (round 3 quality audit, 2026-09-06)", () => {
  const baseInput = {
    genre: "electronic-other",
    hasExplicitElectronicAssertion: true,
    hasTrustedElectronicTicketing: false,
    hasCorroboratingArtistGenreEvidence: false,
    hasPopOrRnbSignal: false,
  };

  it("downgrades a one-strong-signal contradiction to 'none' when the mix flag is set, same as an explicit scene/genre identity claim would", () => {
    expect(
      assessRelevance({
        ...baseInput,
        hasNonElectronicGenreSignal: true,
        hasExplicitNonElectronicIdentityAssertion: false,
        hasBroadNonElectronicGenreMix: true,
      }),
    ).toBe("none");
  });

  it("stays 'weak' for a one-strong-signal contradiction when the mix flag is false/absent (unaffected — the existing single-word-crossover tolerance, e.g. Mikael Simpson, is preserved)", () => {
    expect(
      assessRelevance({
        ...baseInput,
        hasNonElectronicGenreSignal: true,
        hasExplicitNonElectronicIdentityAssertion: false,
      }),
    ).toBe("weak");
  });
});

describe("hasElectronicsAsInstrumentationOnly (final focused pass, round 3 part 2, 2026-09-06 — Daniel Sommer root cause)", () => {
  it("is true when every 'electronics' mention sits in an instrument list (real Daniel Sommer/Arve Henriksen/Johannes Lundberg evidence)", () => {
    expect(
      hasElectronicsAsInstrumentationOnly(
        "Drawing on jazz, chamber music, ambient and free improvisation, the trio creates a shared musical language where acoustic instruments and electronics open up new sonic possibilities. Arve Henriksen's trumpet, voice and electronics, Johannes Lundberg's double bass move between simple melodies.",
      ),
    ).toBe(true);
  });

  it("is true for a simpler 'guitar and electronics' instrument-list shape", () => {
    expect(hasElectronicsAsInstrumentationOnly("A trio of guitar, drums and electronics playing free improvisation.")).toBe(true);
  });

  it("is false when there is no 'electronics'/'electronic' mention at all", () => {
    expect(hasElectronicsAsInstrumentationOnly("A vernissage with drum and bass in the background.")).toBe(false);
    expect(hasElectronicsAsInstrumentationOnly("")).toBe(false);
  });

  it("is false when 'electronic' is used as a genre claim, even elsewhere in the same text (must never suppress a genuine electronic assertion)", () => {
    expect(
      hasElectronicsAsInstrumentationOnly(
        "A singular sonic universe where folk, electronic music, and spiritual traditions merge into deeply human stories.",
      ),
    ).toBe(false);
  });

  it("is false for a genuinely electronic live act naming its own hardware/gear, not an acoustic-instrument list (must not globally suppress real electronic live acts)", () => {
    expect(hasElectronicsAsInstrumentationOnly("A live set of modular synths, drum machines and electronics.")).toBe(false);
  });

  it("is false when even ONE electronic mention sits outside an instrument-list context, alongside one that does (mixed text — the genre-claim mention must win)", () => {
    expect(
      hasElectronicsAsInstrumentationOnly(
        "Trumpet and electronics open the set, before a full electronic music takeover for the rest of the night.",
      ),
    ).toBe(false);
  });

  it("masks a known artist's own name first, same as the other relevance signals", () => {
    expect(hasElectronicsAsInstrumentationOnly("Electronics brings his trumpet and electronics show to the club.", ["Electronics"])).toBe(false);
  });
});

describe("assessRelevance — hasRichSpecificGenreEvidence in the pop/R&B zone (round 3 part 3, 2026-09-06 — Roya (dk) root cause)", () => {
  const popBase = {
    hasExplicitElectronicAssertion: false,
    hasTrustedElectronicTicketing: false,
    hasCorroboratingArtistGenreEvidence: false,
    hasNonElectronicGenreSignal: false,
    hasExplicitNonElectronicIdentityAssertion: false,
    hasPopOrRnbSignal: true,
  };

  it("caps at 'weak' (never 'strong') for a pop act whose only genre evidence is a non-rich '-inspired' mention (real Roya (dk) evidence: 'house-inspireret popmusik... med elektroniske trommer' — no direct claim the show itself is house)", () => {
    expect(
      assessRelevance({
        ...popBase,
        genre: "house",
        hasRichSpecificGenreEvidence: false,
      }),
    ).toBe("weak");
  });

  it("never forces 'none' for the pop/R&B zone, even with zero rich evidence — only ever caps at the generic-category floor (matches assessRelevance's own documented invariant)", () => {
    expect(
      assessRelevance({
        ...popBase,
        genre: "house",
        hasRichSpecificGenreEvidence: false,
      }),
    ).not.toBe("none");
  });

  it("stays 'strong' for a pop/R&B crossover with a RICH, direct specific-genre claim (real MNEK-shape evidence — must not regress the existing precedent)", () => {
    expect(
      assessRelevance({
        ...popBase,
        genre: "house",
        hasRichSpecificGenreEvidence: true,
      }),
    ).toBe("strong");
  });

  it("defaults to treating genre evidence as rich when hasRichSpecificGenreEvidence is omitted (every existing caller/test unaffected)", () => {
    expect(
      assessRelevance({
        ...popBase,
        genre: "house",
      }),
    ).toBe("strong");
  });

  it("is completely unaffected outside the pop/R&B zone — a non-rich specific genre still counts as a strong signal when hasPopOrRnbSignal is false (must not repeat the earlier reverted GLOBAL richness-gating regression)", () => {
    expect(
      assessRelevance({
        ...popBase,
        hasPopOrRnbSignal: false,
        genre: "drum-and-bass",
        hasRichSpecificGenreEvidence: false,
      }),
    ).toBe("strong");
  });
});
