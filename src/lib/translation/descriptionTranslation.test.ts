import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRANSLATION_MODEL,
  isClearlyEnglish,
  translateDescription,
  validateTranslation,
  type TranslationClient,
} from "./descriptionTranslation";
import { descriptionHash, englishDescriptionFor } from "./englishDescription";
import { MAX_TRANSLATION_ATTEMPTS, needsTranslationWork, nextAttemptCount, selectTranslationWork, type TranslationWorkRow } from "./translationWork";

const DANISH =
  "Efter mange år på scenen siger DJ Aligator farvel med en sidste fest i Store VEGA.\n\nBilletter: 250 kr. Mere info på www.vega.dk";
const ENGLISH =
  "Pink Monkey returns to KB3 for a full night of house and disco with the residents and friends from all over the city. Doors open at 23:00.";

function stubClient(response: unknown | Error): TranslationClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  const create = vi.fn(async (params: unknown) => {
    calls.push(params);
    if (response instanceof Error) throw response;
    return response;
  });
  return { beta: { messages: { create } }, calls } as unknown as TranslationClient & { calls: unknown[] };
}

function reply(json: unknown, stop_reason = "end_turn") {
  return { stop_reason, content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(json) }] };
}

describe("isClearlyEnglish", () => {
  it("recognises ordinary English prose", () => expect(isClearlyEnglish(ENGLISH)).toBe(true));
  it("never calls Danish English", () => expect(isClearlyEnglish(DANISH)).toBe(false));
  it("sends short or mixed texts to the model rather than guessing", () => {
    expect(isClearlyEnglish("Techno all night")).toBe(false);
    expect(isClearlyEnglish(`${ENGLISH}\n\nDørene åbner kl. 23 og der er gratis entré for alle før midnat i aften.`)).toBe(false);
  });
});

describe("validateTranslation", () => {
  it("accepts a faithful translation", () => {
    const en = "After many years on stage, DJ Aligator says goodbye with one last party in Store VEGA.\n\nTickets: 250 kr. More info at www.vega.dk";
    expect(validateTranslation(DANISH, en)).toBeNull();
  });
  it("rejects a translation that dropped a URL, a number or a line, or summarised", () => {
    expect(validateTranslation(DANISH, "DJ Aligator says goodbye in Store VEGA.\n\nTickets: 250 kr. More info on the website")).toMatch(/URL/);
    expect(validateTranslation(DANISH, "DJ Aligator says goodbye with one last party in Store VEGA.\n\nTickets: cheap. More info at www.vega.dk")).toMatch(/number/);
    expect(validateTranslation("Line one is here.\nLine two is here.\nLine three is here.", "Line one is here. Line two is here. Line three is here.")).toMatch(/line structure/);
    expect(validateTranslation(DANISH.repeat(1), "Party. 250 www.vega.dk\n\nx")).toMatch(/length/);
  });
});

describe("translateDescription", () => {
  it("does not call the API for clearly-English text", async () => {
    const client = stubClient(new Error("must not be called"));
    expect(await translateDescription(client, ENGLISH)).toEqual({ status: "english", sourceLanguage: "en" });
    expect(client.calls).toHaveLength(0);
  });

  it("returns a validated translation, using the default model, structured output and server-side fallback", async () => {
    const en = "After many years on stage, DJ Aligator says goodbye with one last party in Store VEGA.\n\nTickets: 250 kr. More info at www.vega.dk";
    const client = stubClient(reply({ source_language: "da", already_english: false, translation: en }));
    expect(await translateDescription(client, DANISH)).toEqual({ status: "translated", sourceLanguage: "da", text: en });
    const params = client.calls[0] as Record<string, unknown>;
    expect(params.model).toBe(DEFAULT_TRANSLATION_MODEL);
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect((params.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect(JSON.stringify(params.messages)).toContain("<description>");
  });

  it("records the model's 'already English' verdict without storing a copy", async () => {
    const client = stubClient(reply({ source_language: "en", already_english: true, translation: "Techno all night" }));
    expect(await translateDescription(client, "Techno all night")).toEqual({ status: "english", sourceLanguage: "en" });
  });

  it.each([
    ["an API error", new Error("overloaded"), /API error/],
    ["a refusal", { stop_reason: "refusal", content: [] }, /declined/],
    ["a truncated response", reply({}, "max_tokens"), /truncated/],
    ["invalid JSON", { stop_reason: "end_turn", content: [{ type: "text", text: "{nope" }] }, /JSON/],
    ["a translation that drops the URL", reply({ source_language: "da", already_english: false, translation: "Goodbye party.\n\nTickets 250 kr." }), /URL/],
  ])("fails safely (never throws) on %s", async (_name, response, error) => {
    const result = await translateDescription(stubClient(response), DANISH);
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error).toMatch(error);
  });
});

describe("englishDescriptionFor (what the event page shows)", () => {
  const hash = descriptionHash(DANISH);
  it("shows the translation only when it was made from exactly the current description", () => {
    expect(englishDescriptionFor(DANISH, { sourceHash: hash, status: "translated", translatedText: "EN" })).toBe("EN");
    expect(englishDescriptionFor(`${DANISH} (updated)`, { sourceHash: hash, status: "translated", translatedText: "EN" })).toBe(`${DANISH} (updated)`);
  });
  it("falls back to the original on a missing, failed or English row", () => {
    expect(englishDescriptionFor(DANISH, null)).toBe(DANISH);
    expect(englishDescriptionFor(DANISH, { sourceHash: hash, status: "failed", translatedText: null })).toBe(DANISH);
    expect(englishDescriptionFor(ENGLISH, { sourceHash: descriptionHash(ENGLISH), status: "english", translatedText: null })).toBe(ENGLISH);
    expect(englishDescriptionFor(null, null)).toBeNull();
  });
});

describe("translation work selection", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const row = (over: Partial<TranslationWorkRow>): TranslationWorkRow => ({
    eventId: "e",
    slug: "e",
    description: DANISH,
    startDatetime: "2026-10-20T21:00:00.000Z",
    endDatetime: null,
    cached: null,
    ...over,
  });

  it("never re-sends an unchanged, already-handled description; re-sends a changed one", () => {
    expect(needsTranslationWork(row({ cached: { sourceHash: descriptionHash(DANISH), status: "translated", attempts: 0 } }))).toBe(false);
    expect(needsTranslationWork(row({ cached: { sourceHash: descriptionHash(DANISH), status: "english", attempts: 0 } }))).toBe(false);
    expect(needsTranslationWork(row({ cached: { sourceHash: "old", status: "translated", attempts: 0 } }))).toBe(true);
    expect(needsTranslationWork(row({}))).toBe(true);
  });

  it("retries a failure until the attempt cap, and starts counting afresh when the text changes", () => {
    const failed = (attempts: number) => row({ cached: { sourceHash: descriptionHash(DANISH), status: "failed", attempts } });
    expect(needsTranslationWork(failed(MAX_TRANSLATION_ATTEMPTS - 1))).toBe(true);
    expect(needsTranslationWork(failed(MAX_TRANSLATION_ATTEMPTS))).toBe(false);
    expect(nextAttemptCount(failed(2), false)).toBe(3);
    expect(nextAttemptCount(row({ cached: { sourceHash: "old", status: "failed", attempts: 3 } }), false)).toBe(1);
  });

  it("puts upcoming events first (soonest first), then past events (most recent first), within the limit", () => {
    const rows = [
      row({ slug: "past-old", startDatetime: "2026-09-01T21:00:00.000Z" }),
      row({ slug: "later", startDatetime: "2026-11-01T21:00:00.000Z" }),
      row({ slug: "past-recent", startDatetime: "2026-10-10T21:00:00.000Z" }),
      row({ slug: "soon", startDatetime: "2026-10-16T21:00:00.000Z" }),
    ];
    expect(selectTranslationWork(rows, now, 10).map((r) => r.slug)).toEqual(["soon", "later", "past-recent", "past-old"]);
    expect(selectTranslationWork(rows, now, 2).map((r) => r.slug)).toEqual(["soon", "later"]);
  });
});
