import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { judgeDuplicateLines, removeDuplicateLines, translateDescription, validateTranslation, type TranslationClient } from "./descriptionTranslation";

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

  it("never removes a line with information found nowhere else — keeps that line, removes the safe ones, flags review", () => {
    // Line 20 (translated Danish ee:man bio) names Recoil/Alan Wilder, which the
    // venue's own English bio (cut off mid-sentence at the source) never mentions.
    expect(lines[19]).toMatch(/Recoil/);
    const out = removeDuplicateLines(FULL, [3, 4, 5, 20]);
    expect(out.removed).toBe(3);
    expect(out.text).toContain("Recoil (Alan Wilder");
    expect(out.reviewReason).toMatch(/kept 1 of 4 marked line\(s\).*line 20: "Recoil" appears nowhere else/);
  });

  it("real Danish/English duplicates with different wording: every unique detail survives, clear duplicates go", () => {
    // What an ideal model would mark: the whole translated Danish half, including
    // its ee:man lines 20–22 that the venue's own (truncated) English bio lacks.
    const marked = [1, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
    const verdicts = judgeDuplicateLines(FULL, marked);
    const removed = verdicts.filter((v) => v.remove).map((v) => v.line);
    expect(removed).toEqual(expect.arrayContaining([1, 3, 4, 5, 11, 12, 14, 15, 16, 17, 18]));
    for (const unique of [20, 21, 22]) expect(removed).not.toContain(unique);
    const out = removeDuplicateLines(FULL, marked);
    for (const fact of ["Recoil", "Alan Wilder", "Nine Inch Nails", "Front Line Assembly", "new beginning", "100 kr", "January 29, 2027"]) {
      expect(out.text).toContain(fact);
    }
    expect(out.text.match(/Cold Connection is a Swedish synthpop/g)).toHaveLength(1); // the bio now appears once
    expect(out.reviewReason).toBeTruthy(); // borderline lines stayed, so a person should look
  });

  it("a negation the matching passage doesn't share is never treated as a duplicate", () => {
    const text = "Entry is free for everyone under 18 at the door tonight.\n\nEntry is not free for anyone under 18 at the door tonight.";
    expect(judgeDuplicateLines(text, [3])[0]).toMatchObject({ remove: false, keepReason: expect.stringMatching(/"not"/) });
  });

  it("names match regardless of case, apostrophe style, possessive or trailing colon", () => {
    const text = "ILK’s network presents the Wild Man, says Information.\n\nILK's network presents the wild man, says Information:";
    expect(judgeDuplicateLines(text, [3])[0].remove).toBe(true);
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
