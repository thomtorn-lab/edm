import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseKultunautDetailHtml } from "./adapters/kultunautAdapter";
import { isPracticalInfoOnly, usableDiscoveryDescription } from "./descriptionQuality";

const FIXTURES_DIR = path.join(__dirname, "adapters", "__fixtures__");
const kultunaut = (arrNr: string) =>
  parseKultunautDetailHtml(readFileSync(path.join(FIXTURES_DIR, `kultunaut-detail-${arrNr}.html`), "utf-8"), arrNr).description ?? "";

describe("isPracticalInfoOnly — real KultuNaut detail pages", () => {
  it.each([
    ["19456289", "Gloryhammer (UK), Amager Bio"],
    ["19428938", "Clawfinger, Amager Bio"],
    ["19411899", "DJ Aligator, VEGA's cloakroom/access text"],
    ["20180997", "Glayden (FI), Rust's wheelchair text"],
    ["20044203", "Nimino, 'Praktisk info:. Entré'"],
    ["20072037", "Kløbb Ka2, 'Praktisk info: Aldersgrænse: 18+. Entré'"],
  ])("flags the venue's practical boilerplate alone (%s: %s)", (arrNr) => {
    expect(isPracticalInfoOnly(kultunaut(arrNr))).toBe(true);
  });

  it.each([
    ["20035096", "Final Descent: Nyx — about the music"],
    ["19768459", "Slayyyter — artist bio naming hyperpop/pop"],
    ["20137632", "Paul Van Dyk — practical lines plus an artist paragraph"],
    ["20016809", "WonderWorld — door times and prices next to the night itself"],
    ["20299607", "Mannings children — 'Live experimental electronics door : free / donation.'"],
    ["20097798", "Depeche Mode lecture — keeps the text the relevance check needs"],
  ])("keeps a description that says anything about the event (%s: %s)", (arrNr) => {
    expect(isPracticalInfoOnly(kultunaut(arrNr))).toBe(false);
  });
});

describe("isPracticalInfoOnly — edge cases", () => {
  it("treats empty and whitespace as nothing worth storing", () => {
    expect(isPracticalInfoOnly("")).toBe(true);
    expect(usableDiscoveryDescription("   ")).toBeNull();
    expect(usableDiscoveryDescription(null)).toBeNull();
  });

  it("a single sentence about the music keeps the whole text", () => {
    const text = "Dørene åbnes kl. 20. Billetter via Ticketmaster. Aftenens hovednavn spiller et langt sæt med syntetisk pop fra 80'erne.";
    expect(usableDiscoveryDescription(text)).toBe(text);
  });

  it("keeps short descriptions that are about the music", () => {
    for (const text of ["Live techno.", "DJ-sæt hele natten.", "Svensk duo med drømmende synths og vokal.", "Live experimental electronics door : free / donation."]) {
      expect(usableDiscoveryDescription(text), text).toBe(text);
    }
    expect(isPracticalInfoOnly("Billetter i døren. DJ-sæt hele natten.")).toBe(false);
  });

  it("a stray genre or DJ word inside practical text does not make it informative", () => {
    for (const text of [
      "Gratis entré til techno i gården.",
      "Billetter via Ticketmaster. Garderobe ved technoscenen.",
      "Dørene åbner kl. 20. DJ-billetter sælges i døren.",
      "Hvis der er udsolgt i forsalg, vil der være udsolgt i døren. Entré: 200 kr inkl. house-garderobe.",
    ]) {
      expect(isPracticalInfoOnly(text), text).toBe(true);
    }
  });

  it("does not split '1. time' or 'kl. 20' into separate sentences", () => {
    expect(isPracticalInfoOnly("Dørene åbnes 1. time før koncerten.")).toBe(true);
  });
});
