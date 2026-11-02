import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { GENRES, INDEXABLE_GENRE_PAGES, genrePagePath, indexableGenreForUrlSlug } from "@/lib/taxonomy";
import { GENRE_PAGE_CONTENT } from "@/lib/genrePages";

/**
 * No genre gets a public, indexable landing page automatically. Only
 * allowlisted genres (taxonomy.ts INDEXABLE_GENRE_PAGES — Techno, House,
 * Trance) are served by the single /genres/[slug] route, which generates
 * only those slugs and sets dynamicParams = false, so every other
 * /genres/* URL is Next.js' real 404 (with its injected noindex), never a
 * generic 200 page.
 */
const GENRES_DIR = path.join(__dirname);
const routeDirs = readdirSync(GENRES_DIR).filter((name) => statSync(path.join(GENRES_DIR, name)).isDirectory());

describe("/genres/* routes", () => {
  it("the allowlist approves exactly Techno, House and Trance", () => {
    expect([...INDEXABLE_GENRE_PAGES]).toEqual(["techno", "house", "trance"]);
    expect(GENRES.filter((g) => genrePagePath(g.slug) !== null).map((g) => g.slug)).toEqual(["techno", "house", "trance"]);
  });

  it("has a single [slug] route and no catch-all or per-genre copies", () => {
    expect(routeDirs).toEqual(["[slug]"]);
  });

  it("the route restricts itself to generated params (dynamicParams = false)", () => {
    const source = readFileSync(path.join(GENRES_DIR, "[slug]", "page.tsx"), "utf8");
    expect(source).toMatch(/export const dynamicParams = false;/);
    expect(source).toMatch(/INDEXABLE_GENRE_PAGES\.map/);
  });

  it("every allowlisted genre has editorial copy, and resolves from its own URL slug only", () => {
    expect(Object.keys(GENRE_PAGE_CONTENT).sort()).toEqual([...INDEXABLE_GENRE_PAGES].sort());
    for (const slug of INDEXABLE_GENRE_PAGES) expect(indexableGenreForUrlSlug(genrePagePath(slug)!.replace("/genres/", ""))).toBe(slug);
    for (const g of GENRES.filter((x) => !(INDEXABLE_GENRE_PAGES as readonly string[]).includes(x.slug))) {
      expect(indexableGenreForUrlSlug(g.urlSlug), g.slug).toBeNull();
    }
  });
});
