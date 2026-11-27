import { describe, expect, it } from "vitest";
import { admissionStatus, detectFreeBefore } from "./freeBefore";

const detect = (description: string | null) => detectFreeBefore({ description });

describe("detectFreeBefore — accepts explicit free-before phrasing", () => {
  it("reads the phrasings seen in real descriptions", () => {
    expect(detect("Sigurdsgade 39, 2200 22:00 to 04:00 Free till 23:00 · 120 DKK after 21+ · Free wardrobe")).toBe("23:00");
    expect(detect("20/11/26 21+  Free until 23, 75kr (After 23) @Baggen")).toBe("23:00");
    expect(detect("Music all night. Free entrance if you arrive before 23:00")).toBe("23:00");
    expect(detect("COME EARLY. STAY LATE. Free before 21:00 | 70 DKK after")).toBe("21:00");
    expect(detect("COME EARLY: Entrance is free from 22:00 to 23:00. TICKET PRICES")).toBe("23:00");
  });

  it("states it whatever the listed start time (doors often open before the programme)", () => {
    expect(detect("Sat 05.12 23.00–05.00 Free entry until 22.00, 75kr after 22.00")).toBe("22:00");
    expect(detect("Jake McKay 22:30-05:00 75 DKK (free entry before 22:00)")).toBe("22:00");
  });

  it("reads the agreed English and Danish forms", () => {
    expect(detect("Free before 23:00")).toBe("23:00");
    expect(detect("Free entry before 23:30")).toBe("23:30");
    expect(detect("Free entry until 23:00")).toBe("23:00");
    expect(detect("Gratis entré før kl. 23.00")).toBe("23:00");
    expect(detect("Fri entré indtil kl. 23")).toBe("23:00");
    expect(detect("Free before 24:00")).toBe("00:00");
  });
});

describe("detectFreeBefore — leaves out anything that isn't clearly free admission before a time", () => {
  it("discounts, early-bird tiers and priced 'before' tickets", () => {
    expect(detect("Presale 170 DKK Door sale 180 DKK 2 for 1 before 23:59 80 DKK after 05:30")).toBeNull();
    expect(detect("Early bird (entry before 1AM) - 70,00 kr. Dancer (entry all night) - 150 kr.")).toBeNull();
    expect(detect("Early entrance* (enter before 24:00): 125kr incl. fee")).toBeNull();
    expect(detect("TICKETS: BEFORE 22:00 100 KR AFTER 22:00 150 KR")).toBeNull();
  });

  it("free things that aren't admission, or a free separate activity", () => {
    expect(detect("Presale 170 DKK Free before 22:00 (Vernissage) 2 for 1 before 23:59")).toBeNull();
    expect(detect("First drink/beer for free the first open hour.")).toBeNull();
    expect(detect("Free drinks before 23:00")).toBeNull();
    expect(detect("Free classic Danish mulled wine (gløgg) if you arrive early!")).toBeNull();
    expect(detect("a space free from harassment, discrimination, and exclusion")).toBeNull();
  });

  it("guest list, invitation and membership conditions", () => {
    expect(detect("Free entry before 23:00 for guest list")).toBeNull();
    expect(detect("Free before 23:00 with invitation")).toBeNull();
    expect(detect("Members: free entry until 23:00")).toBeNull();
    expect(detect("Gratis entré før kl. 23 for medlemmer")).toBeNull();
  });

  it("ambiguous text", () => {
    // Two different free-before times.
    expect(detect("Free before 23:00. Saturday: free before 22:00")).toBeNull();
    // A date, not a time; and the bare Danish weekday "Fri".
    expect(detect("Free until 12 December")).toBeNull();
    expect(detect("Fri til 23:00")).toBeNull();
    expect(detect(null)).toBeNull();
  });
});

describe("admissionStatus", () => {
  it("prefers Free Before over a bare FREE price and never reports both", () => {
    expect(admissionStatus({ description: "Free till 23:00", priceFrom: 0 })).toEqual({ kind: "free-before", time: "23:00" });
    expect(admissionStatus({ description: null, priceFrom: 0 })).toEqual({ kind: "free" });
    expect(admissionStatus({ description: "Tickets 120 DKK", priceFrom: null })).toBeNull();
  });

  it("uses Jolene's standard free-before time when the description states none", () => {
    const jolene = { slug: "jolene" };
    expect(admissionStatus({ description: "Techno all night", priceFrom: null, venue: jolene })).toEqual({ kind: "free-before", time: "22:00" });
    expect(admissionStatus({ description: null, priceFrom: null, venue: jolene })).toEqual({ kind: "free-before", time: "22:00" });
    // The description's own time wins; a confirmed free price stays FREE.
    expect(admissionStatus({ description: "Free before 23:00", priceFrom: null, venue: jolene })).toEqual({ kind: "free-before", time: "23:00" });
    expect(admissionStatus({ description: null, priceFrom: 0, venue: jolene })).toEqual({ kind: "free" });
    // A conditional statement is not overridden by the venue default.
    expect(admissionStatus({ description: "Free before 23:00 for members", priceFrom: null, venue: jolene })).toBeNull();
    // Other venues get no default.
    expect(admissionStatus({ description: null, priceFrom: null, venue: { slug: "kb18" } })).toBeNull();
  });
});
