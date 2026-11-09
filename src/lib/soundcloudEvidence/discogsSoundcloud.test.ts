import { describe, expect, it } from "vitest";
import { discogsCacheKey, discogsLookupCandidates, discogsLookupName, readDiscogsSoundcloud, verifiedDiscogsProfile, withDiscogsSoundcloud } from "./discogsSoundcloud";

const sc = { verdict: "verifiable" as const, reason: "ok", profileUrl: "https://soundcloud.com/subzeroproject", soundcloudName: "Sub Zero Project", checkedAt: "2026-11-07T00:00:00.000Z" };

describe("Discogs lookup name: the identity key, so documented country suffixes don't block a match", () => {
  it.each([
    ["Moor Mother US", "moor mother"],
    ["Amelie Duchow DE", "amelie duchow"],
    ["Byetone DE", "byetone"],
    ["SKALAH (UK)", "skalah"],
    ["Sub Zero project", "sub zero project"],
  ])("%s -> %s", (name, key) => {
    expect(discogsLookupName(name)).toBe(key);
    expect(discogsCacheKey(name)).toBe(key);
  });
});

describe("the assessment lives in the Discogs cache's own evidence, everything else kept", () => {
  it("adds and reads back the soundcloud key without touching the genre evidence", () => {
    const merged = withDiscogsSoundcloud({ discogsArtistId: 1, matchedStyles: ["Hardstyle"] }, sc);
    expect(merged).toMatchObject({ discogsArtistId: 1, matchedStyles: ["Hardstyle"], soundcloud: sc });
    expect(readDiscogsSoundcloud(merged)).toEqual(sc);
    expect(readDiscogsSoundcloud({ discogsArtistId: 1 })).toBeNull();
    expect(readDiscogsSoundcloud(null)).toBeNull();
  });

  it("only a found, medium-identity, verifiable assessment yields a profile", () => {
    const ev = withDiscogsSoundcloud({}, sc);
    expect(verifiedDiscogsProfile({ lookupStatus: "found", identityConfidence: "medium", evidence: ev })).toBe(sc.profileUrl);
    expect(verifiedDiscogsProfile({ lookupStatus: "found", identityConfidence: "low", evidence: ev })).toBeNull();
    expect(verifiedDiscogsProfile({ lookupStatus: "ambiguous", identityConfidence: null, evidence: ev })).toBeNull();
    expect(verifiedDiscogsProfile({ lookupStatus: "found", identityConfidence: "medium", evidence: withDiscogsSoundcloud({}, { ...sc, verdict: "uncertain" }) })).toBeNull();
  });
});

describe("which names are worth a lookup (no expected gain -> no lookup)", () => {
  it("distinctive single performers without a link; B2B sides count; title copies, short names, duos and event words don't", () => {
    expect(
      discogsLookupCandidates(
        [
          { title: "Sub Zero project", artists: ["Sub Zero project", "Rebelion", "HP", "Coone b2b Adrenalize", "DRABER666 & Sebastian Wibe", "Support: Lisha"] },
          { title: "Faustix", artists: ["Faustix"] },
          { title: "Utopia", artists: ["HATIKWA", "GUY J"] },
        ],
        new Set(["GUY J"]),
      ),
    ).toEqual(["Sub Zero project", "Rebelion", "Coone", "Adrenalize", "HATIKWA"]);
  });

  it("the same performer on two events is looked up once", () => {
    expect(discogsLookupCandidates([{ title: "A", artists: ["HATIKWA", "Aaaa Bbbb"] }, { title: "B", artists: ["Hatikwa", "Cccc Dddd"] }], new Set())).toEqual(["HATIKWA", "Aaaa Bbbb", "Cccc Dddd"]);
  });
});
