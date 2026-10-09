import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * iOS auto-zoom fix (mobile forms audit, 2026-09-13): this session's forms
 * are fixed by ensuring mobile computed font-size is always >= 16px, never
 * by disabling the browser's own zoom mechanism. Static-source guard (same
 * pattern as noClientSecretLeak.test.ts) against ever introducing a
 * `viewport` export (or a literal <meta name="viewport"> tag) that sets
 * user-scalable=no or maximum-scale=1 — both would break pinch-zoom/
 * accessibility for every page, not just these forms. No `viewport` export
 * exists in layout.tsx today, so Next.js emits its own default
 * (width=device-width, initial-scale=1, no zoom restriction) — this test
 * locks that in.
 */
function read(relPath: string): string {
  return readFileSync(path.resolve(process.cwd(), relPath), "utf-8");
}

describe("root layout never disables browser zoom", () => {
  it("layout.tsx defines no `viewport` export and no literal viewport meta tag with a zoom-disabling attribute", () => {
    const source = read("src/app/layout.tsx");
    expect(source).not.toContain("user-scalable");
    expect(source).not.toContain("maximum-scale");
    expect(source).not.toMatch(/export const viewport/);
  });
});

/**
 * Big Shoulders loading (font CLS fix, 2026-10-09): loaded through
 * next/font/local from the woff2 files @fontsource/big-shoulders vendors —
 * not the old @fontsource CSS imports — with a width-matched fallback face,
 * since next/font's automatic Arial fallback is ~50% wider than the
 * condensed Big Shoulders and wrapped the header nav until the font loaded.
 */
describe("Big Shoulders display font", () => {
  const layout = read("src/app/layout.tsx");
  const css = read("src/app/globals.css");

  it("is loaded with next/font/local from the vendored 600/700/800 woff2 files, not the @fontsource CSS", () => {
    expect(layout).toContain('from "next/font/local"');
    expect(layout).not.toMatch(/import\s+["']@fontsource\//);
    for (const weight of ["600", "700", "800"]) {
      expect(layout).toContain(`@fontsource/big-shoulders/files/big-shoulders-latin-${weight}-normal.woff2", weight: "${weight}"`);
      expect(readFileSync(path.resolve(process.cwd(), `node_modules/@fontsource/big-shoulders/files/big-shoulders-latin-${weight}-normal.woff2`)).length).toBeGreaterThan(0);
    }
    expect(layout).toMatch(/variable: "--font-big-shoulders"/);
    expect(layout).toMatch(/\$\{bigShoulders\.variable\}/);
  });

  it("swaps in over a width-matched fallback face instead of next/font's default one, without preloading", () => {
    expect(layout).toMatch(/display: "swap"/);
    expect(layout).toMatch(/adjustFontFallback: false/);
    expect(layout).toMatch(/fallback: \["Big Shoulders Fallback"\]/);
    expect(layout).toMatch(/preload: false/);
    const face = css.match(/@font-face\s*\{[^}]*font-family:\s*"Big Shoulders Fallback"[^}]*\}/)?.[0] ?? "";
    expect(face).toMatch(/src:\s*local\("Arial"\)/);
    expect(face).toMatch(/size-adjust:\s*70%/);
    expect(face).toMatch(/ascent-override:\s*140%/);
    expect(face).toMatch(/descent-override:\s*31%/);
  });

  it("no longer defines the variable itself in :root (next/font sets it on <html>)", () => {
    expect(css).not.toMatch(/--font-big-shoulders:\s*"Big Shoulders"/);
    expect(css).toMatch(/--font-display:\s*var\(--font-big-shoulders\)/);
  });
});
