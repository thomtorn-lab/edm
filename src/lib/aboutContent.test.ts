import { describe, expect, it } from "vitest";
import { classifyAboutText, isDanishAboutText } from "./aboutContent";

// Real stored descriptions (KultuNaut fixtures, as the adapter stores them).
const VEGA_BOILERPLATE =
  "I Store- Lille VEGA skal garderoben af sikkerhedsmæssige hensyn altid benyttes. Der opkræves garderobeafgift ved indlevering.\n\nSidder du i kørestol eller har du et handicap, som kræver ledsager, skal vi bede dig kontakte VEGA på info@vega.dk eller tlf. + 45 33 25 70 11 på hverdage mellem kl. 13-14.\n\nFind øvrig praktisk info på\n\nwww.vega.dk\n\nEntré";
const AGE_ONLY = "Praktisk info: Aldersgrænse: 18+.\n\nEntré";
const EMPTY_LABELS = "Praktisk info:.\n\nEntré";
const WITCHZ =
  "Den amerikanske artist WITCHZ står klar til at forvandle Pumpehuset til et univers af dybe baslinjer, luftige vokaler og sin dragende, elektroniske lyd søndag d. 13. september 2026";

describe("classifyAboutText (real fixture texts)", () => {
  it("VEGA's cloakroom/accessibility/contact boilerplate (the DJ Aligator listing) is practical-only", () => {
    expect(classifyAboutText(VEGA_BOILERPLATE)).toBe("practical");
  });
  it("a practical text with a unique detail (age limit) is practical, not empty — it is still shown", () => {
    expect(classifyAboutText(AGE_ONLY)).toBe("practical");
  });
  it("bare labels with no values carry no information", () => {
    expect(classifyAboutText(EMPTY_LABELS)).toBe("empty");
    expect(classifyAboutText("Entré")).toBe("empty");
  });
  it("text about the event or artist is 'about', even with practical lines mixed in", () => {
    expect(classifyAboutText(WITCHZ)).toBe("about");
    expect(classifyAboutText(`${WITCHZ}\n\n${VEGA_BOILERPLATE}`)).toBe("about");
  });
  it("no text → null", () => {
    expect(classifyAboutText(null)).toBeNull();
    expect(classifyAboutText("  ")).toBeNull();
  });
});

describe("isDanishAboutText (QA 2026-11-15)", () => {
  it("Danish About text is hidden, including Danish grammar with no æ/ø/å (Hvaderpaa, Whipped #7)", () => {
    expect(isDanishAboutText(WITCHZ)).toBe(true);
    expect(isDanishAboutText("Syvende udgave af klubnatten Whipped samler Matrixxman, Pamela Svart, zamara og Ctrls bag pulten til en nat med elektronisk dansemusik.")).toBe(true);
  });
  it("practical information is never hidden, in any language", () => {
    expect(isDanishAboutText(VEGA_BOILERPLATE)).toBe(false);
    expect(isDanishAboutText(AGE_ONLY)).toBe(false);
  });
  it("English text is never hidden, also when it names Danish places", () => {
    expect(isDanishAboutText("The legendary Berlin DJ returns to Refshaleøen for a long night of techno with all of their friends.")).toBe(false);
    expect(isDanishAboutText("Shrek Rave returns to Poolen. Where underground rave meets live stage show, the swamp transforms into a full-scale party.")).toBe(false);
    expect(isDanishAboutText("Get ready for the Grand Opening of Cava Søndag x La Boucherie, a night dedicated to the music.")).toBe(false);
  });
  it("no text, nothing to hide", () => {
    expect(isDanishAboutText(null)).toBe(false);
    expect(isDanishAboutText("")).toBe(false);
  });
});
