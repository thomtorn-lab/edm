import { describe, expect, it } from "vitest";
import { cueSubjects, identifyHeadliners, splitDescription, type EventHeadlinerInput } from "./eventHeadliners";

function input(overrides: Partial<EventHeadlinerInput>): EventHeadlinerInput {
  return { title: "Night", description: null, artists: [], imageUrl: null, canonicalSourceId: null, sourceIds: [], ...overrides };
}

// Culture Box, Fri 6 Nov 2026 — fetched read-only from culture-box.com
// (2026-10-16). Description = the night's own prose, then the room blocks
// cultureBoxAdapter appends; title = the adapter's room-lineup title.
const SARAH_WILD_NIGHT = input({
  title: "Black Box: SARAH WILD, PELZMAN, DJ SPICE · Red Box: DASHA, ANYA, FREDE [NO], JAN BRANDI",
  artists: ["SARAH WILD", "PELZMAN", "DJ SPICE", "DASHA", "ANYA", "FREDE [NO]", "JAN BRANDI"],
  description: [
    "Sarah Wild is back. Expect uplifting grooves and infectious energy at Culture Box.",
    "Born and raised in East-Germany, Sarah was always surrounded by music.",
    "Pelzman and DJ Spice join her in the Black Box, taking things deeper into the night.",
    "In Red Box, we celebrate the release of Jan Brandi's new EP, with Dasha and Anya Konda jetting in from London to join Jan himself and Frede [NO] behind the decks.",
    "Black Box\nSARAH WILD, PELZMAN, DJ SPICE",
    "Red Box\nDASHA, ANYA, FREDE [NO], JAN BRANDI",
  ].join("\n\n"),
  imageUrl: "https://culture-box.com/wp-content/uploads/2026/09/261106_culture_box_sarah_wild_event-kopi-1.jpg",
  canonicalSourceId: "src-culture-box",
  sourceIds: ["src-culture-box"],
});

// Culture Box, Sat 14 Nov 2026 (same read-only fetch). "ADELINA B2B LEANCA"
// is split into two lineup entries by the adapter.
const ANIMAL_TRAINER_NIGHT = input({
  title: "Black Box: ANIMAL TRAINER, MULO, KLARSKOV · Red Box: ADELINA, LEANCA, ANTOINE",
  artists: ["ANIMAL TRAINER", "MULO", "KLARSKOV", "ADELINA", "LEANCA", "ANTOINE"],
  description: [
    "Switzerland's Animal Trainer jets in to headline Culture Box.",
    "Mulo from Norway opens the Black Box and Klarskov rounds off the night. Red Box is taken over by rominimal sounds from early at night by Adelina B2B Leanca and Antoine.",
    "Black Box\nANIMAL TRAINER, MULO, KLARSKOV",
    "Red Box\nADELINA, LEANCA, ANTOINE",
  ].join("\n\n"),
  imageUrl: "https://culture-box.com/wp-content/uploads/2026/10/261114_culture_box_animal_trainer_event-kopi-1-1300x743.jpg",
  canonicalSourceId: "src-culture-box",
  sourceIds: ["src-culture-box"],
});

describe("identifyHeadliners — owner acceptance cases", () => {
  it("6 Nov: Sarah Wild is supported_prioritized from three independent groups, with no headline cue", () => {
    const r = identifyHeadliners(SARAH_WILD_NIGHT);
    expect(r.confidence).toBe("supported_prioritized");
    expect(r.headliners).toEqual(["SARAH WILD"]);
    expect(r.candidates.find((c) => c.artist === "SARAH WILD")?.independentGroups.sort()).toEqual(["asset", "order", "prose"]);
    expect(r.signals.some((s) => s.type === "description_headline_cue")).toBe(false);
    expect(r.flags).toEqual(expect.arrayContaining(["title_is_generated_lineup", "multi_room"]));
  });

  it("6 Nov: lineup order and room order count as ONE group, not two", () => {
    const r = identifyHeadliners(SARAH_WILD_NIGHT);
    const order = r.signals.filter((s) => s.artist === "SARAH WILD" && s.group === "order").map((s) => s.type);
    expect(order.sort()).toEqual(["lineup_first", "main_room_first"]);
    expect(r.candidates.find((c) => c.artist === "SARAH WILD")?.independentGroups.filter((g) => g === "order")).toHaveLength(1);
  });

  it("14 Nov: Animal Trainer is documented by the venue's own \"jets in to headline\" sentence", () => {
    const r = identifyHeadliners(ANIMAL_TRAINER_NIGHT);
    expect(r).toMatchObject({ confidence: "documented", headliners: ["ANIMAL TRAINER"] });
    expect(r.signals.find((s) => s.type === "description_headline_cue")?.excerpt).toBe("Switzerland's Animal Trainer jets in to headline Culture Box.");
    expect(r.flags).toContain("b2b_split");
  });

  it("Poolen Intercell: a title copied into the lineup is documented but flagged for review", () => {
    const r = identifyHeadliners(
      input({ title: "Intercell", artists: ["Intercell", "Luke Slater", "Rene Wise"], canonicalSourceId: "src-poolen", sourceIds: ["src-poolen"] }),
    );
    expect(r.headliners).toEqual(["Intercell"]);
    expect(r.flags).toEqual(expect.arrayContaining(["title_is_lineup_entry", "structured_role_not_stored"]));
  });
});

describe("identifyHeadliners — supporting signals are never proof on their own", () => {
  it("poster file name alone is not enough", () => {
    const r = identifyHeadliners(input({ artists: ["Opener", "Big Name"], imageUrl: "https://x.dk/uploads/big_name_poster.jpg" }));
    expect(r.confidence).toBe("supported_insufficient");
    expect(r.headliners).toEqual([]);
  });

  it("lineup order alone is not enough", () => {
    expect(identifyHeadliners(input({ artists: ["First Act", "Second Act"] })).confidence).toBe("supported_insufficient");
  });

  it("two independent groups (order + poster) for the same name are enough", () => {
    const r = identifyHeadliners(input({ artists: ["Big Name", "Opener"], imageUrl: "https://x.dk/uploads/261106_big_name.jpg" }));
    expect(r).toMatchObject({ confidence: "supported_prioritized", headliners: ["Big Name"] });
  });

  it("two names each with two groups is a conflict, not a choice", () => {
    const r = identifyHeadliners(
      input({
        artists: ["Alpha Name", "Bravo Name"],
        imageUrl: "https://x.dk/uploads/alpha_name_bravo_name.jpg",
        description: "Bravo Name returns to Copenhagen.",
      }),
    );
    expect(r.confidence).toBe("supported_insufficient");
    expect(r.flags).toContain("conflicting_support");
  });

  it("a strong signal for another name beats supporting signals", () => {
    const r = identifyHeadliners(
      input({
        artists: ["Opener Act", "Real Headliner"],
        imageUrl: "https://x.dk/uploads/opener_act.jpg",
        description: "Real Headliner headlines the night, with Opener Act warming up.",
      }),
    );
    expect(r).toMatchObject({ confidence: "documented", headliners: ["Real Headliner"] });
  });

  it("ignores lineup order when the lineup is alphabetical", () => {
    const r = identifyHeadliners(input({ artists: ["Alpha", "Bravo", "Charlie", "Delta"] }));
    expect(r.flags).toContain("lineup_alphabetical");
    expect(r.signals.some((s) => s.type === "lineup_first")).toBe(false);
  });
});

describe("identifyHeadliners — strong signals", () => {
  it("a title naming two of three performers gives two equal headliners", () => {
    const r = identifyHeadliners(input({ title: "Chase & Status + support", artists: ["Chase & Status", "Opener", "Third"] }));
    expect(r.headliners).toEqual(["Chase & Status"]);
    const two = identifyHeadliners(input({ title: "Alpha Act & Bravo Act", artists: ["Alpha Act", "Bravo Act", "Warm Up"] }));
    expect(two).toMatchObject({ confidence: "documented", headliners: ["Alpha Act", "Bravo Act"] });
    expect(two.flags).toContain("equal_headliners");
  });

  it("matches the Danish cue \"hovednavn\"", () => {
    const r = identifyHeadliners(input({ artists: ["Opener", "Kasper Bjørke"], description: "Aftenens hovednavn er Kasper Bjørke." }));
    expect(r).toMatchObject({ confidence: "documented", headliners: ["Kasper Bjørke"] });
  });

  it("Billetto's headliners field counts only as sole source with at most 3 names", () => {
    const ok = identifyHeadliners(input({ artists: ["Act One", "Act Two"], canonicalSourceId: "src-billetto", sourceIds: ["src-billetto"] }));
    expect(ok).toMatchObject({ confidence: "documented", headliners: ["Act One", "Act Two"] });
    const many = identifyHeadliners(input({ artists: ["A1 Act", "A2 Act", "A3 Act", "A4 Act"], canonicalSourceId: "src-billetto", sourceIds: ["src-billetto"] }));
    expect(many.flags).toContain("billetto_headliners_unverified");
    expect(many.signals.some((s) => s.type === "structured_source_field")).toBe(false);
    const shared = identifyHeadliners(input({ artists: ["Act One", "Act Two"], canonicalSourceId: "src-billetto", sourceIds: ["src-billetto", "src-kultunaut"] }));
    expect(shared.flags).toContain("billetto_headliners_unverified");
  });

  it("a single performer is the headliner", () => {
    expect(identifyHeadliners(input({ artists: ["Solo Act"] }))).toMatchObject({ confidence: "documented", headliners: ["Solo Act"] });
  });

  it("never treats a non-artist entry as a performer", () => {
    const r = identifyHeadliners(input({ title: "Karrusel 2027", artists: ["Karrusel 2027", "Real Act"] }));
    expect(r.headliners).toEqual(["Real Act"]);
    expect(r.flags).toContain("excluded_not_artist");
  });

  it("flags a festival-sized lineup", () => {
    const artists = Array.from({ length: 12 }, (_, i) => `Artist ${String.fromCharCode(90 - i)}`);
    expect(identifyHeadliners(input({ artists })).flags).toContain("festival_like");
  });
});

describe("splitDescription", () => {
  it("separates the venue's prose from the adapter's room blocks", () => {
    const { prose, rooms } = splitDescription(SARAH_WILD_NIGHT.description, SARAH_WILD_NIGHT.artists);
    expect(rooms.map((r) => r.room)).toEqual(["Black Box", "Red Box"]);
    expect(prose).not.toContain("Black Box\nSARAH WILD");
    expect(prose.startsWith("Sarah Wild is back.")).toBe(true);
  });

  it("keeps a two-line paragraph that is not a lineup as prose", () => {
    expect(splitDescription("Doors\n23:00 until late", ["Some Act"]).prose).toBe("Doors\n23:00 until late");
  });
});

describe("cueSubjects", () => {
  it.each([
    ["Switzerland's Animal Trainer jets in to headline Culture Box.", ["Animal Trainer", "Mulo"], ["Animal Trainer"]],
    ["Real Headliner headlines the night, with Opener Act warming up.", ["Opener Act", "Real Headliner"], ["Real Headliner"]],
    ["Aftenens hovednavn er Kasper Bjørke, mens Opener varmer op.", ["Opener", "Kasper Bjørke"], ["Kasper Bjørke"]],
    ["Alpha Act and Bravo Act headline the main room.", ["Alpha Act", "Bravo Act", "Warm Up"], ["Alpha Act", "Bravo Act"]],
    ["Warm Up opens, before Alpha Act b2b Bravo Act headline.", ["Alpha Act", "Bravo Act", "Warm Up"], ["Alpha Act", "Bravo Act"]],
    ["No cue in this sentence about Alpha Act.", ["Alpha Act"], []],
  ])("%s", (sentence, performers, expected) => {
    expect(cueSubjects(sentence, performers)).toEqual(expected);
  });
});
