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
