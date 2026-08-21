import { describe, expect, it } from "vitest";
import { htmlToText, stripBareUrls } from "./htmlExtraction";

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
