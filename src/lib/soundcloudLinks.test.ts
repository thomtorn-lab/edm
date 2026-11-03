import { describe, expect, it } from "vitest";
import { planSoundcloudLinkChanges, selectLineupSoundcloudLinks, selectReusedSoundcloudProfiles, storedArtistName, type StoredSoundcloudLink } from "./soundcloudLinks";
import type { ArtistSoundcloudLink, SoundcloudLinkReport } from "./adapters/types";

const GUY_J = { name: "GUY J", url: "https://soundcloud.com/guy-j" };
const TIM = { name: "TIM ANDRESEN", url: "https://soundcloud.com/tim-andresen" };
const row = (eventId: string, artistName: string, url: string): StoredSoundcloudLink => ({ eventId, artistName, url });
/** Completely parsed nights (absence documented), unless given as a full report. */
const observed = (entries: [string, ArtistSoundcloudLink[] | SoundcloudLinkReport][]) =>
  new Map(entries.map(([id, v]) => [id, Array.isArray(v) ? { links: v, absenceDocumented: true } : v]));
const partial = (...links: ArtistSoundcloudLink[]): SoundcloudLinkReport => ({ links, absenceDocumented: false });

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

  it("REGRESSION: a partly parsed night never loses links because OTHER nights parsed fine and carry links", () => {
    const plan = planSoundcloudLinkChanges(
      [row("e-partial", "GUY J", GUY_J.url), row("e-partial", "TIM ANDRESEN", TIM.url), row("e-ok", "ALX", "https://soundcloud.com/alx")],
      observed([
        ["e-partial", partial(GUY_J)], // TIM's anchor wasn't readable this run
        ["e-ok", [TIM]], // fully parsed, and the venue replaced ALX
      ]),
    );
    expect(plan.deletes).toEqual([{ eventId: "e-ok", artistName: "ALX" }]);
    expect(plan.suppressedDeletes).toBe(1);
    expect(plan.upserts).toEqual([row("e-ok", "TIM ANDRESEN", TIM.url)]);
  });

  it("a partly parsed night still adds and updates the links it could read", () => {
    const plan = planSoundcloudLinkChanges([row("e-1", "GUY J", "https://soundcloud.com/old")], observed([["e-1", partial(GUY_J, TIM)]]));
    expect(plan.upserts).toEqual([row("e-1", "GUY J", GUY_J.url), row("e-1", "TIM ANDRESEN", TIM.url)]);
    expect(plan.deletes).toEqual([]);
  });

  it("a partly parsed night with no readable link keeps everything stored", () => {
    const plan = planSoundcloudLinkChanges([row("e-1", "GUY J", GUY_J.url)], observed([["e-1", partial()], ["e-2", [TIM]]]));
    expect(plan.deletes).toEqual([]);
    expect(plan.suppressedDeletes).toBe(1);
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

describe("selectReusedSoundcloudProfiles — one artist's verified profile reused across events (Artist Alerts identities)", () => {
  const REXIE = "https://soundcloud.com/rexie_lex";

  it("an artist with exactly one profile on its other appearances gets it here, under this event's lineup name", () => {
    expect(
      selectReusedSoundcloudProfiles([
        { lineupEntry: "Rexie Lex", otherEntry: "REXIE LEX", url: REXIE },
        { lineupEntry: "Rexie Lex", otherEntry: "REXIE LEX", url: REXIE }, // same profile on two other nights
      ]),
    ).toEqual([{ artistName: "Rexie Lex", url: REXIE }]);
  });

  it("an artist with two different profiles gets none (LELE/LeLe shape)", () => {
    expect(
      selectReusedSoundcloudProfiles([
        { lineupEntry: "LELE", otherEntry: "LELE", url: "https://soundcloud.com/user-442274348" },
        { lineupEntry: "LELE", otherEntry: "LeLe", url: "https://soundcloud.com/user-339333395" },
      ]),
    ).toEqual([]);
  });

  it("a B2B entry, here or on the other event, never gets or gives a single artist's profile", () => {
    expect(selectReusedSoundcloudProfiles([{ lineupEntry: "NAT b2b YOON", otherEntry: "YOON", url: "https://soundcloud.com/yoon" }])).toEqual([]);
    expect(selectReusedSoundcloudProfiles([{ lineupEntry: "YOON", otherEntry: "NAT b2b YOON", url: "https://soundcloud.com/yoon" }])).toEqual([]);
  });

  it("the event's own link always wins over a reused one", () => {
    const reused = selectReusedSoundcloudProfiles([{ lineupEntry: "GUY J", otherEntry: "GUY J", url: "https://soundcloud.com/old" }]);
    expect(selectLineupSoundcloudLinks(["GUY J"], [...reused, { artistName: "GUY J", url: GUY_J.url }])).toEqual([GUY_J]);
  });
});
