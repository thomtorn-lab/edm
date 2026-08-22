import { describe, expect, it } from "vitest";
import { shouldShowArtistPreview } from "./eventPresentation";

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
