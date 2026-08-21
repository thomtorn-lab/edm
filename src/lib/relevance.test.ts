import { describe, expect, it } from "vitest";
import { hasNonElectronicGenreSignal } from "./relevance";

describe("hasNonElectronicGenreSignal (data-quality Workstream A)", () => {
  it("flags grime/rap copy (Dizzee Rascal-type evidence)", () => {
    expect(hasNonElectronicGenreSignal("Dizzee Rascal is a pioneering grime and hip hop MC.")).toBe(true);
    expect(hasNonElectronicGenreSignal("A legendary UK rapper returns to Copenhagen.")).toBe(true);
  });

  it("flags metal copy (MASTER BOOT RECORD + Fulci-type evidence)", () => {
    expect(hasNonElectronicGenreSignal("MASTER BOOT RECORD blends chiptune and industrial metal.")).toBe(true);
    expect(hasNonElectronicGenreSignal("Fulci is an Italian death metal band.")).toBe(true);
    expect(hasNonElectronicGenreSignal("A night of pure heavy metal riffs.")).toBe(true);
  });

  it("does not flag genuinely electronic copy, including 'industrial techno'", () => {
    expect(hasNonElectronicGenreSignal("A night of industrial techno at Poolen.")).toBe(false);
    expect(hasNonElectronicGenreSignal("Melodic techno and deep house all night.")).toBe(false);
    expect(hasNonElectronicGenreSignal("Psytrance vibes with Infected Mushroom.")).toBe(false);
  });

  it("does not false-positive on unrelated words", () => {
    expect(hasNonElectronicGenreSignal("Doors open at 8pm, drinks and vibes.")).toBe(false);
  });

  it("flags comedy/bingo/quiz programming that a generalist venue might otherwise tag broadly", () => {
    expect(hasNonElectronicGenreSignal("Friday night bingo with prizes.")).toBe(true);
    expect(hasNonElectronicGenreSignal("A stand-up comedy showcase.")).toBe(true);
  });
});
