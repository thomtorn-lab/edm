import { describe, expect, it } from "vitest";
import { adminSoundcloudProfileUrl, planAdminSoundcloudLinks } from "./adminSoundcloudLinks";

describe("adminSoundcloudProfileUrl", () => {
  it("normalizes a profile link", () => {
    expect(adminSoundcloudProfileUrl(" https://m.soundcloud.com/Guy-J?ref=x ")).toEqual({ url: "https://soundcloud.com/guy-j" });
  });

  it("accepts label- or venue-looking handles (the admin's choice is the evidence)", () => {
    expect(adminSoundcloudProfileUrl("https://soundcloud.com/ibogarecords")).toEqual({ url: "https://soundcloud.com/ibogarecords" });
    expect(adminSoundcloudProfileUrl("https://soundcloud.com/cultureboxcopenhagen")).toEqual({ url: "https://soundcloud.com/cultureboxcopenhagen" });
  });

  it("refuses tracks, SoundCloud pages, short links and other sites", () => {
    expect(adminSoundcloudProfileUrl("https://soundcloud.com/guy-j/some-track")).toHaveProperty("error");
    expect(adminSoundcloudProfileUrl("https://soundcloud.com/discover")).toHaveProperty("error");
    expect(adminSoundcloudProfileUrl("https://on.soundcloud.com/abc123")).toHaveProperty("error");
    expect(adminSoundcloudProfileUrl("https://www.youtube.com/watch?v=x")).toHaveProperty("error");
    expect(adminSoundcloudProfileUrl("not a url")).toHaveProperty("error");
  });
});

describe("planAdminSoundcloudLinks", () => {
  const lineup = ["GUY J", "Rós"];

  it("keeps filled-in links, normalized, and drops empty ones", () => {
    expect(
      planAdminSoundcloudLinks(lineup, [
        { artistName: "GUY J", url: "https://soundcloud.com/Guy-J" },
        { artistName: "Rós", url: "  " },
      ]),
    ).toEqual({ ok: true, links: [{ artistName: "GUY J", url: "https://soundcloud.com/guy-j" }] });
  });

  it("an empty list clears every link", () => {
    expect(planAdminSoundcloudLinks(lineup, [])).toEqual({ ok: true, links: [] });
  });

  it("refuses names outside the lineup, duplicates, bad links and bad bodies", () => {
    expect(planAdminSoundcloudLinks(lineup, [{ artistName: "Someone", url: "https://soundcloud.com/x" }]).ok).toBe(false);
    expect(
      planAdminSoundcloudLinks(lineup, [
        { artistName: "GUY J", url: "https://soundcloud.com/a" },
        { artistName: "GUY J", url: "https://soundcloud.com/b" },
      ]).ok,
    ).toBe(false);
    expect(planAdminSoundcloudLinks(lineup, [{ artistName: "GUY J", url: "https://soundcloud.com/guy-j/track" }]).ok).toBe(false);
    expect(planAdminSoundcloudLinks(lineup, undefined).ok).toBe(false);
    expect(planAdminSoundcloudLinks(lineup, [{ artistName: "GUY J" }]).ok).toBe(false);
  });
});
