import { describe, expect, it } from "vitest";
import { assessDiscogsSoundcloud, soundcloudProfilesFromUrls } from "./discogsCandidate";

const base = { name: "Paul van Dyk", lookupStatus: "found" as const, identityConfidence: "medium" as const, discogsUrls: ["https://soundcloud.com/paulvandyk", "https://www.paulvandyk.com"], soundcloudDisplayName: "Paul van Dyk" };

describe("assessDiscogsSoundcloud — strict conditions for a verifiable profile", () => {
  it("unique medium identity, one profile, matching SoundCloud name: verifiable", () => {
    expect(assessDiscogsSoundcloud(base)).toMatchObject({ verdict: "verifiable", profileUrl: "https://soundcloud.com/paulvandyk" });
  });

  it.each([
    ["no exact Discogs artist", { lookupStatus: "not_found" as const }, "missing"],
    ["several Discogs artists", { lookupStatus: "ambiguous" as const }, "uncertain"],
    ["no SoundCloud on Discogs", { discogsUrls: ["https://www.paulvandyk.com"] }, "missing"],
    ["two SoundCloud profiles", { discogsUrls: ["https://soundcloud.com/a", "https://soundcloud.com/b"] }, "uncertain"],
    ["low identity", { identityConfidence: "low" as const }, "uncertain"],
    ["SoundCloud not confirmed", { soundcloudDisplayName: null }, "uncertain"],
    ["SoundCloud name differs", { soundcloudDisplayName: "PVD Official Fan Page" }, "uncertain"],
  ])("%s", (_l, change, verdict) => {
    expect(assessDiscogsSoundcloud({ ...base, ...change }).verdict).toBe(verdict);
  });

  it("tracks, sets and label handles are not profiles; duplicates collapse", () => {
    expect(soundcloudProfilesFromUrls(["https://soundcloud.com/x/track", "https://soundcloud.com/zenonrecords", "http://www.soundcloud.com/X", "https://soundcloud.com/x"])).toEqual(["https://soundcloud.com/x"]);
  });
});
