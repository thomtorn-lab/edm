import { describe, expect, it } from "vitest";
import { deterministicGenreFromText } from "./deterministicGenreMapping";

describe("deterministicGenreFromText", () => {
  it("maps the standalone word 'psy' to psytrance", () => {
    expect(deterministicGenreFromText("Sunday Psy: Agata, Neri J, Matriark")).toBe("psytrance");
  });

  it("matches 'psy' case-insensitively", () => {
    expect(deterministicGenreFromText("PSY night")).toBe("psytrance");
    expect(deterministicGenreFromText("psy night")).toBe("psytrance");
    expect(deterministicGenreFromText("PsY night")).toBe("psytrance");
  });

  it("still matches the full word 'psytrance' directly", () => {
    expect(deterministicGenreFromText("A night of psytrance")).toBe("psytrance");
  });

  it("does not false-positive on unrelated words containing 'psy'", () => {
    expect(deterministicGenreFromText("A talk on psychology and psychedelic art")).toBeNull();
    expect(deterministicGenreFromText("Psycho Killer live")).toBeNull();
  });

  it("returns null when no keyword matches at all", () => {
    expect(deterministicGenreFromText("Gerd Janson, Harrison Heat, NAT")).toBeNull();
  });
});
