import { describe, expect, it } from "vitest";
import { htmlToText, isSameHost, normalizeExtractedText, sanitizeExtractedTitle, stripBareUrls, truncateAtBoundary } from "./htmlExtraction";

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

  it("decodes an &nbsp; entity leaking into a title (event-level text normalization, 2026-09-07)", () => {
    expect(sanitizeExtractedTitle("musik på&nbsp;KU.BE")).toBe("musik på KU.BE");
  });
});

// Generalized event description/text normalization work package,
// 2026-09-07 — real Production reference cases: Ragnhild May / John Bowers
// / Reinhold Friedl - SPARKLING SOUND FESTIVAL 2026 (Billetto), whose
// stored description contained a literal, undecoded "&nbsp;" (rendering as
// visible text "på&nbsp;KU.BE" instead of a space) because billettoAdapter
// never decoded its source API's rich-text field at all; and several
// Culture Box descriptions carrying a raw U+00A0 character (not an entity —
// the character itself) that survived htmlToText/decodeHtmlEntities
// untouched since neither was a whitespace pass.
describe("normalizeExtractedText", () => {
  it("decodes &nbsp; entities to an ordinary space — the exact Sparkling Sound reference case", () => {
    expect(normalizeExtractedText("musik på&nbsp;KU.BE")).toBe("musik på KU.BE");
  });

  it("collapses a raw non-breaking space character to an ordinary space", () => {
    expect(normalizeExtractedText("musik på KU.BE")).toBe("musik på KU.BE");
  });

  it("decodes &amp; to a literal &", () => {
    expect(normalizeExtractedText("A &amp; B")).toBe("A & B");
  });

  it("decodes &quot;, &#39; and &lt;/&gt;", () => {
    expect(normalizeExtractedText("&quot;hello&quot;")).toBe('"hello"');
    expect(normalizeExtractedText("it&#39;s")).toBe("it's");
    expect(normalizeExtractedText("&lt;3 &gt;3")).toBe("<3 >3");
  });

  it("decodes numeric HTML entities, both decimal and hex", () => {
    expect(normalizeExtractedText("14&#39;e festival")).toBe("14'e festival");
    expect(normalizeExtractedText("caf&#x00e9;")).toBe("café");
  });

  it("strips HTML tags while preserving readable text separation between blocks", () => {
    expect(normalizeExtractedText("<div>Hello <b>World</b></div>")).toBe("Hello World");
    expect(normalizeExtractedText("<p>Para one</p><p>Para two</p>")).toBe("Para one\nPara two");
  });

  it("removes zero-width formatting characters (zero-width space/joiner/non-joiner, BOM)", () => {
    expect(normalizeExtractedText("A​B‌C‍D﻿E")).toBe("ABCDE");
  });

  it("collapses repeated horizontal whitespace", () => {
    expect(normalizeExtractedText("a    b\t\tc", { singleLine: true })).toBe("a b c");
  });

  it("normalizes CRLF and lone CR line endings to LF", () => {
    expect(normalizeExtractedText("Line1\r\nLine2\rLine3")).toBe("Line1\nLine2\nLine3");
  });

  it("normalizes the Unicode line/paragraph separator characters", () => {
    expect(normalizeExtractedText("Fredag 22:00 Lørdag 22:00")).toBe("Fredag 22:00\nLørdag 22:00");
  });

  it("drops excessive blank lines rather than preserving runs of empty lines", () => {
    expect(normalizeExtractedText("Line1\n\n\n\nLine2")).toBe("Line1\nLine2");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeExtractedText("   hello world   ")).toBe("hello world");
  });

  it("preserves Danish characters (æ ø å) unchanged", () => {
    expect(normalizeExtractedText("Musik på København æøå — hyggelig aften")).toBe("Musik på København æøå — hyggelig aften");
  });

  it("preserves apostrophes and does not guess at replacing them", () => {
    expect(normalizeExtractedText("Mario Bertoncinis 'Alleluia' (1982)")).toBe("Mario Bertoncinis 'Alleluia' (1982)");
  });

  it("leaves source-authored '14'e' completely unchanged when the input is literally that — never editorially rewritten to '14.' or '14th'", () => {
    expect(normalizeExtractedText("14'e", { singleLine: true })).toBe("14'e");
    expect(normalizeExtractedText("14'e festival for ny hybrid dansk musik")).toBe("14'e festival for ny hybrid dansk musik");
  });

  it("never rewrites grammar, spelling, or wording — only encoding/whitespace artifacts", () => {
    const text = "flerkanalsmusik, selvbyggede instrumenter og magien, der opstår";
    expect(normalizeExtractedText(text)).toBe(text);
  });

  it("produces plain text only — never renderable/executable HTML, even given a script tag", () => {
    const result = normalizeExtractedText("<script>alert(1)</script>Hello");
    expect(result).not.toContain("<script");
    expect(result).not.toContain("alert(1)");
    expect(result).toBe("Hello");
  });

  it("is idempotent — a second pass over already-normalized text changes nothing", () => {
    const once = normalizeExtractedText("musik på&nbsp;KU.BE  with   extra   spaces");
    const twice = normalizeExtractedText(once);
    expect(twice).toBe(once);
  });

  it("collapses newlines to spaces in singleLine mode (title/artist/venue-name-shaped fields)", () => {
    expect(normalizeExtractedText("Line1\nLine2", { singleLine: true })).toBe("Line1 Line2");
  });

  it("keeps meaningful line breaks in default (description-shaped) mode", () => {
    expect(normalizeExtractedText("Room A\nDJ One, DJ Two\n\nRoom B\nDJ Three")).toBe("Room A\nDJ One, DJ Two\nRoom B\nDJ Three");
  });

  it("reproduces the exact real Sparkling Sound Festival stored-description excerpt", () => {
    const raw =
      "14'e\nfestival for ny hybrid dansk &amp; international lyd- og kunst-musik på&nbsp;KU.BE\nRAGNHILD\nMAYJOHN\nM. BOWERS (UK)";
    expect(normalizeExtractedText(raw)).toBe(
      "14'e\nfestival for ny hybrid dansk & international lyd- og kunst-musik på KU.BE\nRAGNHILD\nMAYJOHN\nM. BOWERS (UK)",
    );
  });

  it("returns null/empty input unchanged rather than throwing", () => {
    expect(normalizeExtractedText("")).toBe("");
  });
});

describe("isSameHost (admin + public link integrity, 2026-09-08 — guards an adapter against mistaking its own site's internal redirect for a genuine external destination)", () => {
  it("true for the exact same host", () => {
    expect(isSameHost("https://www.kultunaut.dk/perl/billet/type-nynaut?ArrNr=1", "https://www.kultunaut.dk/")).toBe(true);
  });

  it("true regardless of a www. prefix on either side", () => {
    expect(isSameHost("https://kultunaut.dk/perl/billet/type-nynaut?ArrNr=1", "https://www.kultunaut.dk/")).toBe(true);
    expect(isSameHost("https://www.kultunaut.dk/perl/billet/type-nynaut?ArrNr=1", "https://kultunaut.dk/")).toBe(true);
  });

  it("false for a genuinely different host, even a similarly-named one", () => {
    expect(isSameHost("https://billetto.dk/e/some-event", "https://www.kultunaut.dk/")).toBe(false);
    expect(isSameHost("https://kultunaut.dk.evil.example/", "https://www.kultunaut.dk/")).toBe(false);
  });

  it("false (never throws) for a malformed URL on either side", () => {
    expect(isSameHost("not a url", "https://www.kultunaut.dk/")).toBe(false);
    expect(isSameHost("https://www.kultunaut.dk/", "not a url")).toBe(false);
  });
});
