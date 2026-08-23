import { describe, expect, it } from "vitest";
import { cleanEventTitle, shouldShowArtistPreview, subVenueLabel } from "./eventPresentation";

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
      "TIMO MAAS, RYAN DANK, BALTZA · KARINA LIN, ASLI",
    );
    expect(cleanEventTitle("Black Box: TECHNO SPECIAL · Red Box: HOUSE SPECIAL", "Culture Box")).toBe("TECHNO SPECIAL · HOUSE SPECIAL");
    expect(cleanEventTitle("Black Box: HYGGELIT SHOWCASE · Red Box: SOMETHING ELSE ENTIRELY", "Culture Box")).toBe(
      "HYGGELIT SHOWCASE · SOMETHING ELSE ENTIRELY",
    );
    expect(cleanEventTitle("Black Box: WHAT HAPPENS 4 DECADES OF TIM ANDRESEN · Red Box: WHAT HAPPENS", "Culture Box")).toBe(
      "WHAT HAPPENS 4 DECADES OF TIM ANDRESEN · WHAT HAPPENS",
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
