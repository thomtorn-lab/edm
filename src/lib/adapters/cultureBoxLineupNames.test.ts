import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractLineupNames, isAcceptablePlainName } from "./cultureBoxLineupNames";
import { parseCultureBoxEventsHtml } from "./cultureBoxAdapter";
import { decodeHtmlEntities } from "./htmlExtraction";

const a = (name: string) => `<a href="https://soundcloud.com/${name.toLowerCase().replace(/\W+/g, "-")}">${name}</a>`;
const p = (...lines: string[]) => lines.join("<br />\n");

describe("extractLineupNames — unlinked names the venue lists (real room paragraphs, reduced)", () => {
  it("16 Oct Red Box: SHK and GEORGEOUS between linked names, showcase title left out", () => {
    expect(extractLineupNames(p(`<strong>THE GATHERING</strong>`, "SHK", a("GEORGEBOX"), "GEORGEOUS", a("DANI PANDA")))).toEqual([
      "SHK",
      "GEORGEBOX",
      "GEORGEOUS",
      "DANI PANDA",
    ]);
  });

  it("30 Oct Red Box: AB+ (punctuation in a name), colon-laden <strong> showcase left out", () => {
    expect(extractLineupNames(p(`<strong>NECKLESS: HALLOWEEN EDITION:</strong>`, a("ZIGGY STARDUBB"), "AB+", a("SOLVÆR")))).toEqual([
      "ZIGGY STARDUBB",
      "AB+",
      "SOLVÆR",
    ]);
  });

  it("31 Dec Red Box: ARTO before a B2B with a linked name; the label annotation is dropped", () => {
    expect(extractLineupNames(p(`${a("RYAN DANK")} B2B ${a("MADURA")}`, `ARTO B2B ${a("MAX FINNEY")} (BAD DEAL RECORDS)`, a("RÓS")))).toEqual([
      "RYAN DANK",
      "MADURA",
      "ARTO",
      "MAX FINNEY",
      "RÓS",
    ]);
  });

  it("multi-word plain names (SMALL HORSE B2B linked, 18 Sep)", () => {
    expect(extractLineupNames(p(`SMALL HORSE B2B ${a("TECHNYMPH")}`))).toEqual(["SMALL HORSE", "TECHNYMPH"]);
  });

  it("two plain names joined by B2B or vs (always two separate acts)", () => {
    expect(extractLineupNames(p("D-TRICH B2B KAREN", "MNSTR VS LINUS"))).toEqual(["D-TRICH", "KAREN", "MNSTR", "LINUS"]);
  });

  it("a plain name joined to a LINKED name by & or x is its own act", () => {
    expect(extractLineupNames(p(`ARTO &amp; ${a("MAX FINNEY")}`, `${a("BESTRAWA")} x AB+`))).toEqual(["ARTO", "MAX FINNEY", "BESTRAWA", "AB+"]);
  });
});

describe("extractLineupNames — never invents artists (identified false positives)", () => {
  it("connectors between links are not names: &, x, B2B, vs", () => {
    expect(extractLineupNames(p(`${a("RØNHÖFF")} &amp; ${a("LOUIN")}`, `${a("BESTRAWA")} x ${a("FA999")}`, `${a("ADELINA")} B2B ${a("LEANCA")}`, `${a("A1")} vs. ${a("B1")}`))).toEqual([
      "RØNHÖFF",
      "LOUIN",
      "BESTRAWA",
      "FA999",
      "ADELINA",
      "LEANCA",
      "A1",
      "B1",
    ]);
  });

  it("multi-line <strong> showcase titles (WHAT HAPPENS / 4 DECADES OF TIM ANDRESEN, HE.SHE.THEY. x SYREN)", () => {
    expect(extractLineupNames(p(`<strong>WHAT HAPPENS<br />\n4 DECADES OF TIM ANDRESEN</strong>`, a("GUY J")))).toEqual(["GUY J"]);
    expect(extractLineupNames(p(`<strong>HE.SHE.THEY. x SYREN</strong>`, a("SYREETA")))).toEqual(["SYREETA"]);
  });

  it.each(["TECH THE NIGHT:", "IBOGA:", "SOFA BEATS:", "ELEVATE PRESENTS BASS RAVE:", "VIBECAST:"])("plain first-line showcase %s", (showcase) => {
    expect(extractLineupNames(p(showcase, a("TICON"), a("EMOK")))).toEqual(["TICON", "EMOK"]);
  });

  it("a linked collective line ending in ':' keeps its links but adds no ':' token (3 Oct Shaktu & Meoko:)", () => {
    expect(extractLineupNames(p(`${a("Shaktu")} &amp; ${a("Meoko")}:`, a("COSMINA")))).toEqual(["Shaktu", "Meoko", "COSMINA"]);
  });

  it("bracket groups: only the links of HALVMÅNE [AMITTET+TINKI]", () => {
    expect(extractLineupNames(p(`HALVMÅNE [${a("AMITTET")}+${a("TINKI")}]`))).toEqual(["AMITTET", "TINKI"]);
  });

  it("aka aliases: MAGHONI & MESSING aka (the alias names are linked on the next lines)", () => {
    expect(extractLineupNames(p("MAGHONI &amp; MESSING aka", a("JAKOB DE WITTIG"), a("PAB DISCO")))).toEqual(["JAKOB DE WITTIG", "PAB DISCO"]);
    expect(extractLineupNames(p(`ANNA aka ${a("LIVE ANNA")}`))).toEqual(["LIVE ANNA"]);
  });

  it("a dangling connector without a link on that side makes the segment doubtful (MALCOLM X could be one name)", () => {
    expect(extractLineupNames(p("MALCOLM X", a("RÓS")))).toEqual(["RÓS"]);
    expect(extractLineupNames(p("B2B ARTO"))).toEqual([]);
  });

  it("mixed-case, prose, announcements and lists are left out", () => {
    expect(
      extractLineupNames(
        p(
          "Georgeous",
          "More TBA",
          "+ MORE TBA",
          "SPECIAL GUESTS",
          "DOORS OPEN 23",
          "LINEUP TBA",
          "A, B",
          "ONE TWO THREE FOUR",
          "A VERY LONG ANNOUNCEMENT NAME OVER LIMIT",
          "1234",
          "HARD TECHNO",
          "DISCO DAN",
          a("KEPT"),
        ),
      ),
    ).toEqual(["KEPT"]);
  });

  it("one doubtful token makes its whole segment doubtful", () => {
    expect(extractLineupNames(p("SHK B2B Georgeous"))).toEqual([]);
  });

  it("decodes entities in plain names; & inside a name is not a connector", () => {
    // "&" without spaces is part of a name, not a connector.
    expect(extractLineupNames(p("R&amp;B KID B2B K&#8217;S"))).toEqual(["R&B KID", "K\u2019S"]);
    expect(isAcceptablePlainName("AB+")).toBe(true);
    expect(isAcceptablePlainName("REXXX M")).toBe(true);
  });
});

describe("against the real recorded listings — exact lineups", () => {
  const read = (file: string) => readFileSync(path.join(__dirname, "__fixtures__", file), "utf-8");
  const oct13 = parseCultureBoxEventsHtml(read("culture-box-events-2026-10-13.html"));
  const aug17 = parseCultureBoxEventsHtml(read("culture-box-events.html"));
  const night = (events: typeof oct13, iso: string) => {
    const e = events.find((c) => new Date(c.startDatetime as string | Date).toISOString().startsWith(iso));
    if (!e) throw new Error(`no night ${iso}`);
    return e;
  };

  it("16 Oct: the full two-room lineup, SHK and GEORGEOUS included, title unchanged", () => {
    const e = night(oct13, "2026-10-16");
    expect(e.artists).toEqual(["CHICH", "KALLAX", "REXXX M", "SHK", "GEORGEBOX", "GEORGEOUS", "DANI PANDA"]);
    expect(e.title).toBe("Black Box: CHICH, KALLAX, REXXX M · Red Box: THE GATHERING");
  });

  it("30 Oct: AB+, title unchanged", () => {
    const e = night(oct13, "2026-10-30");
    expect(e.artists).toEqual(["GALATIUS", "THIIM", "KAMIKAZEM", "BESTRAWA", "FA999", "ZIGGY STARDUBB", "AB+", "SOLVÆR", "LeLe", "EA RAHBEK"]);
    expect(e.title).toBe("NECKLESS: HALLOWEEN EDITION");
  });

  it("31 Dec: ARTO, not the label", () => {
    const e = night(oct13, "2026-12-31");
    expect(e.artists).toEqual(["TIM ANDRESEN", "NILU", "REXIE LEX", "AJA GULRIS", "GÆO", "ANA KARLA", "RYAN DANK", "MADURA", "ARTO", "MAX FINNEY", "RÓS"]);
  });

  it("nights with only showcases, connectors or alias text gain nothing", () => {
    expect(night(oct13, "2026-10-24").artists).toEqual(["AZZECCA", "B FROM E", "NAT", "RARES GHERMAN", "COSTYX", "FYNUTZU"]);
    expect(night(oct13, "2026-11-14").artists).toEqual(["ANIMAL TRAINER", "MULO", "KLARSKOV", "ADELINA", "LEANCA", "ANTOINE"]);
    expect(night(oct13, "2026-11-21").artists).toEqual(["GUY J", "TIM ANDRESEN", "EZEQUIEL PERINI", "DISTRACTED", "MATIAS OLIVEROS", "AYELEN", "THOR CALIN"]);
    expect(night(oct13, "2026-12-11").artists).toEqual(["TICON", "EMOK", "ZORA", "UMLOUD", "TIM ANDRESEN", "ALEXANDER DESCROIX"]);
    expect(night(oct13, "2026-12-12").artists).toEqual(["SYREETA", "BRADLEY SKENG", "YOON", "DJ 2LATE", "ASTA MARI"]);
    expect(night(aug17, "2026-10-02").artists).toEqual(["MOLLONO.BASS", "NILU", "MOUSAN CORR", "JAKOB DE WITTIG", "PAB DISCO"]);
  });

  it("historical 2026-08-17 listing: D-TRICH, KAREN, MNSTR, LINUS (not HALVMÅNE) and SMALL HORSE", () => {
    expect(night(aug17, "2026-08-28").artists).toEqual([
      "TAXMAN", "DWONJI", "BOBBY 6 KILLA", "HDN", "DJ BREAKFAST", "MAXI MO", "L.A.D.J",
      "D-TRICH", "KAREN", "FIA2THEFLOOR", "AMITTET", "TINKI", "MNSTR", "DELFF", "LINUS",
    ]);
    expect(night(aug17, "2026-09-18").artists).toEqual([
      "BIESMANS", "KAWUN", "WILLE", "SAKENA", "IRINI LIAPIKOU", "KRÆ", "KIRAKINGKONG", "EVA CLAUDIA", "KLENA", "SMALL HORSE", "TECHNYMPH",
    ]);
  });

  it("across both listings, every plain (unlinked) name accepted is exactly the reviewed set", () => {
    const plain = new Set<string>();
    for (const file of ["culture-box-events.html", "culture-box-events-2026-10-13.html"]) {
      const html = read(file);
      for (const block of html.matchAll(/<div class="post-block__content__block">[\s\S]*?<p>([\s\S]*?)<\/p>/g)) {
        const anchors = new Set([...block[1].matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map((m) => decodeHtmlEntities(m[1]).trim()));
        for (const name of extractLineupNames(block[1])) if (!anchors.has(name)) plain.add(name);
      }
    }
    expect([...plain].sort()).toEqual(["AB+", "ARTO", "D-TRICH", "GEORGEOUS", "KAREN", "LINUS", "MNSTR", "SHK", "SMALL HORSE"]);
  });
});

describe("linked names are kept whole, exactly as before", () => {
  it("a linked duo with & stays one name (AURORA & MANE MAID)", () => {
    expect(extractLineupNames(p(a("AURORA &amp; MANE MAID")))).toEqual(["AURORA & MANE MAID"]);
  });
});

describe("unlinked duos and collabs are never split into invented artists", () => {
  it.each(["BONGO &amp; PUSK", "AB x CD", "MNSTR X LINUS", "SHK &amp; GEORGEOUS B2B KAREN"])("%s is left out", (line) => {
    expect(extractLineupNames(p(line, a("KEPT")))).toEqual(["KEPT"]);
  });
});

describe("genre words", () => {
  it("an unlinked token with a genre keyword is left out; a linked one is kept as before", () => {
    expect(extractLineupNames(p("HOUSE OF X", "TECHNO", a("PAB DISCO")))).toEqual(["PAB DISCO"]);
  });
});
