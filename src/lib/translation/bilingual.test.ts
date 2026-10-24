import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { removeDuplicateLines, translateDescription, validateTranslation, type TranslationClient } from "./descriptionTranslation";

/**
 * Bilingual descriptions (2026-10-24). Fixtures: the real KultuNaut
 * description of Electro Werkz (fixture kultunaut-detail-20265870: a Danish
 * version, then "English-" and the venue's own English version) and a real
 * full translation of it produced in the 2026-10-24 model evaluation.
 */
const FX = path.join(__dirname, "__fixtures__");
const SOURCE = readFileSync(path.join(FX, "electro-werkz-source.txt"), "utf8").trim();
const FULL = readFileSync(path.join(FX, "electro-werkz-full-translation.txt"), "utf8").trim();
const lines = FULL.split("\n");

describe("removeDuplicateLines", () => {
  it("the fixture translation itself passes strict validation", () => {
    expect(validateTranslation(SOURCE, FULL, { title: "Electro Werkz", venueName: "Råhuset" })).toBeNull();
  });

  it("removes translated intro lines whose information the source's own English version states", () => {
    // Lines 3–5: the translated Danish intro; lines 7–9 repeat it in the venue's own English.
    expect(lines[2]).toMatch(/^Get ready for a musical journey/);
    const out = removeDuplicateLines(FULL, [3, 4, 5]);
    expect(out.removed).toBe(3);
    expect(out.reviewReason).toBeNull();
    expect(out.text).not.toContain("fantastic live shows"); // translated copy gone
    expect(out.text).toContain("amazing live shows"); // venue's own English kept
    for (const fact of ["29", "2027", "100 DKK", "Eckotrigger UK", "Cold Connection SE", "ee:man DK", "Råhuset"]) expect(out.text).toContain(fact);
  });

  it("never removes a line with information found nowhere else — flags review and keeps everything instead", () => {
    // Line 20 (translated Danish ee:man bio) names Recoil/Alan Wilder, which the
    // venue's own English bio (cut off mid-sentence at the source) never mentions.
    expect(lines[19]).toMatch(/Recoil/);
    const out = removeDuplicateLines(FULL, [3, 4, 5, 20]);
    expect(out.removed).toBe(0);
    expect(out.text).toBe(FULL);
    expect(out.reviewReason).toMatch(/line 20 may hold unique information/);
  });

  it("removes a pure language pointer line", () => {
    const text = "(scroll down for English)\nKresten Osgood Kvintet plays tonight at KU.BE with his band.\n\nKresten Osgood Kvintet plays tonight at KU.BE with his band.";
    const out = removeDuplicateLines(text, [1]);
    expect(out.removed).toBe(1);
    expect(out.text.startsWith("Kresten Osgood Kvintet")).toBe(true);
  });

  it("ignores out-of-range, blank and duplicate line numbers", () => {
    expect(removeDuplicateLines("A line here.\n\nAnother line.", [0, 2, 2, 99])).toEqual({ text: "A line here.\n\nAnother line.", removed: 0, reviewReason: null });
  });
});

describe("translateDescription with a bilingual source", () => {
  const reply = (duplicate_lines: number[]) => ({
    stop_reason: "end_turn",
    usage: { input_tokens: 2400, output_tokens: 1900 },
    content: [{ type: "text", text: JSON.stringify({ source_language: "da+en", already_english: false, translation: FULL, duplicate_lines }) }],
  });
  const client = (r: unknown) => ({ messages: { create: vi.fn(async () => r) } }) as unknown as TranslationClient;

  it("returns one merged English text when the duplicates are certain, with usage for cost logging", async () => {
    const result = await translateDescription(client(reply([3, 4, 5])), SOURCE, "claude-sonnet-5-5", { title: "Electro Werkz", venueName: "Råhuset" });
    expect(result.status).toBe("translated");
    if (result.status !== "translated") return;
    expect(result.removedDuplicateLines).toBe(3);
    expect(result.reviewReason).toBeNull();
    expect(result.usage).toEqual({ inputTokens: 2400, outputTokens: 1900 });
  });

  it("keeps the full translation and flags review when the model marked no duplicates in a visibly bilingual text", async () => {
    const result = await translateDescription(client(reply([])), SOURCE, "claude-sonnet-5-5", { title: "Electro Werkz", venueName: "Råhuset" });
    expect(result.status === "translated" && result.text).toBe(FULL);
    expect(result.status === "translated" && result.reviewReason).toMatch(/both language versions kept/);
  });
});
