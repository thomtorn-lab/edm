import { describe, expect, it } from "vitest";
import { latestWithheldByEvent, shouldRecordWithheldDescription } from "./withheldDescriptions";

const DA = "Den amerikanske artist WITCHZ står klar til at forvandle Pumpehuset.";

describe("shouldRecordWithheldDescription", () => {
  it("records a new withheld text", () => {
    expect(shouldRecordWithheldDescription(DA, null, null)).toBe(true);
    expect(shouldRecordWithheldDescription(DA, "Older stored text", "Older withheld text")).toBe(true);
  });

  it("skips empty text, text already stored as the description, and a repeat of the last record", () => {
    expect(shouldRecordWithheldDescription(null, null, null)).toBe(false);
    expect(shouldRecordWithheldDescription("  ", null, null)).toBe(false);
    expect(shouldRecordWithheldDescription(DA, DA, null)).toBe(false);
    expect(shouldRecordWithheldDescription(DA, null, DA)).toBe(false);
  });
});

describe("latestWithheldByEvent", () => {
  it("keeps the first (newest) text per event and ignores empty notes", () => {
    expect(
      latestWithheldByEvent([
        { eventId: "a", note: "new" },
        { eventId: "b", note: null },
        { eventId: "a", note: "old" },
        { eventId: "b", note: "only" },
      ]),
    ).toEqual({ a: "new", b: "only" });
  });
});
