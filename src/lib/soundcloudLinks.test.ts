import { describe, expect, it } from "vitest";
import { planSoundcloudLinkChanges, selectLineupSoundcloudLinks, storedArtistName, type StoredSoundcloudLink } from "./soundcloudLinks";
import type { ArtistSoundcloudLink } from "./adapters/types";

const GUY_J = { name: "GUY J", url: "https://soundcloud.com/guy-j" };
const TIM = { name: "TIM ANDRESEN", url: "https://soundcloud.com/tim-andresen" };
const row = (eventId: string, artistName: string, url: string): StoredSoundcloudLink => ({ eventId, artistName, url });
const observed = (entries: [string, ArtistSoundcloudLink[]][]) => new Map(entries);

describe("planSoundcloudLinkChanges — sync", () => {
  it("first sync inserts every observed link", () => {
    const plan = planSoundcloudLinkChanges([], observed([["e-1", [GUY_J, TIM]]]));
    expect(plan.upserts).toEqual([row("e-1", "GUY J", GUY_J.url), row("e-1", "TIM ANDRESEN", TIM.url)]);
    expect(plan.deletes).toEqual([]);
  });

  it("an unchanged night writes nothing", () => {
    const plan = planSoundcloudLinkChanges([row("e-1", "GUY J", GUY_J.url)], observed([["e-1", [GUY_J]]]));
    expect(plan).toEqual({ upserts: [], deletes: [], suppressedDeletes: 0 });
  });

  it("a changed profile URL for the same name is updated", () => {
    const plan = planSoundcloudLinkChanges([row("e-1", "GUY J", "https://soundcloud.com/old")], observed([["e-1", [GUY_J]]]));
    expect(plan.upserts).toEqual([row("e-1", "GUY J", GUY_J.url)]);
  });

  it("deletes a link only when a parsed night no longer carries it (venue removed the link or the artist)", () => {
    const plan = planSoundcloudLinkChanges(
      [row("e-1", "GUY J", GUY_J.url), row("e-1", "TIM ANDRESEN", TIM.url)],
      observed([["e-1", [GUY_J]]]),
    );
    expect(plan.deletes).toEqual([{ eventId: "e-1", artistName: "TIM ANDRESEN" }]);
  });

  it("never touches events the run did not observe (fetch/parse failure for that night, nights no longer listed)", () => {
    const plan = planSoundcloudLinkChanges([row("e-other", "GUY J", GUY_J.url)], observed([["e-1", [TIM]]]));
    expect(plan.deletes).toEqual([]);
    expect(plan.upserts).toEqual([row("e-1", "TIM ANDRESEN", TIM.url)]);
  });

  it("keeps stored links when the whole run saw no acceptable link (page-structure change / broken parse)", () => {
    const plan = planSoundcloudLinkChanges(
      [row("e-1", "GUY J", GUY_J.url), row("e-2", "TIM ANDRESEN", TIM.url)],
      observed([
        ["e-1", []],
        ["e-2", []],
      ]),
    );
    expect(plan.deletes).toEqual([]);
    expect(plan.suppressedDeletes).toBe(2);
  });

  it("an empty night is documented absence when the same run did see links elsewhere", () => {
    const plan = planSoundcloudLinkChanges([row("e-1", "GUY J", GUY_J.url)], observed([["e-1", []], ["e-2", [TIM]]]));
    expect(plan.deletes).toEqual([{ eventId: "e-1", artistName: "GUY J" }]);
  });

  it("stores names the way the pipeline stores lineup names (zero-width chars, trailing space), once per name", () => {
    const plan = planSoundcloudLinkChanges([], observed([["e-1", [{ name: "GUY\u200B J ", url: GUY_J.url }, GUY_J]]]));
    expect(plan.upserts).toEqual([row("e-1", "GUY J", GUY_J.url)]);
    expect(storedArtistName("   ")).toBeNull();
  });
});

describe("selectLineupSoundcloudLinks — what a page shows", () => {
  const rows = [
    { artistName: "TIM ANDRESEN", url: TIM.url },
    { artistName: "GUY J", url: GUY_J.url },
    { artistName: "ALX", url: "https://soundcloud.com/alx" },
  ];

  it("only names in the event's own current lineup, in lineup order", () => {
    expect(selectLineupSoundcloudLinks(["GUY J", "SOMEONE", "TIM ANDRESEN"], rows)).toEqual([GUY_J, TIM]);
  });

  it("an admin-edited lineup is respected as-is: removed or renamed names show nothing", () => {
    expect(selectLineupSoundcloudLinks(["Guy J", "TIM ANDRESEN"], rows)).toEqual([TIM]);
    expect(selectLineupSoundcloudLinks([], rows)).toEqual([]);
  });

  it("a name repeated in the lineup is listed once", () => {
    expect(selectLineupSoundcloudLinks(["GUY J", "GUY J"], rows)).toEqual([GUY_J]);
  });
});
