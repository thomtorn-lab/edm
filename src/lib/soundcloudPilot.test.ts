import { describe, expect, it } from "vitest";
import { getSoundcloudPilotArtists, isSoundcloudPilotEvent, SOUNDCLOUD_PILOT_EVENT_ID } from "./soundcloudPilot";

describe("soundcloudPilot (one-event SoundCloud UX pilot, 2026-10-09)", () => {
  describe("isSoundcloudPilotEvent", () => {
    it("is true only for the one hardcoded pilot event id", () => {
      expect(isSoundcloudPilotEvent(SOUNDCLOUD_PILOT_EVENT_ID)).toBe(true);
      expect(isSoundcloudPilotEvent("e-anything-else")).toBe(false);
    });
  });

  describe("getSoundcloudPilotArtists", () => {
    it("returns both verified artists when the pilot event's lineup contains them", () => {
      const result = getSoundcloudPilotArtists(SOUNDCLOUD_PILOT_EVENT_ID, ["TIM ANDRESEN", "REXIE LEX", "SOMEONE ELSE"]);
      expect(result.map((a) => a.name).sort()).toEqual(["REXIE LEX", "TIM ANDRESEN"]);
      expect(result.find((a) => a.name === "TIM ANDRESEN")?.url).toBe("https://soundcloud.com/tim-andresen");
      expect(result.find((a) => a.name === "REXIE LEX")?.url).toBe("https://soundcloud.com/rexie_lex");
    });

    it("returns only the subset actually present in the lineup", () => {
      const result = getSoundcloudPilotArtists(SOUNDCLOUD_PILOT_EVENT_ID, ["TIM ANDRESEN", "SOMEONE ELSE"]);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("TIM ANDRESEN");
    });

    it("returns an empty array for any event other than the pilot event, even with the exact verified names in its lineup", () => {
      const result = getSoundcloudPilotArtists("e-some-other-event", ["TIM ANDRESEN", "REXIE LEX"]);
      expect(result).toEqual([]);
    });

    it("returns an empty array for the pilot event id when its lineup no longer contains either verified name", () => {
      const result = getSoundcloudPilotArtists(SOUNDCLOUD_PILOT_EVENT_ID, ["SOMEONE ELSE"]);
      expect(result).toEqual([]);
    });

    it("never fuzzy-matches — a near-miss spelling does not qualify", () => {
      const result = getSoundcloudPilotArtists(SOUNDCLOUD_PILOT_EVENT_ID, ["Tim Andresen", "rexie lex"]);
      expect(result).toEqual([]);
    });
  });
});
