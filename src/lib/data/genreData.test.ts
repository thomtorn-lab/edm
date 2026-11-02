import { describe, expect, it } from "vitest";
import { EVENTS } from "./events";
import { FESTIVALS } from "./festivals";
import { isSelectableGenre, validateGenreTags } from "../taxonomy";

// Genre system revision (2026-10-24) — contract D3: static data uses only
// current genres, and seed events follow the classification rules.
describe("static genre data", () => {
  it("every festival genre is a current, selectable genre (no legacy ambient-experimental)", () => {
    for (const f of FESTIVALS) {
      for (const g of f.genres) expect(isSelectableGenre(g), `${f.name}: ${g}`).toBe(true);
    }
  });

  it("every seed event's tags pass validateGenreTags, with primaryGenre first", () => {
    for (const e of EVENTS) {
      expect(validateGenreTags(e.subgenres), `${e.title}: ${e.subgenres.join("+")}`).toEqual([]);
      expect(e.subgenres[0], e.title).toBe(e.primaryGenre);
    }
  });
});
