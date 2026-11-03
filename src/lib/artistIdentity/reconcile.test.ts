import { describe, expect, it } from "vitest";
import { normalizeSoundcloudUrl, reconcileAppearances, type ReconcileAppearance, type ReconcileArtist, type ReconcileInput } from "./reconcile";

const T0 = new Date("2026-11-02T10:00:00Z");
const T1 = new Date("2026-11-02T14:00:00Z");

function run(overrides: Partial<ReconcileInput>) {
  let n = 0;
  return reconcileAppearances({
    events: [],
    artists: [],
    appearances: [],
    soundcloudLinks: [],
    venueKeys: new Set(),
    now: T0,
    newArtistId: () => `art_${++n}`,
    ...overrides,
  });
}

const artist = (o: Partial<ReconcileArtist>): ReconcileArtist => ({ id: "art_x", displayName: "X", nameKey: "x", status: "auto", profileUrl: null, mergedIntoId: null, ...o });

const byKey = (upserts: ReconcileAppearance[], key: string) => upserts.find((u) => u.nameKey === key)!;

describe("reconcileAppearances", () => {
  it("creates an artist per new performer and splits B2B entries", () => {
    const r = run({ events: [{ id: "e1", title: "Night", artists: ["Kasper Bjørke", "KRÆ B2B KIRAKINGKONG", "TBA"] }] });
    expect(r.newArtists.map((a) => a.nameKey).sort()).toEqual(["kasper bjørke", "kirakingkong", "kræ"]);
    expect(byKey(r.upserts, "kasper bjørke")).toMatchObject({ confidence: "high", visibleSince: T0, confirmedAt: T0 });
    expect(byKey(r.upserts, "kirakingkong").confidence).toBe("high");
    expect(byKey(r.upserts, "kræ")).toMatchObject({ confidence: "review", confirmedAt: null }); // short name, nothing documents it yet
    expect(byKey(r.upserts, "tba")).toMatchObject({ confidence: "excluded", artistId: null });
  });

  it("a source profile link makes a short name high and documents it for reuse elsewhere", () => {
    const first = run({
      events: [{ id: "e1", title: "Night", artists: ["NAT", "Other Act"] }],
      soundcloudLinks: [{ eventId: "e1", artistName: "NAT", url: "https://soundcloud.com/Nat-DK" }],
    });
    expect(byKey(first.upserts, "nat")).toMatchObject({ confidence: "high", reason: "source profile link" });

    // Same artist billed elsewhere without a link: reuse the documented identity (G1 #2).
    const second = run({
      events: [{ id: "e2", title: "Other night", artists: ["NAT", "Someone Else"] }],
      artists: first.newArtists,
      appearances: first.upserts,
      soundcloudLinks: [{ eventId: "e1", artistName: "NAT", url: "https://soundcloud.com/nat-dk" }],
    });
    expect(byKey(second.upserts, "nat")).toMatchObject({ confidence: "high", reason: "short_generic: identity documented elsewhere" });
  });

  it("sends conflicting profiles for one name to review (LELE / LeLe)", () => {
    const first = run({
      events: [{ id: "e1", title: "A", artists: ["LELE", "Act One"] }],
      soundcloudLinks: [{ eventId: "e1", artistName: "LELE", url: "https://soundcloud.com/user-442274348" }],
    });
    const second = run({
      events: [{ id: "e2", title: "B", artists: ["LeLe", "Act Two"] }],
      artists: first.newArtists,
      appearances: first.upserts,
      soundcloudLinks: [
        { eventId: "e1", artistName: "LELE", url: "https://soundcloud.com/user-442274348" },
        { eventId: "e2", artistName: "LeLe", url: "https://soundcloud.com/user-339333395" },
      ],
    });
    expect(byKey(second.upserts, "lele")).toMatchObject({ confidence: "review", reason: "source profile differs from the artist's known profile" });
  });

  it("accepts an event title as artist only when documented by another source (G1 #1)", () => {
    const undocumented = run({ events: [{ id: "e1", title: "ERIC PRYDZ", artists: ["ERIC PRYDZ"] }] });
    expect(byKey(undocumented.upserts, "eric prydz")).toMatchObject({ confidence: "review", reason: "title_copy: identity not documented" });

    const prydz = artist({ id: "art_p", displayName: "Eric Prydz", nameKey: "eric prydz", status: "verified" });
    const documented = run({ events: [{ id: "e1", title: "ERIC PRYDZ", artists: ["ERIC PRYDZ"] }], artists: [prydz] });
    expect(byKey(documented.upserts, "eric prydz")).toMatchObject({ confidence: "high", artistId: "art_p" });
  });

  it("never links when several artists share a name", () => {
    const r = run({
      events: [{ id: "e1", title: "Night", artists: ["Nova Sound", "Act"] }],
      artists: [artist({ id: "a1", nameKey: "nova sound", disambiguation: null } as Partial<ReconcileArtist>), artist({ id: "a2", nameKey: "nova sound" })],
    });
    expect(byKey(r.upserts, "nova sound")).toMatchObject({ confidence: "review", artistId: null, reason: "several artists share this name" });
  });

  it("a requested artist links by name only for review, and is verified by a matching source profile", () => {
    const requested = artist({ id: "art_r", displayName: "Small Horse", nameKey: "small horse", status: "requested", profileUrl: "https://soundcloud.com/small-horse" });
    const byName = run({ events: [{ id: "e1", title: "N", artists: ["Small Horse", "Act"] }], artists: [requested] });
    expect(byKey(byName.upserts, "small horse")).toMatchObject({ confidence: "review", artistId: "art_r" });
    expect(byName.verifiedArtistIds).toEqual([]);

    const byProfile = run({
      events: [{ id: "e1", title: "N", artists: ["Small Horse", "Act"] }],
      artists: [{ ...requested }],
      soundcloudLinks: [{ eventId: "e1", artistName: "Small Horse", url: "https://soundcloud.com/Small-Horse" }],
    });
    expect(byKey(byProfile.upserts, "small horse")).toMatchObject({ confidence: "high", artistId: "art_r" });
    expect(byProfile.verifiedArtistIds).toEqual(["art_r"]);
  });

  it("keeps visibleSince and confirmedAt across runs, marks removals, and never resets on return", () => {
    const first = run({ events: [{ id: "e1", title: "N", artists: ["Kasper Bjørke", "Sexy Lazer"] }] });
    const removed = run({ events: [{ id: "e1", title: "N", artists: ["Kasper Bjørke"] }], artists: first.newArtists, appearances: first.upserts, now: T1 });
    expect(byKey(removed.upserts, "sexy lazer")).toMatchObject({ removedAt: T1, visibleSince: T0 });

    const stored = first.upserts.map((u) => (u.nameKey === "sexy lazer" ? { ...u, removedAt: T1 } : u));
    const back = run({ events: [{ id: "e1", title: "N", artists: ["Kasper Bjørke", "Sexy Lazer"] }], artists: first.newArtists, appearances: stored, now: new Date("2026-11-03T00:00:00Z") });
    expect(byKey(back.upserts, "sexy lazer")).toMatchObject({ removedAt: null, visibleSince: T0, confirmedAt: T0 });
    expect(back.newArtists).toEqual([]);
  });

  it("a later confirmation keeps the original visibility time (no historical alert is implied)", () => {
    const first = run({ events: [{ id: "e1", title: "N", artists: ["ENNA", "Act"] }] });
    expect(byKey(first.upserts, "enna")).toMatchObject({ confidence: "review", visibleSince: T0, confirmedAt: null });
    const confirmed = first.upserts.map((u) => (u.nameKey === "enna" ? { ...u, confidence: "confirmed" as const, confirmedAt: T1 } : u));
    const again = run({ events: [{ id: "e1", title: "N", artists: ["ENNA", "Act"] }], artists: first.newArtists, appearances: confirmed, now: new Date("2026-11-04T00:00:00Z") });
    expect(byKey(again.upserts, "enna")).toMatchObject({ confidence: "confirmed", visibleSince: T0, confirmedAt: T1 });
  });

  it("excludes venue names and never splits duo names", () => {
    const r = run({ events: [{ id: "e1", title: "N", artists: ["Culture Box", "Chase & Status"] }], venueKeys: new Set(["culture box"]) });
    expect(byKey(r.upserts, "culture box").confidence).toBe("excluded");
    expect(byKey(r.upserts, "chase & status").confidence).toBe("review");
  });
});

describe("normalizeSoundcloudUrl", () => {
  it("normalizes profile URLs and rejects anything else", () => {
    expect(normalizeSoundcloudUrl("https://www.SoundCloud.com/Nat-DK/")).toBe("https://soundcloud.com/nat-dk");
    expect(normalizeSoundcloudUrl("https://soundcloud.com/nat/sets/x")).toBeNull();
    expect(normalizeSoundcloudUrl("https://open.spotify.com/artist/abc")).toBeNull();
    expect(normalizeSoundcloudUrl(null)).toBeNull();
  });
});
