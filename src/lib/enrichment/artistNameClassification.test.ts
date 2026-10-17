import { describe, expect, it } from "vitest";
import { classifyArtistName } from "./artistNameClassification";

describe("classifyArtistName — legitimate artist names are never flagged", () => {
  // Real acts whose names look like the patterns below: duo names with a
  // single "&", names with digits, a bare year, all-caps lineup spelling,
  // trailing-bracket annotations, and every name that held an accepted
  // YouTube match in the 2026-10 batches.
  const protectedNames = [
    "Above & Beyond",
    "Chase & Status",
    "Camo & Krooked",
    "Sly & Robbie",
    "Vini Vici",
    "2manydjs",
    "MCR-T",
    "MCR-T [Live From Earth]",
    "Jamie xx",
    "JAMIE XX",
    "!!!",
    "Fred again..",
    "DJ Koze",
    "Kölsch",
    "1991",
    "Sub Focus",
    "Oliver Koletzki [Stil vor Talent]",
    "Mac Declos (all night long)",
    "xenia (support)",
    "Jai Taylor (AU)",
    "Saidah",
    "DASHA",
    "CØKIT",
    "ONSBERG",
    "Cassie Raptor",
    "Icona Pop",
    "Intercell",
    "ADELINA",
    "Miley Serious",
    "Luke Slater",
    "Oscar Mulero",
    "SIMONE ZINO",
    "Trinix",
    "EZEQUIEL PERINI",
    "GUY J",
    "DJ Fuckoff",
    "I HATE MODELS",
    "Sub Zero project",
    "TICON & VINI VICI",
    "Dengue Dengue Dengue",
    "Morcheeba",
    "Meute",
  ];
  it.each(protectedNames)("%s → ok", (name) => {
    expect(classifyArtistName(name)).toMatchObject({ verdict: "ok", rules: [] });
  });
});

describe("classifyArtistName — known non-artist entries from the 2026-10-13 backlog", () => {
  it.each([
    ["Karrusel 2027", "event_year"],
    ["Relevance 2027 - Ten Year Anniversary", "event_year"],
    ["IBOGA 30 years", "anniversary"],
    ["Neelix & friends", "and_friends"],
    ["PLASTIK FUNK AND MORE", "and_friends"],
    ["DJs", "generic_label"],
    ["Electro Shock Therapy @ Basement", "venue_marker"],
    ["District 909 - No. 002", "series_number"],
    ["Xuri & John Clewort DK & Gábor Lázár HU", "multi_artist_list"],
    ["TBA", "placeholder"],
  ] as const)("%s → not_artist (%s)", (name, rule) => {
    const result = classifyArtistName(name);
    expect(result.verdict).toBe("not_artist");
    expect(result.rules).toContain(rule);
  });

  it("does not claim to catch event titles that carry no structural signal", () => {
    // Documented limit: these are almost certainly event titles, but nothing
    // in the string itself separates them from a real act's name, so a
    // narrow rule must leave them alone (source-level fixes handle them).
    expect(classifyArtistName("Shrek Rave").verdict).toBe("ok");
    expect(classifyArtistName("Electro Werkz").verdict).toBe("ok");
  });
});

describe("classifyArtistName — real names with source decoration are cleanable, never skipped", () => {
  it.each([
    ["Byetone DE", ["country_code_suffix"]],
    ["Amelie Duchow DE", ["country_code_suffix"]],
    ["La Tène FR/CH", ["country_code_suffix"]],
    ["Dengue Dengue Dengue PE – NEW DATE", ["status_tag", "country_code_suffix"]],
  ] as const)("%s → cleanable %j", (name, rules) => {
    expect(classifyArtistName(name)).toMatchObject({ verdict: "cleanable", rules: [...rules] });
  });

  it("never reads a two-letter tail as a country code in an all-caps entry", () => {
    expect(classifyArtistName("JAMIE XX").verdict).toBe("ok");
    expect(classifyArtistName("SOMEONE DE").verdict).toBe("ok");
  });

  it("only treats real ISO country codes as a suffix", () => {
    expect(classifyArtistName("Daniel Avery XY").verdict).toBe("ok");
  });

  it("classifies a status tag with no name in front of it as not an artist", () => {
    expect(classifyArtistName("NEW DATE").verdict).toBe("not_artist");
  });
});

describe("classifyArtistName — computes on the matcher's own cleaned name", () => {
  it("strips trailing bracket annotations first, exactly like the matcher", () => {
    expect(classifyArtistName("Oliver Koletzki [Stil vor Talent]").cleanedName).toBe("Oliver Koletzki");
  });
});
