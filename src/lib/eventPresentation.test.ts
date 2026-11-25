import { describe, expect, it } from "vitest";
import { artistDisplaySpelling, artistTitleDisplay, cleanEventTitle, formatArtistName, lineupDuplicatesTitle, shouldShowArtistPreview, subVenueLabel } from "./eventPresentation";

describe("shouldShowArtistPreview — suppress when the title already carries the lineup", () => {
  it("suppresses when a per-room lineup title names every artist (real Culture Box shape, no hardcoding)", () => {
    const title = "Black Box: TIMO MAAS, RYAN DANK, BALTZA · Red Box: KARINA LIN, ASLI";
    const artists = ["TIMO MAAS", "RYAN DANK", "BALTZA", "KARINA LIN", "ASLI"];
    expect(shouldShowArtistPreview(title, artists)).toBe(false);
  });

  it("suppresses regardless of case, whitespace and punctuation differences between title and artist list", () => {
    const title = "timo   maas,ryan-dank & baltza";
    const artists = ["Timo Maas", "Ryan Dank", "Baltza"];
    expect(shouldShowArtistPreview(title, artists)).toBe(false);
  });

  it("suppresses a single-artist title that already names that one artist", () => {
    expect(shouldShowArtistPreview("Kander presents Kander", ["Kander"])).toBe(false);
  });

  it("tolerates one missing match once the lineup is long enough (effectively all)", () => {
    const title = "Timo Maas, Ryan Dank, Baltza, Karina Lin";
    const artists = ["Timo Maas", "Ryan Dank", "Baltza", "Karina Lin", "A DJ Not Named In The Title"];
    expect(shouldShowArtistPreview(title, artists)).toBe(false);
  });
});

describe("shouldShowArtistPreview — keep when the title is a distinct showcase name", () => {
  it("keeps the preview when none of the artists appear in the title", () => {
    const title = "HYGGELIT SHOWCASE";
    const artists = ["SOPHIE VAN HAYDEN", "NAIVA", "ONSBERG"];
    expect(shouldShowArtistPreview(title, artists)).toBe(true);
  });

  it("is a no-op (nothing to show) when there are no artists at all", () => {
    expect(shouldShowArtistPreview("HYGGELIT SHOWCASE", [])).toBe(false);
  });

  it("does not suppress merely because one of several artists happens to occur in the title", () => {
    const title = "Boiler Room presents Timo Maas";
    const artists = ["Timo Maas", "Ryan Dank"];
    expect(shouldShowArtistPreview(title, artists)).toBe(true);
  });

  it("does not suppress a 3-artist lineup on a single coincidental match", () => {
    const title = "Byhaven: Timo Maas b2b Someone Else";
    const artists = ["Timo Maas", "Ryan Dank", "Baltza"];
    expect(shouldShowArtistPreview(title, artists)).toBe(true);
  });

  it("does not match an artist name that only occurs as a substring of a different word", () => {
    // "Asli" must not match inside "Baslica" — real word-boundary check, not raw substring.
    const title = "Baslica Nightclub Presents";
    const artists = ["Asli"];
    expect(shouldShowArtistPreview(title, artists)).toBe(true);
  });
});

describe("cleanEventTitle — Pumpehuset Byhaven prefix (real fixture titles)", () => {
  it("strips the leading 'Byhaven: ' prefix for Pumpehuset", () => {
    expect(cleanEventTitle("Byhaven: Love.Rave", "Pumpehuset")).toBe("Love.Rave");
    expect(cleanEventTitle("Byhaven: Afro Sundown Fest", "Pumpehuset")).toBe("Afro Sundown Fest");
    expect(cleanEventTitle("Byhaven: CRINGE x MY LITTLE PARTY", "Pumpehuset")).toBe("CRINGE x MY LITTLE PARTY");
    expect(cleanEventTitle("Byhaven: tusind.tanker + e.r.a.s.e.r.h.e.ad", "Pumpehuset")).toBe("tusind.tanker + e.r.a.s.e.r.h.e.ad");
  });

  it("only strips the leading occurrence, leaving a later colon in the event's own name intact", () => {
    expect(cleanEventTitle("Byhaven: 240 Months of Riotvan: Peter Invasion (DE) + Kasper Bjørke + Sexy Lazer", "Pumpehuset")).toBe(
      "240 Months of Riotvan: Peter Invasion (DE) + Kasper Bjørke + Sexy Lazer",
    );
  });

  it("leaves a title unchanged when it doesn't start with the Byhaven prefix", () => {
    expect(cleanEventTitle("WITCHZ", "Pumpehuset")).toBe("WITCHZ");
    expect(cleanEventTitle("Love.Rave: Leeni & Danilo Kupfer", "Pumpehuset")).toBe("Love.Rave: Leeni & Danilo Kupfer");
  });

  it("never strips 'Byhaven' when it isn't the known leading prefix shape", () => {
    expect(cleanEventTitle("Welcome to Byhaven Festival", "Pumpehuset")).toBe("Welcome to Byhaven Festival");
    expect(cleanEventTitle("A Night at Byhaven", "Pumpehuset")).toBe("A Night at Byhaven");
  });

  it("never applies Pumpehuset's Byhaven rule to a different venue", () => {
    expect(cleanEventTitle("Byhaven: Love.Rave", "Culture Box")).toBe("Byhaven: Love.Rave");
    expect(cleanEventTitle("Byhaven: Love.Rave", "Some Other Venue")).toBe("Byhaven: Love.Rave");
  });
});

describe("cleanEventTitle — Culture Box room-prefixed titles (real fixture titles)", () => {
  it("strips both room prefixes from a two-room, differently-named night, keeping both showcase names", () => {
    expect(cleanEventTitle("Black Box: TIMO MAAS, RYAN DANK, BALTZA · Red Box: KARINA LIN, ASLI", "Culture Box")).toBe(
      "TIMO MAAS, RYAN DANK, BALTZA, KARINA LIN, ASLI",
    );
    expect(cleanEventTitle("Black Box: TECHNO SPECIAL · Red Box: HOUSE SPECIAL", "Culture Box")).toBe("TECHNO SPECIAL, HOUSE SPECIAL");
    expect(cleanEventTitle("Black Box: HYGGELIT SHOWCASE · Red Box: SOMETHING ELSE ENTIRELY", "Culture Box")).toBe(
      "HYGGELIT SHOWCASE, SOMETHING ELSE ENTIRELY",
    );
    expect(cleanEventTitle("Black Box: WHAT HAPPENS 4 DECADES OF TIM ANDRESEN · Red Box: WHAT HAPPENS", "Culture Box")).toBe(
      "WHAT HAPPENS 4 DECADES OF TIM ANDRESEN, WHAT HAPPENS",
    );
  });

  it("strips the single room prefix on a one-room night", () => {
    expect(cleanEventTitle("Black Box: NEW YEAR TECHNO SPECIAL", "Culture Box")).toBe("NEW YEAR TECHNO SPECIAL");
    expect(cleanEventTitle("Red Box: ARTIST B", "Culture Box")).toBe("ARTIST B");
  });

  it("leaves an already-collapsed shared-showcase title unchanged (no room prefix present)", () => {
    expect(cleanEventTitle("HYGGELIT SHOWCASE", "Culture Box")).toBe("HYGGELIT SHOWCASE");
  });

  it("never applies Culture Box's room rule to a different venue", () => {
    expect(cleanEventTitle("Black Box: NEW YEAR TECHNO SPECIAL", "Pumpehuset")).toBe("Black Box: NEW YEAR TECHNO SPECIAL");
  });
});

describe("subVenueLabel — Byhaven detail-page context", () => {
  it("reports Byhaven for a Pumpehuset event whose raw title carries the prefix", () => {
    expect(subVenueLabel("Byhaven: Love.Rave", "Pumpehuset")).toBe("Byhaven");
  });

  it("returns null for a Pumpehuset event with no Byhaven prefix", () => {
    expect(subVenueLabel("WITCHZ", "Pumpehuset")).toBeNull();
  });

  it("returns null for any other venue, even with matching title text", () => {
    expect(subVenueLabel("Byhaven: Love.Rave", "Culture Box")).toBeNull();
  });

  it("returns null for Culture Box — room context lives in description, not this label", () => {
    expect(subVenueLabel("Black Box: NEW YEAR TECHNO SPECIAL", "Culture Box")).toBeNull();
  });
});

describe("subVenueLabel — structural subVenue field (generalized sub-venue model, 2026-09-06)", () => {
  it("returns the structural subVenue when present — VEGA room displayed without any title-text convention", () => {
    expect(subVenueLabel("Solar Flare", "VEGA", "Store VEGA")).toBe("Store VEGA");
    expect(subVenueLabel("Solar Flare", "VEGA", "Lille VEGA")).toBe("Lille VEGA");
  });

  it("bare VEGA (no room) has no subVenue label", () => {
    expect(subVenueLabel("Solar Flare", "VEGA", null)).toBeNull();
    expect(subVenueLabel("Solar Flare", "VEGA")).toBeNull();
  });

  it("Ideal Bar (a standalone venue, never a room under VEGA) has no subVenue label", () => {
    expect(subVenueLabel("Solar Flare", "VEGA (Ideal Bar)", null)).toBeNull();
  });

  it("the structural field always wins over the title-text heuristic when both could apply", () => {
    expect(subVenueLabel("Byhaven: Love.Rave", "Pumpehuset", "Some Structural Room")).toBe("Some Structural Room");
  });

  it("omitting the structural field entirely falls back to the existing Byhaven/Culture Box behavior unchanged", () => {
    expect(subVenueLabel("Byhaven: Love.Rave", "Pumpehuset")).toBe("Byhaven");
    expect(subVenueLabel("Black Box: NEW YEAR TECHNO SPECIAL", "Culture Box")).toBeNull();
  });

  it("canonical title is never rewritten to include the room — cleanEventTitle is untouched by this field", () => {
    // subVenueLabel is purely additive display; cleanEventTitle (the ONLY
    // function allowed to touch the rendered title) has no third parameter
    // and never reads event.subVenue at all.
    expect(subVenueLabel("Solar Flare", "VEGA", "Store VEGA")).not.toContain(":");
  });
});

describe("cleanEventTitle — Den Anden Side rooms (2026-10-27)", () => {
  it("strips the room prefix like Culture Box's, only at Den Anden Side", () => {
    expect(cleanEventTitle("Den Anden Ende: Kilele x DAS", "Den Anden Side")).toBe("Kilele x DAS");
    expect(cleanEventTitle("GAG x DAS", "Den Anden Side")).toBe("GAG x DAS");
    expect(cleanEventTitle("Den Anden Ende: Kilele x DAS", "Culture Box")).toBe("Den Anden Ende: Kilele x DAS");
    expect(cleanEventTitle("Black Box: X · Red Box: Y", "Culture Box")).toBe("X, Y");
  });

  it("joins Den Anden Side's room segments with a comma once a prefix is removed (2026-11-22)", () => {
    expect(cleanEventTitle("Den Anden Side: A · Den Anden Ende: B", "Den Anden Side")).toBe("A, B");
    expect(cleanEventTitle("A · B", "Den Anden Side")).toBe("A · B");
  });
});

describe("cleanEventTitle — Culture Box room separator becomes a comma (2026-11-22)", () => {
  it("shows the real two-room shape as one comma-separated list", () => {
    expect(
      cleanEventTitle("Black Box: STEAMBOI, KARDINAL BERTRAM, LMN · Red Box: QWENTY, OOOPS, avoN, SILK!", "Culture Box"),
    ).toBe("STEAMBOI, KARDINAL BERTRAM, LMN, QWENTY, OOOPS, avoN, SILK!");
  });

  it("never leaves a dangling separator when a room segment is empty", () => {
    expect(cleanEventTitle("Black Box: LMN · Red Box:", "Culture Box")).toBe("LMN");
  });
});

describe("formatArtistName — official spelling (2026-11-22)", () => {
  it("keeps the source's own spelling and casing", () => {
    expect(formatArtistName("ROSA MALENA")).toBe("ROSA MALENA");
    expect(formatArtistName("avoN")).toBe("avoN");
    expect(formatArtistName("LMN")).toBe("LMN");
    expect(formatArtistName("Silk!")).toBe("Silk!");
    expect(formatArtistName("dj koze")).toBe("dj koze");
    expect(formatArtistName("QWENTY b2b OOOPS")).toBe("QWENTY b2b OOOPS");
  });

  it("only tidies stray whitespace", () => {
    expect(formatArtistName("  ØLLE   ÅSE ")).toBe("ØLLE ÅSE");
  });
});

describe("lineupDuplicatesTitle — hide the listing lineup when the title names every artist (2026-11-22)", () => {
  it("is true for a single-artist title, ignoring case and accents", () => {
    expect(lineupDuplicatesTitle("BLIKFANG", ["Blikfang"])).toBe(true);
    expect(lineupDuplicatesTitle("Rosalía", ["ROSALIA"])).toBe(true);
  });

  it("is true when every artist is in the title, whatever else the title says", () => {
    expect(lineupDuplicatesTitle("Ben Klock & Marcel Dettmann", ["Ben Klock", "Marcel Dettmann"])).toBe(true);
    expect(lineupDuplicatesTitle("Black Box: TIMO MAAS · Red Box: ASLI", ["TIMO MAAS", "ASLI"])).toBe(true);
    expect(lineupDuplicatesTitle("Blikfang (live)", ["Blikfang"])).toBe(true);
  });

  it("splits b2b/vs/x entries so a b2b notation never keeps the lineup visible (real Culture Box event)", () => {
    const title = "STEAMBOI, KARDINAL BERTRAM, LMN, QWENTY, OOOPS, avoN, SANDY P, MADITATION, VALENTINA, SILK!";
    const artists = ["STEAMBOI", "KARDINAL BERTRAM", "LMN", "QWENTY b2b OOOPS", "avoN", "SANDY P B2B MADITATION B2B VALENTINA", "SILK!"];
    expect(lineupDuplicatesTitle(title, artists)).toBe(true);
    expect(lineupDuplicatesTitle("A, B", ["A vs B"])).toBe(true);
    expect(lineupDuplicatesTitle("A, B", ["A x B"])).toBe(true);
  });

  it("is false as soon as one artist is missing from the title", () => {
    expect(lineupDuplicatesTitle("HYGGELIT SHOWCASE", ["Naiva"])).toBe(false);
    expect(lineupDuplicatesTitle("QWENTY", ["QWENTY b2b OOOPS"])).toBe(false);
    expect(lineupDuplicatesTitle("Timo Maas, Ryan Dank, Baltza", ["Timo Maas", "Ryan Dank", "Baltza", "Asli"])).toBe(false);
  });

  it("never matches part of a longer name", () => {
    expect(lineupDuplicatesTitle("Malena Rosa", ["Rosa Malena"])).toBe(false);
    expect(lineupDuplicatesTitle("Asliana", ["Asli"])).toBe(false);
  });

  it("is false with no artists or an empty title", () => {
    expect(lineupDuplicatesTitle("Blikfang", [])).toBe(false);
    expect(lineupDuplicatesTitle("", ["Blikfang"])).toBe(false);
  });
});

describe("artistTitleDisplay — artist-only titles use the artist data's spelling (2026-11-25)", () => {
  it("re-cases a title made only of the event's artists, keeping the separators", () => {
    expect(artistTitleDisplay("DENIS HORVAT / ANASTASIA KRISTENSEN", ["Denis Horvat", "Anastasia Kristensen"])).toBe("Denis Horvat / Anastasia Kristensen");
    expect(artistTitleDisplay("DEBBIE SINGS", ["Debbie Sings", "PONNY", "HEX ELECTRONIX (DJ)"])).toBe("Debbie Sings");
  });

  it("writes b2b / vs / x in lower case, from separate or combined lineup entries", () => {
    expect(artistTitleDisplay("BEN KLOCK B2B MARCEL DETTMANN", ["Ben Klock", "Marcel Dettmann"])).toBe("Ben Klock b2b Marcel Dettmann");
    expect(artistTitleDisplay("BEN KLOCK B2B MARCEL DETTMANN", ["Ben Klock b2b Marcel Dettmann"])).toBe("Ben Klock b2b Marcel Dettmann");
  });

  it("matches an artist entry without its trailing qualifier", () => {
    expect(artistTitleDisplay("OVERMONO", ["Overmono (DJ set)", "Love Remain (DJ set)"])).toBe("Overmono");
  });

  it("keeps names the artist data itself writes in capitals, symbols or digits", () => {
    expect(artistTitleDisplay("KI/KI", ["KI/KI"])).toBe("KI/KI");
    expect(artistTitleDisplay("BICEP", ["BICEP"])).toBe("BICEP");
    expect(artistTitleDisplay("999999999", ["999999999"])).toBe("999999999");
    expect(artistTitleDisplay("ANNA & DJ 2LATE", ["ANNA", "DJ 2Late"])).toBe("ANNA & DJ 2Late");
    expect(artistTitleDisplay("MSW COLLECTIVE x ADAPT (DK)", ["MSW COLLECTIVE", "ADAPT (DK)"])).toBe("MSW Collective x Adapt (DK)");
  });

  it("leaves any title with other words (an event name or concept) unchanged", () => {
    expect(artistTitleDisplay("HYGGELIT SHOWCASE", ["Naiva", "Onsberg"])).toBe("HYGGELIT SHOWCASE");
    expect(artistTitleDisplay("BEN KLOCK SHOWCASE", ["Ben Klock"])).toBe("BEN KLOCK SHOWCASE");
    expect(artistTitleDisplay("AETHR X MODULE", ["MSW COLLECTIVE", "Baime"])).toBe("AETHR X MODULE");
    expect(artistTitleDisplay("DENIS HORVAT /", ["Denis Horvat"])).toBe("DENIS HORVAT /");
    expect(artistTitleDisplay("Anything", [])).toBe("Anything");
  });
});

describe("artistDisplaySpelling — default casing with verified exceptions (2026-11-25)", () => {
  it("gives an all-capitals name a capital first letter per word", () => {
    expect(artistDisplaySpelling("KARDINAL BERTRAM")).toBe("Kardinal Bertram");
    expect(artistDisplaySpelling("SILK!")).toBe("Silk!");
    expect(artistDisplaySpelling("SANDY P")).toBe("Sandy P");
    expect(artistDisplaySpelling("I HATE MODELS")).toBe("I Hate Models");
    expect(artistDisplaySpelling("JEAN-PAUL")).toBe("Jean-Paul");
  });

  it("puts verified spellings first", () => {
    expect(artistDisplaySpelling("STEAMBOI")).toBe("steamboi");
    expect(artistDisplaySpelling("AVON")).toBe("avoN");
    expect(artistDisplaySpelling("BICEP")).toBe("BICEP");
    expect(artistDisplaySpelling("KI/KI")).toBe("KI/KI");
    expect(artistDisplaySpelling("ANNA")).toBe("ANNA");
    expect(artistDisplaySpelling("LMN")).toBe("LMN");
    expect(artistDisplaySpelling("SHERELLE")).toBe("SHERELLE");
    expect(artistDisplaySpelling("BUNT")).toBe("BUNT.");
    expect(artistDisplaySpelling("BUNT.")).toBe("BUNT.");
    expect(artistTitleDisplay("BUNT", ["BUNT"])).toBe("BUNT.");
  });

  it("keeps the source's own mixed case, and words without vowels or with digits, symbols or non-Latin letters", () => {
    expect(artistDisplaySpelling("dragongirl")).toBe("dragongirl");
    expect(artistDisplaySpelling("DJ 2LATE")).toBe("DJ 2LATE");
    expect(artistDisplaySpelling("EL*VIRA")).toBe("EL*VIRA");
    expect(artistDisplaySpelling("ULDΛLL")).toBe("ULDΛLL");
    expect(artistDisplaySpelling("HDN")).toBe("HDN");
    expect(artistDisplaySpelling("999999999")).toBe("999999999");
  });
});
