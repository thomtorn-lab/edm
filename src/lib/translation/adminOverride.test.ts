import { describe, expect, it } from "vitest";
import { addOverriddenFields, stripOverriddenFields } from "../override";
import { descriptionHash, publicDescriptionFor, type CachedTranslation } from "./englishDescription";
import { needsTranslationWork, type TranslationWorkRow } from "./translationWork";

/**
 * Admin edits vs. cached translations (2026-10-24). The admin-edited
 * description is what the site uses (sync never overwrites an overridden
 * field), and the English text shown is always a translation of exactly
 * that current description — never of an older source text.
 */
describe("admin-edited descriptions and translations", () => {
  const SOURCE_DA = "Den amerikanske artist WITCHZ står klar til at forvandle Pumpehuset.";
  const SOURCE_EN = "The American artist WITCHZ is ready to transform Pumpehuset.";
  const ADMIN_DA = "WITCHZ spiller i Pumpehuset søndag. Dørene åbner kl. 19.";
  const row = (description: string, cached: CachedTranslation & { attempts: number }): TranslationWorkRow => ({
    eventId: "e1",
    slug: "witchz",
    description,
    startDatetime: "2026-11-13T19:00:00.000Z",
    endDatetime: null,
    cached,
  });

  it("an old source translation is never shown for an admin-edited description; nothing is shown until the admin text's own translation exists", () => {
    const sourceTranslation = { sourceHash: descriptionHash(SOURCE_DA), status: "translated", translatedText: SOURCE_EN };
    // Before the edit: the translation of the source text is shown.
    expect(publicDescriptionFor(SOURCE_DA, sourceTranslation)).toBe(SOURCE_EN);
    // Admin replaces the description (Danish): the stale translation no
    // longer matches, and Danish is never shown publicly — the About text is
    // hidden until the admin text's own translation exists.
    expect(publicDescriptionFor(ADMIN_DA, sourceTranslation)).toBeNull();
    // …and the translation job picks the admin text up on its next run.
    expect(needsTranslationWork(row(ADMIN_DA, { ...sourceTranslation, attempts: 0 }))).toBe(true);
    // Once translated, the admin text's own translation is shown.
    const adminTranslation = { sourceHash: descriptionHash(ADMIN_DA), status: "translated", translatedText: "WITCHZ plays Pumpehuset on Sunday. Doors open at 19." };
    expect(publicDescriptionFor(ADMIN_DA, adminTranslation)).toBe(adminTranslation.translatedText);
    expect(needsTranslationWork(row(ADMIN_DA, { ...adminTranslation, attempts: 0 }))).toBe(false);
  });

  it("a later sync cannot replace the admin-edited description, so its translation stays current", () => {
    const overriddenFields = addOverriddenFields([], ["description"]);
    const syncProposed = { description: "Ny tekst fra kilden.", title: "WITCHZ" };
    const applied = stripOverriddenFields(syncProposed, overriddenFields);
    expect(applied).not.toHaveProperty("description");
    // The stored description is still the admin text, so the cached admin
    // translation still matches and nothing is re-sent.
    const adminTranslation = { sourceHash: descriptionHash(ADMIN_DA), status: "translated", translatedText: "EN", attempts: 0 };
    expect(publicDescriptionFor(ADMIN_DA, adminTranslation)).toBe("EN");
    expect(needsTranslationWork(row(ADMIN_DA, adminTranslation))).toBe(false);
  });

  it("an admin edit back to an earlier text reuses nothing stale: only an exact hash match counts", () => {
    const cached = { sourceHash: descriptionHash(`${ADMIN_DA} `), status: "translated", translatedText: "EN" };
    expect(publicDescriptionFor(ADMIN_DA, cached)).toBeNull();
  });

  it("an admin who writes the description in English has it shown right away, before any translation run", () => {
    const adminEn = "WITCHZ plays Pumpehuset on Sunday with a full live show, and doors open at seven in the evening.";
    expect(publicDescriptionFor(adminEn, null)).toBe(adminEn);
  });

  it("an admin who clears the description gets no About text at all (no orphaned translation)", () => {
    const cached = { sourceHash: descriptionHash(SOURCE_DA), status: "translated", translatedText: SOURCE_EN };
    expect(publicDescriptionFor("", cached)).toBeNull();
    expect(publicDescriptionFor(null, cached)).toBeNull();
  });
});
