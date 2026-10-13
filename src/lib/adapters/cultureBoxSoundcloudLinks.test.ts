import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acceptedLinksByCandidate, classifyLineupLinks, soundcloudProfileUrl, type LineupLinkObservation } from "./cultureBoxSoundcloudLinks";
import { parseCultureBoxEventsHtml } from "./cultureBoxAdapter";

const obs = (candidateIndex: number, name: string, href: string): LineupLinkObservation => ({ candidateIndex, name, href });

describe("soundcloudProfileUrl — what counts as an artist profile link", () => {
  it.each([
    ["https://soundcloud.com/guy-j", "https://soundcloud.com/guy-j"],
    ["https://www.soundcloud.com/Guy-J/", "https://soundcloud.com/guy-j"],
    ["http://m.soundcloud.com/rexie_lex?utm_source=x#top", "https://soundcloud.com/rexie_lex"],
    ["https://soundcloud.com/user-339333395", "https://soundcloud.com/user-339333395"],
  ])("accepts %s as %s", (href, url) => {
    expect(soundcloudProfileUrl(href)).toEqual({ url });
  });

  it.each([
    ["https://soundcloud.com/cultureboxcopenhagen/culture-box-podcast-141", "not-a-profile"],
    ["https://soundcloud.com/guy-j/sets/live", "not-a-profile"],
    ["https://soundcloud.com/guy-j/some-track", "not-a-profile"],
    ["https://soundcloud.com/", "not-a-profile"],
    ["https://on.soundcloud.com/AbC123", "not-soundcloud"],
    ["https://www.instagram.com/guyj", "not-soundcloud"],
    ["https://soundcloud.com.evil.example/guy-j", "not-soundcloud"],
    ["javascript:alert(1)", "not-soundcloud"],
    ["not a url", "not-soundcloud"],
    ["https://soundcloud.com/discover", "reserved-path"],
    ["https://soundcloud.com/cultureboxcopenhagen", "venue-account"],
    ["https://soundcloud.com/modulhertz-rec", "label-or-organisation"],
    ["https://soundcloud.com/ibogarecords", "label-or-organisation"],
    ["https://soundcloud.com/some-label-music", "label-or-organisation"],
    ["https://soundcloud.com/rinse-radio", "label-or-organisation"],
  ])("rejects %s (%s)", (href, reason) => {
    expect(soundcloudProfileUrl(href)).toEqual({ rejected: reason });
  });
});

describe("classifyLineupLinks — conflicts across the whole listing", () => {
  it("a rejected podcast/track link never disqualifies the same name's profile on another night", () => {
    const result = classifyLineupLinks([
      obs(0, "RÓS", "https://soundcloud.com/cultureboxcopenhagen/culture-box-podcast-134-ros"),
      obs(1, "RÓS", "https://soundcloud.com/mariarosstefansdottir"),
    ]);
    expect(result.map((r) => r.status)).toEqual(["rejected", "accepted"]);
  });

  it("a label link never disqualifies the same name's profile on another night", () => {
    const result = classifyLineupLinks([obs(0, "CHICH", "https://soundcloud.com/modulhertz-rec"), obs(1, "CHICH", "https://soundcloud.com/chich")]);
    expect(result.map((r) => r.status)).toEqual(["rejected", "accepted"]);
  });

  it("one name linked to two different profiles is a real conflict: rejected on every night", () => {
    const result = classifyLineupLinks([
      obs(0, "NAT", "https://soundcloud.com/nat-sk"),
      obs(1, "NAT", "https://soundcloud.com/natdj"),
      obs(2, "Nat", "https://soundcloud.com/nat-sk"),
    ]);
    expect(result.every((r) => r.status === "rejected" && r.reason === "conflicting-profiles")).toBe(true);
  });

  it("one profile linked to two different names is rejected for both", () => {
    const result = classifyLineupLinks([obs(0, "ARTIST A", "https://soundcloud.com/shared"), obs(0, "ARTIST B", "https://soundcloud.com/shared")]);
    expect(result.every((r) => r.status === "rejected" && r.reason === "shared-profile")).toBe(true);
  });

  it("the same name and profile on several nights is consistent, not a conflict", () => {
    const result = classifyLineupLinks([
      obs(0, "TIM ANDRESEN", "https://soundcloud.com/tim-andresen"),
      obs(3, "TIM ANDRESEN", "https://www.soundcloud.com/tim-andresen/"),
    ]);
    expect(result.map((r) => r.status)).toEqual(["accepted", "accepted"]);
  });

  it("acceptedLinksByCandidate gives every candidate an entry, one link per name", () => {
    const classified = classifyLineupLinks([obs(0, "GUY J", "https://soundcloud.com/guy-j"), obs(0, "GUY J", "https://soundcloud.com/guy-j")]);
    expect(acceptedLinksByCandidate(classified, 2)).toEqual([[{ name: "GUY J", url: "https://soundcloud.com/guy-j" }], []]);
  });
});

describe("against the real recorded Culture Box listing (culture-box-events-2026-10-13.html)", () => {
  // Real, unmodified recording of https://culture-box.com/events/ fetched 2026-10-13.
  const html = readFileSync(path.join(__dirname, "__fixtures__", "culture-box-events-2026-10-13.html"), "utf-8");
  const nights = parseCultureBoxEventsHtml(html);
  const night = (date: string) => nights.find((n) => n.startDatetime?.startsWith(date))!;
  const links = (date: string) => night(date).artistSoundcloudLinks!.map((l) => `${l.name} -> ${l.url.replace("https://soundcloud.com/", "")}`);

  it("17 October (WHAT HAPPENS / PERCEPTIONS): all seven linked artists, in lineup order", () => {
    expect(links("2026-10-17")).toEqual([
      "KEVIN DI SERNA -> kevindiserna",
      "TIM ANDRESEN -> tim-andresen",
      "ALBANO BASTONERO -> albano-bastonero",
      "LUCA ABAYAN -> lucaf",
      "BORGO -> borgosounds",
      "MARSANS -> marsans-music",
      "ANEXA -> candela-antuna",
    ]);
  });

  it("every link name is a name in that night's own lineup", () => {
    for (const n of nights) {
      for (const l of n.artistSoundcloudLinks!) expect(n.artists, `${n.title}: ${l.name}`).toContain(l.name);
    }
  });

  it("drops the venue's podcast episodes and label accounts; keeps Rós's profile despite her podcast link on 13 Nov", () => {
    const all = nights.flatMap((n) => n.artistSoundcloudLinks!);
    const names = all.map((l) => l.name);
    for (const dropped of ["GALATIUS", "DENIZE", "FREDE [NO]", "YOON", "CHICH", "EMOK"]) expect(names).not.toContain(dropped);
    expect(links("2026-11-13")).not.toContain("RÓS -> mariarosstefansdottir");
    expect(links("2026-12-31")).toContain("RÓS -> mariarosstefansdottir");
    expect(all.every((l) => /^https:\/\/soundcloud\.com\/[a-z0-9_-]+$/.test(l.url))).toBe(true);
  });

  it("covers the programme: 95 accepted night/artist links across all 16 nights", () => {
    expect(nights).toHaveLength(16);
    expect(nights.every((n) => Array.isArray(n.artistSoundcloudLinks))).toBe(true);
    expect(nights.reduce((sum, n) => sum + n.artistSoundcloudLinks!.length, 0)).toBe(95);
  });
});
