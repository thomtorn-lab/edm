import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getSoundcloudPilotArtists, SOUNDCLOUD_PILOT_EVENT_ID, SOUNDCLOUD_PILOT_SOURCE_ID } from "./soundcloudPilot";
import { CULTURE_BOX_SOURCE_ID, parseCultureBoxEventsHtml } from "./adapters/cultureBoxAdapter";
import { copenhagenWallClockToUtc } from "./datetime";

/** A Culture Box night starting 23:00 Copenhagen time on `date` (YYYY-MM-DD). */
function cultureBoxNight(date: string, artists: string[], overrides: { id?: string; canonicalSourceId?: string | null } = {}) {
  const [year, month, day] = date.split("-").map(Number);
  return {
    id: overrides.id ?? `e-cb-${date}`,
    artists,
    startDatetime: copenhagenWallClockToUtc({ year, month, day }, 23, 0).toISOString(),
    canonicalSourceId: overrides.canonicalSourceId === undefined ? CULTURE_BOX_SOURCE_ID : overrides.canonicalSourceId,
  };
}

describe("soundcloudPilot", () => {
  it("is scoped to the real Culture Box source id", () => {
    expect(SOUNDCLOUD_PILOT_SOURCE_ID).toBe(CULTURE_BOX_SOURCE_ID);
  });

  describe("original one-event pilot (preserved)", () => {
    const pilot = (artists: string[], canonicalSourceId: string | null = null) =>
      cultureBoxNight("2026-12-31", artists, { id: SOUNDCLOUD_PILOT_EVENT_ID, canonicalSourceId });

    it("returns both verified artists on the pilot event, even without a canonical source", () => {
      const result = getSoundcloudPilotArtists(pilot(["TIM ANDRESEN", "REXIE LEX", "SOMEONE ELSE"]));
      expect(result).toEqual([
        { name: "TIM ANDRESEN", url: "https://soundcloud.com/tim-andresen" },
        { name: "REXIE LEX", url: "https://soundcloud.com/rexie_lex" },
      ]);
    });

    it("returns only the subset actually present in the lineup", () => {
      expect(getSoundcloudPilotArtists(pilot(["TIM ANDRESEN", "SOMEONE ELSE"])).map((a) => a.name)).toEqual(["TIM ANDRESEN"]);
    });

    it("returns nothing when the pilot event's lineup no longer contains either verified name", () => {
      expect(getSoundcloudPilotArtists(pilot(["SOMEONE ELSE"]))).toEqual([]);
    });

    it("never fuzzy-matches — a near-miss spelling does not qualify", () => {
      expect(getSoundcloudPilotArtists(pilot(["Tim Andresen", "rexie lex"], CULTURE_BOX_SOURCE_ID))).toEqual([]);
    });

    it("does not extend the pilot event's source-less exemption to the newly added artists", () => {
      expect(getSoundcloudPilotArtists(pilot(["KEVIN DI SERNA", "TIM ANDRESEN"])).map((a) => a.name)).toEqual(["TIM ANDRESEN"]);
    });
  });

  describe("Culture Box nights", () => {
    it.each([
      ["2026-10-17", "KEVIN DI SERNA", "https://soundcloud.com/kevindiserna"],
      ["2026-10-23", "ANDERS HP", "https://soundcloud.com/anders_hp"],
      ["2026-11-06", "SARAH WILD", "https://soundcloud.com/wildsarah"],
      ["2026-11-13", "DUSKY", "https://soundcloud.com/duskymusic"],
      ["2026-11-21", "GUY J", "https://soundcloud.com/guy-j"],
    ])("links %s's %s to their verified profile", (date, name, url) => {
      expect(getSoundcloudPilotArtists(cultureBoxNight(date, ["SOMEONE ELSE", name]))).toEqual([{ name, url }]);
    });

    it.each(["2026-10-17", "2026-10-31", "2026-11-21", "2026-12-11", "2026-12-31"])(
      "extends Tim Andresen's verified link to the %s Culture Box night",
      (date) => {
        expect(getSoundcloudPilotArtists(cultureBoxNight(date, ["TIM ANDRESEN"]))).toEqual([
          { name: "TIM ANDRESEN", url: "https://soundcloud.com/tim-andresen" },
        ]);
      },
    );

    it("returns several verified artists on one night, in lineup order", () => {
      const result = getSoundcloudPilotArtists(cultureBoxNight("2026-10-17", ["KEVIN DI SERNA", "ALBANO BASTONERO", "TIM ANDRESEN"]));
      expect(result.map((a) => a.name)).toEqual(["KEVIN DI SERNA", "TIM ANDRESEN"]);
    });

    it("lists a name once even if the lineup repeats it", () => {
      expect(getSoundcloudPilotArtists(cultureBoxNight("2026-11-21", ["GUY J", "GUY J"]))).toHaveLength(1);
    });

    it("maps an after-midnight start back to its night", () => {
      const event = { ...cultureBoxNight("2026-10-23", ["ANDERS HP"]), startDatetime: copenhagenWallClockToUtc({ year: 2026, month: 10, day: 24 }, 0, 30).toISOString() };
      expect(getSoundcloudPilotArtists(event).map((a) => a.name)).toEqual(["ANDERS HP"]);
    });
  });

  describe("exclusion of unrelated events", () => {
    it("returns nothing for another source's event, even with the exact verified name on the exact night", () => {
      for (const canonicalSourceId of ["src-hangaren", "src-kultunaut", null]) {
        expect(getSoundcloudPilotArtists(cultureBoxNight("2026-11-13", ["DUSKY", "TIM ANDRESEN"], { canonicalSourceId }))).toEqual([]);
      }
    });

    it("returns nothing on a Culture Box night where the venue did not link that name", () => {
      expect(getSoundcloudPilotArtists(cultureBoxNight("2026-10-24", ["ANDERS HP", "DUSKY"]))).toEqual([]);
      expect(getSoundcloudPilotArtists(cultureBoxNight("2027-01-08", ["TIM ANDRESEN"]))).toEqual([]);
    });
  });

  describe("false-positive avoidance", () => {
    it("never matches on case differences, partial names or extra words", () => {
      const lineup = ["Dusky", "GUY J.", "GUY", "GUY JAY", "SARAH WILDE", "ANDERS", "ANDERS HP B2B DUSKY", "KEVIN DI SERNA (LIVE)"];
      expect(getSoundcloudPilotArtists(cultureBoxNight("2026-11-21", lineup))).toEqual([]);
      expect(getSoundcloudPilotArtists(cultureBoxNight("2026-11-13", lineup))).toEqual([]);
    });

    it("abstains on Culture Box names whose venue link was not an independently verified artist profile", () => {
      expect(getSoundcloudPilotArtists(cultureBoxNight("2026-10-16", ["CHICH", "KALLAX"]))).toEqual([]);
      expect(getSoundcloudPilotArtists(cultureBoxNight("2026-10-24", ["NAT"]))).toEqual([]);
      expect(getSoundcloudPilotArtists(cultureBoxNight("2026-10-30", ["GALATIUS", "SOLVÆR"]))).toEqual([]);
      expect(getSoundcloudPilotArtists(cultureBoxNight("2026-11-13", ["RÓS"]))).toEqual([]);
      expect(getSoundcloudPilotArtists(cultureBoxNight("2026-12-11", ["EMOK"]))).toEqual([]);
    });
  });

  describe("against a real recorded Culture Box page", () => {
    // culture-box-events.html: real, unmodified recording of
    // https://culture-box.com/events/ (see cultureBoxAdapter.test.ts).
    const html = readFileSync(path.join(__dirname, "adapters", "__fixtures__", "culture-box-events.html"), "utf-8");
    const nights = parseCultureBoxEventsHtml(html).map((e, i) => ({
      id: `e-fixture-${i}`,
      artists: e.artists,
      startDatetime: e.startDatetime!,
      canonicalSourceId: e.sourceId,
    }));

    it("shows a link only where the venue's own page links that exact name to that exact URL", () => {
      const shown = nights.flatMap((n) => getSoundcloudPilotArtists(n));
      expect(shown).toEqual([{ name: "ANDERS HP", url: "https://soundcloud.com/anders_hp" }]);
      for (const { name, url } of shown) {
        expect(html).toContain(`href="${url}"`);
        expect(html).toMatch(new RegExp(`<a[^>]*href="${url}"[^>]*>${name}</a>`));
      }
    });

    it("does not carry verified names onto nights outside their documented evidence (19 Sept: Tim Andresen and Rexie Lex)", () => {
      const sept19 = nights.find((n) => n.artists.includes("TIM ANDRESEN"));
      expect(sept19?.artists).toContain("REXIE LEX");
      expect(getSoundcloudPilotArtists(sept19!)).toEqual([]);
    });
  });
});
