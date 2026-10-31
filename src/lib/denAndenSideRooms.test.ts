import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeRooms,
  isDenAndenSideVenueName,
  readGeneratedBreakdown,
  stripDenAndenSideRoomPrefix,
  structureDenAndenSideRooms,
} from "./denAndenSideRooms";
import { formatDescription, formattedDescriptionToText, practicalTailStart } from "./descriptionFormat";

const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__/descriptions", name), "utf8");

const PRACTICAL_TAIL = [
  "————",
  "𝗔𝗱𝗺𝗶𝘀𝘀𝗶𝗼𝗻",
  "Presale 140 DKK",
  "Door sale 170 DKK",
  "",
  "Age: 20+",
  "",
  "𝗖𝗼𝗱𝗲 𝗢𝗳 𝗖𝗼𝗻𝗱𝘂𝗰𝘁",
  "- No pictures or videos of any kind inside the club.",
].join("\n");

// Shape of RA 2131356 (Fast Forward x Bassiani, 2025-04-26): explicit
// per-room lineup lines naming both rooms.
const FAST_FORWARD = {
  title: "Fast Forward x Bassiani",
  artists: ["Kancheli", "HVL", "Ezy", "Schacke B2B Vixen", "Nygma", "Mikkelbarsxe"],
  description: [
    "Fast Forward and Bassiani return to Den Anden Side for a post-Easter night, with Aarhus collective FEUM taking over the second room.",
    "",
    "𝗟𝗶𝗻𝗲𝘂𝗽",
    "Main floor (Den Anden Side): Kancheli, HVL, Ezy, Schacke B2B Vixen",
    "FEUM takeover (Den Anden Ende): Nygma, Mikkelbarsxe",
    "",
    PRACTICAL_TAIL,
  ].join("\n"),
  venueName: "Den Anden Side",
};

describe("isDenAndenSideVenueName", () => {
  it("covers the club, its aliases and its small room — nothing else", () => {
    expect(isDenAndenSideVenueName("Den Anden Side")).toBe(true);
    expect(isDenAndenSideVenueName("DAS")).toBe(true);
    expect(isDenAndenSideVenueName("Den Anden Ende")).toBe(true);
    expect(isDenAndenSideVenueName("Culture Box")).toBe(false);
    expect(isDenAndenSideVenueName(null)).toBe(false);
  });
});

describe("analyzeRooms — verified splits", () => {
  it("reads an explicit two-room lineup", () => {
    const a = analyzeRooms(FAST_FORWARD);
    expect(a.verdict).toBe("two-rooms");
    expect(a.rooms).toEqual({
      "Den Anden Side": ["Kancheli", "HVL", "Ezy", "Schacke B2B Vixen"],
      "Den Anden Ende": ["Nygma", "Mikkelbarsxe"],
    });
  });

  it("reads heading-per-line lists separated by a blank line", () => {
    const a = analyzeRooms({
      title: "GAG x DAS",
      artists: ["A1", "A2", "B1"],
      description: "Lineup\n\nDen Anden Side:\nA1 [she/her]\nA2 (live)\n\nDen Anden Ende:\nB1",
    });
    expect(a.verdict).toBe("two-rooms");
    expect(a.rooms).toEqual({ "Den Anden Side": ["A1", "A2"], "Den Anden Ende": ["B1"] });
  });

  it("puts a night titled 'at Den Anden Ende' wholly in the small room", () => {
    const a = analyzeRooms({ title: "Miss Thing at Den Anden Ende", artists: ["DJ Nah Care", "KennyKrazyWorld"], description: "DJ NAH CARE b2b KennyKrazyWorld" });
    expect(a.verdict).toBe("small-room-only");
    expect(a.rooms).toEqual({ "Den Anden Ende": ["DJ Nah Care", "KennyKrazyWorld"] });
  });

  it("treats a 'Den Anden Ende' venue string as the small room", () => {
    expect(analyzeRooms({ title: "Open Decks", artists: [], description: null, venueName: "Den Anden Ende" }).verdict).toBe("small-room-only");
  });
});

describe("real source: RA 2131356, Fast Forward x Bassiani (2025-04-26), both rooms", () => {
  // The description's lineup section as published on RA (styled bold
  // letters included); artists exactly as RA's own lineup field lists them.
  const LINEUP = [
    "𝗟𝗶𝗻𝗲𝘂𝗽",
    "",
    "MAIN FLOOR:",
    "",
    "𝗞𝗮𝗻𝗰𝗵𝗲𝗹𝗶 [he/him]",
    "𝗛𝗩𝗟 [he/him]",
    "𝗘𝘇𝘆 [she/her]",
    "𝗦𝗰𝗵𝗮𝗰𝗸𝗲 𝗕𝟮𝗕 𝗩𝗶𝘅𝗲𝗻",
    "",
    "FEUM TAKEOVER @ DEN ANDEN ENDE:",
    "",
    "𝗡𝘆𝗴𝗺𝗮",
    "𝗠𝗶𝗸𝗸𝗲𝗹𝗯𝗮𝗿𝘀𝘅𝗲",
  ].join("\n");
  const RA_ARTISTS = ["Kancheli", "HVL", "Ezy", "Schacke", "B2B", "Vixen", "Nygma", "Mikkelbarsxe"];

  it("splits the lineup by room exactly as the source does", () => {
    const s = structureDenAndenSideRooms({
      title: "Fast Forward x Bassiani",
      artists: RA_ARTISTS,
      description: `Fast Forward and Bassiani return to Den Anden Side.\n\n${LINEUP}\n\n${PRACTICAL_TAIL}`,
    });
    expect(s.analysis.verdict).toBe("two-rooms");
    expect(s.title).toBe("Fast Forward x Bassiani");
    expect(s.analysis.rooms).toEqual({
      "Den Anden Side": ["Kancheli", "HVL", "Ezy", "Schacke", "B2B", "Vixen"],
      "Den Anden Ende": ["Nygma", "Mikkelbarsxe"],
    });
    expect(new Set(s.artists)).toEqual(new Set(RA_ARTISTS));
    const blocks = formatDescription(s.description);
    const about = formattedDescriptionToText(blocks.slice(0, practicalTailStart(blocks) ?? blocks.length));
    expect(about).toContain("Den Anden Side\nKancheli, HVL, Ezy, Schacke, B2B, Vixen");
    expect(about).toContain("Den Anden Ende\nNygma, Mikkelbarsxe");
  });
});

describe("analyzeRooms — never guessed", () => {
  it("flags an artist listed under both rooms (RA 2535456 shape: lineup and timetable disagree)", () => {
    const a = analyzeRooms({
      title: "Eerste Communie x Den Anden Side",
      artists: ["AMORAL", "Ignez", "MARRØN", "Anastasia Kristensen"],
      description: [
        "Lineup",
        "Room 1 (Eerste Communie): AMORAL, Ignez, MARRØN",
        "Room 2 (Den Anden Side): Anastasia Kristensen all night long",
        "",
        "Timetable",
        "Den Anden Side",
        "00:00 - 03:00 AMORAL",
        "03:00 - 06:00 MARRØN",
        "06:00 - end Ignez",
        "",
        "Den Anden Ende",
        "01:00 - end Anastasia Kristensen",
      ].join("\n"),
    });
    expect(a.verdict).toBe("unresolved");
    expect(a.reason).toContain("Anastasia Kristensen");
  });

  it("flags artists left outside every room", () => {
    const a = analyzeRooms({ title: "X", artists: ["A", "B", "C"], description: "Den Anden Ende: C\n\nWarm-up by A and B" });
    expect(a.verdict).toBe("unresolved");
    expect(a.reason).toContain("A, B");
  });

  it("flags prose about a second room without a per-room lineup (DAS 4 Ever fixture)", () => {
    const a = analyzeRooms({
      title: "DAS 4 EVER",
      artists: ["ABS8LUTE", "Anastasia Kristensen", "Audrey Danza", "Kasper Marott", "Schacke", "Wedding", "DJ Pastries", "Dennis DAFG", "Johanne Sastrup", "Sunstrip Backstage"],
      description: fixture("den-anden-side-das-4-ever.txt"),
    });
    expect(a.verdict).toBe("unresolved");
  });

  it("flags a title-says-small-room night whose lineup places someone in the main room", () => {
    const a = analyzeRooms({ title: "X at Den Anden Ende", artists: ["A", "B"], description: "Den Anden Side: A\nDen Anden Ende: B" });
    expect(a.verdict).toBe("unresolved");
  });

  it("leaves ordinary single-lineup nights alone (Syntharax and Morpheus fixtures)", () => {
    expect(analyzeRooms({ title: "Syntharax 3 Years", artists: ["Sybil", "Psicotek"], description: fixture("den-anden-side-syntharax-prose.txt") }).verdict).toBe("no-room-info");
    expect(analyzeRooms({ title: "Restless Night", artists: ["Beste Hira", "Alina"], description: fixture("den-anden-side-morpheus-flat.txt") }).verdict).toBe("no-room-info");
  });

  it("does not read boilerplate sentences naming the club as room headings", () => {
    const a = analyzeRooms({
      title: "X",
      artists: ["A"],
      description: "Below you’ll find important information and code of conduct to be read and considered before you go to Den Anden Side. A plays all night.",
    });
    expect(a.verdict).toBe("no-room-info");
  });
});

describe("structureDenAndenSideRooms", () => {
  it("builds the Culture Box shape for a two-room night: event name kept, room blocks before the practical tail", () => {
    const s = structureDenAndenSideRooms(FAST_FORWARD);
    expect(s.changed).toBe(true);
    expect(s.title).toBe("Fast Forward x Bassiani");
    expect(s.artists).toEqual(FAST_FORWARD.artists);
    expect(s.description).toContain("Den Anden Side\nKancheli, HVL, Ezy, Schacke B2B Vixen\n\nDen Anden Ende\nNygma, Mikkelbarsxe\n\n————\n𝗔𝗱𝗺𝗶𝘀𝘀𝗶𝗼𝗻");
    // Nothing from the source is lost.
    for (const line of FAST_FORWARD.description.split("\n").filter(Boolean)) expect(s.description).toContain(line);
  });

  it("keeps the event page's practical-tail split and shows both room blocks", () => {
    const s = structureDenAndenSideRooms(FAST_FORWARD);
    const blocks = formatDescription(s.description);
    const tail = practicalTailStart(blocks);
    expect(tail).not.toBeNull();
    const about = formattedDescriptionToText(blocks.slice(0, tail!));
    expect(about).toContain("Den Anden Side");
    expect(about).toContain("Nygma, Mikkelbarsxe");
  });

  it("prefixes a small-room night like Culture Box's single-room 'Black Box: X'", () => {
    const s = structureDenAndenSideRooms({ title: "Kilele x DAS at Den Anden Ende", artists: ["Kilele"], description: "Afro house night." });
    expect(s.title).toBe("Den Anden Ende: Kilele x DAS");
    expect(s.description).toBe("Afro house night.\n\nDen Anden Ende\nKilele");
    expect(stripDenAndenSideRoomPrefix(s.title)).toBe("Kilele x DAS");
  });

  it("is idempotent — re-structuring a structured event changes nothing", () => {
    for (const input of [
      FAST_FORWARD,
      { title: "Kilele x DAS at Den Anden Ende", artists: ["Kilele"], description: "Afro house night." },
      { title: "Open Decks at Den Anden Ende", artists: [], description: null },
    ]) {
      const once = structureDenAndenSideRooms(input);
      const twice = structureDenAndenSideRooms({ ...input, title: once.title, description: once.description, artists: once.artists });
      expect(twice.changed).toBe(false);
      expect(twice.title).toBe(once.title);
      expect(twice.description).toBe(once.description);
    }
  });

  it("returns unverifiable events untouched", () => {
    const input = { title: "DAS 4 EVER", artists: ["ABS8LUTE", "Wedding"], description: fixture("den-anden-side-das-4-ever.txt") };
    const s = structureDenAndenSideRooms(input);
    expect(s.changed).toBe(false);
    expect(s.description).toBe(input.description);
    expect(s.artists).toBe(input.artists);
  });

  it("reads back the breakdown it wrote, and never a source paragraph that only starts with a room name", () => {
    const s = structureDenAndenSideRooms(FAST_FORWARD);
    expect(readGeneratedBreakdown(s.description, s.artists)).toEqual({
      "Den Anden Side": ["Kancheli", "HVL", "Ezy", "Schacke B2B Vixen"],
      "Den Anden Ende": ["Nygma", "Mikkelbarsxe"],
    });
    expect(readGeneratedBreakdown("Den Anden Side\nAxeltorv 5", ["A"])).toBeNull();
  });
});
