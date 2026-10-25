import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isClearlyEnglishProse, isLikelyDanish, readsAsDanish } from "./languageDetection";
import { parsePoolenEventDetailHtml, parsePoolenProgramHtml } from "./adapters/poolenAdapter";

const FX = path.join(process.cwd(), "src/lib/adapters/__fixtures__");
const entries = parsePoolenProgramHtml(readFileSync(path.join(FX, "poolen-program.html"), "utf8"));
const poolen = (f: string) => parsePoolenEventDetailHtml(readFileSync(path.join(FX, f), "utf8"), entries[0]);

describe("isLikelyDanish (Poolen/Pumpehuset English-language guard)", () => {
  it("regression: English text naming a Danish place or title is NOT Danish (real Poolen fixtures)", () => {
    const outside = poolen("poolen-event-outside.html").description!; // names "Refshaleøen"
    const support = poolen("poolen-event-with-support.html").description!; // names "Årgang", "Rød"
    expect(outside).toMatch(/Refshaleøen/);
    expect(support).toMatch(/Årgang|Rød/);
    expect(isLikelyDanish(outside)).toBe(false);
    expect(isLikelyDanish(support)).toBe(false);
    expect(isLikelyDanish("A night of deep house at Råhuset with the residents, and the bar is open until late.")).toBe(false);
  });

  it("still treats real Danish text as Danish — long and short, with or without English words", () => {
    expect(isLikelyDanish("Vi åbner kl. 15.00 og baren bugner af lækre øl.")).toBe(true);
    expect(isLikelyDanish("Forbered dig på årets største dansefest med kæmpe stemning.")).toBe(true);
    expect(isLikelyDanish("Pumpehuset præsenterer")).toBe(true); // no English grammar → unchanged
    expect(
      isLikelyDanish("Den amerikanske artist WITCHZ står klar til at forvandle Pumpehuset til et univers af dybe baslinjer, luftige vokaler og sin elektroniske lyd"),
    ).toBe(true);
  });

  it("is otherwise unchanged: a text without æ/ø/å is never treated as Danish here", () => {
    expect(isLikelyDanish("Kom og dans med os hele natten")).toBe(false);
    expect(isLikelyDanish("Doors open at 21:00 and the lineup is stacked with techno DJs.")).toBe(false);
  });

  it("isClearlyEnglishProse needs several English function words and (almost) no Danish ones", () => {
    expect(isClearlyEnglishProse("Kødbyen")).toBe(false);
    expect(isClearlyEnglishProse("Doors open at nine and the bar is open all night at Kødbyen.")).toBe(true);
    expect(isClearlyEnglishProse("Det er en fest for alle, og der er gratis entré hele aftenen at the venue.")).toBe(false);
  });
});

describe("readsAsDanish (QA reporting signal)", () => {
  it("flags Danish grammar with or without æ/ø/å, never English with Danish names", () => {
    expect(readsAsDanish("Kom og dans med os hele natten, der er fri entré til alle")).toBe(true);
    expect(readsAsDanish("Den 23. august vender house-leverandørerne fra Love.Rave tilbage til Byhaven med endnu en søndagsfest")).toBe(true);
    expect(readsAsDanish(poolen("poolen-event-outside.html").description!)).toBe(false);
    expect(readsAsDanish("Techno all night")).toBe(false);
  });
});
