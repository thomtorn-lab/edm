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

describe("needsDiscogsSoundcloudLookup: no artist is searched twice, and a verified profile is never re-assessed", async () => {
  const { needsDiscogsSoundcloudLookup } = await import("./discogsSoundcloud");
  const now = new Date("2026-11-20T00:00:00.000Z");
  const fresh = new Date("2027-01-01T00:00:00.000Z");
  const expired = new Date("2026-11-01T00:00:00.000Z");
  it.each([
    ["no cache row", undefined, true],
    ["expired row", { lookupStatus: "found", evidence: {}, expiresAt: expired }, true],
    ["fresh found, not yet assessed", { lookupStatus: "found", evidence: {}, expiresAt: fresh }, true],
    ["fresh found, assessed missing", { lookupStatus: "found", evidence: { soundcloud: { ...sc, verdict: "missing" } }, expiresAt: fresh }, false],
    ["fresh not found", { lookupStatus: "not_found", evidence: {}, expiresAt: fresh }, false],
    ["fresh ambiguous", { lookupStatus: "ambiguous", evidence: {}, expiresAt: fresh }, false],
    ["verified, even after expiry", { lookupStatus: "found", evidence: { soundcloud: sc }, expiresAt: expired }, false],
  ])("%s", (_label, row, expected) => {
    expect(needsDiscogsSoundcloudLookup(row, now)).toBe(expected);
  });
});

describe("keepDiscogsSoundcloud: a genre re-lookup never drops the verified profile of the same Discogs artist", async () => {
  const { keepDiscogsSoundcloud } = await import("./discogsSoundcloud");
  it("keeps it for the same Discogs artist", () => {
    expect(keepDiscogsSoundcloud({ discogsArtistId: 42, evidence: { old: 1, soundcloud: sc } }, { discogsArtistId: 42, evidence: { fresh: 2 } })).toEqual({ fresh: 2, soundcloud: sc });
  });
  it("drops it when the re-lookup found a different, or no, Discogs artist", () => {
    expect(keepDiscogsSoundcloud({ discogsArtistId: 42, evidence: { soundcloud: sc } }, { discogsArtistId: 7, evidence: { fresh: 2 } })).toEqual({ fresh: 2 });
    expect(keepDiscogsSoundcloud({ discogsArtistId: 42, evidence: { soundcloud: sc } }, { discogsArtistId: null, evidence: { fresh: 2 } })).toEqual({ fresh: 2 });
  });
  it("leaves a new assessment and a first lookup alone", () => {
    const newer = { ...sc, verdict: "missing" as const, profileUrl: null };
    expect(keepDiscogsSoundcloud({ discogsArtistId: 42, evidence: { soundcloud: sc } }, { discogsArtistId: 42, evidence: { soundcloud: newer } })).toEqual({ soundcloud: newer });
    expect(keepDiscogsSoundcloud(undefined, { discogsArtistId: 42, evidence: { fresh: 2 } })).toEqual({ fresh: 2 });
  });
});
