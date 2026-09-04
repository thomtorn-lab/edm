import { describe, expect, it } from "vitest";
import { htmlToText, sanitizeExtractedTitle, stripBareUrls, truncateAtBoundary } from "./htmlExtraction";

describe("htmlToText", () => {
  it("treats an attributed <br> the same as a bare one (real Pumpehuset lineup evidence)", () => {
    const html = 'Leeni &amp; Danilo Kupfernagel<br class="html-br" />Lush<br class="html-br" />NILU';
    expect(htmlToText(html)).toBe("Leeni & Danilo Kupfernagel\nLush\nNILU");
  });

  it("still treats a bare <br> / <br/> as a line break", () => {
    expect(htmlToText("A<br>B<br/>C")).toBe("A\nB\nC");
  });
});

describe("stripBareUrls", () => {
  it("removes a standalone URL entirely", () => {
    expect(stripBareUrls("https://soundcloud.com/aragon")).toBe("");
  });

  it("strips a trailing URL and leftover punctuation, keeping the real name", () => {
    expect(stripBareUrls("Kromagon: https://soundcloud.com/aragon -")).toBe("Kromagon");
  });

  it("strips a URL with no separating punctuation before it", () => {
    expect(stripBareUrls("Oxyflux: https://soundcloud.com/oxyflux_music")).toBe("Oxyflux");
  });

  it("preserves legitimate text on both sides of an embedded URL", () => {
    expect(stripBareUrls("Fagins Reject – Wild Things Records: https://soundcloud.com/fagins_reject - Wild things Records")).toBe(
      "Fagins Reject – Wild Things Records: - Wild things Records",
    );
  });

  it("removes multiple URLs from the same line", () => {
    const result = stripBareUrls("Lulla-Li & Nihility: https://soundcloud.com/a https://soundcloud.com/b");
    expect(result).not.toMatch(/https?:\/\//);
    expect(result).toContain("Lulla-Li & Nihility");
  });

  it("leaves text with no URL untouched", () => {
    expect(stripBareUrls("Gerd Janson (Running Back)")).toBe("Gerd Janson (Running Back)");
  });
});

// Public event-integrity audit (2026-09-04): the reported "Endurance"
// contamination shape — a clean title followed by description prose and a
// CTA ("... View Event →") — could not be reproduced against any current
// adapter or live Production event (see the event-integrity diagnostic's
// full audit of every published event), but the underlying regex family
// (e.g. hangarenAdapter.ts's `[^<]*` title capture) only bounds itself on
// nested HTML tags, not on runaway plain text with no tag in between. These
// tests exercise that exact hypothetical shape against the shared sanitizer
// applied once at runIngestionPipeline's single point of entry (see
// pipeline.ts), standing in for item 4/10's "Endurance source fixture"
// requirement in the absence of a reproducible live defect.
describe("sanitizeExtractedTitle", () => {
  it("leaves a clean, ordinary title completely unchanged", () => {
    expect(sanitizeExtractedTitle("Endurance")).toBe("Endurance");
    expect(sanitizeExtractedTitle("KARRUSEL AFTERPARTY: TOCCORORO Meilgaarden WE.LL")).toBe(
      "KARRUSEL AFTERPARTY: TOCCORORO Meilgaarden WE.LL",
    );
  });

  it("does not touch a legitimate multi-clause title with periods (real Billetto festival title)", () => {
    expect(sanitizeExtractedTitle("EleKtro Universal: Mini Festival 9.-10. oktober")).toBe(
      "EleKtro Universal: Mini Festival 9.-10. oktober",
    );
  });

  it("does not touch a legitimate long dual-room lineup title (real Culture Box title, 124 chars)", () => {
    const title =
      "Black Box: TAXMAN, DWONJI, BOBBY 6 KILLA, HDN, DJ BREAKFAST, MAXI MO, L.A.D.J · Red Box: FIA2THEFLOOR, AMITTET, TINKI, DELFF";
    expect(sanitizeExtractedTitle(title)).toBe(title);
  });

  it("reproduces the reported Endurance contamination shape (clean title, then description prose ending in a CTA) and strips the CTA tail", () => {
    // Standing in for the "Endurance" reference case's reported shape:
    // "Endurance ... presale tickets ... View Event →". No live event or
    // adapter reproduces this (see event-integrity audit), so this fixture
    // is deliberately synthetic — it documents and locks in exactly what
    // the generalized fix does and does not claim: it removes the CTA/
    // navigation tail unconditionally (this test), and separately caps
    // runaway length (the length-cap test below) — it does NOT attempt to
    // guess where a title ends and adjoining prose begins when neither
    // signal is present, the same reasoning the no-end-time fallback
    // design applied to duration thresholds (see datetime.ts).
    const contaminated =
      "Endurance One last Hangaren session in 2026, do not miss out — grab your presale tickets before they are gone. View Event →";
    const result = sanitizeExtractedTitle(contaminated);
    expect(result).not.toContain("View Event");
    expect(result).not.toMatch(/→/);
    expect(result.startsWith("Endurance")).toBe(true);
    expect(result.length).toBeLessThan(contaminated.length);
  });

  it("strips a description that bleeds in after the title with no CTA present, given a long enough tail", () => {
    const contaminated =
      "Endurance " + "One last Hangaren session in 2026, do not miss the chance to see incredible local and international talent. ".repeat(3);
    const result = sanitizeExtractedTitle(contaminated);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).not.toBe(contaminated);
  });

  it("strips a trailing CTA arrow even with no recognizable phrase", () => {
    expect(sanitizeExtractedTitle("Endurance →")).toBe("Endurance");
    expect(sanitizeExtractedTitle("Endurance ->")).toBe("Endurance");
  });

  it("is a no-op for a title already within bounds with no CTA marker", () => {
    const title = truncateAtBoundary("A perfectly ordinary event title with no issues at all", 200);
    expect(sanitizeExtractedTitle(title)).toBe(title);
  });
});
