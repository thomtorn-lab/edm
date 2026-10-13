import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acceptedLinksByCandidate, classifyLineupLinks, soundcloudProfileUrl, type LineupLinkObservation } from "./cultureBoxSoundcloudLinks";
import { parseCultureBoxEventsHtml } from "./cultureBoxAdapter";
import { planSoundcloudLinkChanges, storedArtistName } from "../soundcloudLinks";

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
  const links = (date: string) => night(date).soundcloudLinkReport!.links.map((l) => `${l.name} -> ${l.url.replace("https://soundcloud.com/", "")}`);

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
      for (const l of n.soundcloudLinkReport!.links) expect(n.artists, `${n.title}: ${l.name}`).toContain(l.name);
    }
  });

  it("drops the venue's podcast episodes and label accounts; keeps Rós's profile despite her podcast link on 13 Nov", () => {
    const all = nights.flatMap((n) => n.soundcloudLinkReport!.links);
    const names = all.map((l) => l.name);
    for (const dropped of ["GALATIUS", "DENIZE", "FREDE [NO]", "YOON", "CHICH", "EMOK"]) expect(names).not.toContain(dropped);
    expect(links("2026-11-13")).not.toContain("RÓS -> mariarosstefansdottir");
    expect(links("2026-12-31")).toContain("RÓS -> mariarosstefansdottir");
    expect(all.every((l) => /^https:\/\/soundcloud\.com\/[a-z0-9_-]+$/.test(l.url))).toBe(true);
  });

  it("covers the programme: 95 accepted night/artist links across all 16 nights", () => {
    expect(nights).toHaveLength(16);
    expect(nights.every((n) => Array.isArray(n.soundcloudLinkReport?.links))).toBe(true);
    expect(nights.reduce((sum, n) => sum + n.soundcloudLinkReport!.links.length, 0)).toBe(95);
  });
});

describe("absenceDocumented — only a completely parsed night may justify deleting a stored link", () => {
  const html = readFileSync(path.join(__dirname, "__fixtures__", "culture-box-events-2026-10-13.html"), "utf-8");

  /** The listing with only the 17 October article's markup changed by `mutate`. */
  function withOct17(mutate: (articleHtml: string) => string): string {
    const start = html.indexOf("SAT 17 OCTOBER 2026");
    const articleStart = html.lastIndexOf("<article", start);
    const articleEnd = html.indexOf("</article>", start);
    const mutated = mutate(html.slice(articleStart, articleEnd));
    expect(mutated).not.toBe(html.slice(articleStart, articleEnd)); // the mutation really applied
    return html.slice(0, articleStart) + mutated + html.slice(articleEnd);
  }

  function reports(listing: string) {
    const nights = parseCultureBoxEventsHtml(listing);
    const oct17 = nights.find((n) => n.startDatetime?.startsWith("2026-10-17"))!;
    const others = nights.filter((n) => n !== oct17);
    return { oct17: oct17.soundcloudLinkReport!, others: others.map((n) => n.soundcloudLinkReport!) };
  }

  it("every night of both real recorded listings is fully parsed", () => {
    for (const file of ["culture-box-events.html", "culture-box-events-2026-10-13.html"]) {
      const nights = parseCultureBoxEventsHtml(readFileSync(path.join(__dirname, "__fixtures__", file), "utf-8"));
      expect(nights.length).toBeGreaterThan(0);
      for (const n of nights) expect(n.soundcloudLinkReport!.absenceDocumented, `${file}: ${n.title}`).toBe(true);
    }
  });

  it.each([
    [
      "an anchor lost its href",
      (a: string) => a.replace('<a href="https://soundcloud.com/borgosounds"', "<a"),
      ["BORGO"],
    ],
    [
      "a name is wrapped in extra markup inside its anchor",
      (a: string) => a.replace(/(<a href="https:\/\/soundcloud\.com\/borgosounds"[^>]*>)BORGO<\/a>/, "$1<strong>BORGO</strong></a>"),
      ["BORGO"],
    ],
    [
      "a room's lineup continues in a second paragraph",
      (a: string) => a.replace(/(<a href="https:\/\/soundcloud\.com\/borgosounds"[^>]*>BORGO<\/a>)/, "$1</p><p>"),
      ["MARSANS", "ANEXA"],
    ],
    [
      "a room block lost its heading and is skipped",
      (a: string) => a.replace(/<h3[^>]*>Red Box<\/h3>/, ""),
      ["LUCA ABAYAN", "BORGO", "MARSANS", "ANEXA"],
    ],
  ])("%s: that night is NOT documented, every other night still is, and its still-readable links are kept", (_label, mutate, missing) => {
    const { oct17, others } = reports(withOct17(mutate));
    expect(oct17.absenceDocumented).toBe(false);
    expect(others.every((r) => r.absenceDocumented)).toBe(true);
    const names = oct17.links.map((l) => l.name);
    for (const name of missing) expect(names).not.toContain(name);
    expect(names).toContain("KEVIN DI SERNA"); // positive evidence from the rest of the night still counts
  });

  it("REGRESSION (end to end): a partly parsed 17 October deletes none of its stored links, while other nights still reconcile normally", () => {
    const byNight = (listing: string) =>
      new Map(parseCultureBoxEventsHtml(listing).map((n) => [n.startDatetime!.slice(0, 10), n.soundcloudLinkReport!]));
    // Everything a clean run stored, keyed by night as the event id.
    const stored = [...byNight(html)].flatMap(([eventId, r]) => r.links.map((l) => ({ eventId, artistName: storedArtistName(l.name)!, url: l.url })));
    // Next run: 17 Oct lost BORGO's href (partial parse); 23 Oct genuinely dropped ANDERS HP.
    const next = withOct17((a) => a.replace('<a href="https://soundcloud.com/borgosounds"', "<a"));
    const oct23 = next.indexOf("FRI 23 OCTOBER 2026");
    const nextListing =
      next.slice(0, oct23) + next.slice(oct23).replace(/<br \/>\s*<a href="https:\/\/soundcloud\.com\/anders_hp"[^>]*>ANDERS HP<\/a>/, "");
    expect(nextListing).not.toBe(next);

    const plan = planSoundcloudLinkChanges(stored, byNight(nextListing));
    expect(plan.deletes).toEqual([{ eventId: "2026-10-23", artistName: "ANDERS HP" }]);
    expect(plan.suppressedDeletes).toBe(1); // BORGO on 17 Oct kept
    expect(plan.upserts).toEqual([]);
  });

  it("a night whose lineup has no anchors at all is not documented (indistinguishable from a broken parse)", () => {
    const { oct17 } = reports(withOct17((a) => a.replace(/<a href="https:\/\/soundcloud\.com\/[^"]*"[^>]*>([^<]*)<\/a>/g, "$1")));
    expect(oct17).toEqual({ links: [], absenceDocumented: false });
  });

  it("a night where the venue removed one artist from the lineup is documented — that removal may delete the stored link", () => {
    const { oct17 } = reports(withOct17((a) => a.replace(/<a href="https:\/\/soundcloud\.com\/borgosounds"[^>]*>BORGO<\/a><br \/>\s*/, "")));
    expect(oct17.absenceDocumented).toBe(true);
    expect(oct17.links.map((l) => l.name)).not.toContain("BORGO");
  });
});
