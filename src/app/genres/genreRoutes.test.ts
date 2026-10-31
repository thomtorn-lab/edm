import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { GENRES, INDEXABLE_GENRE_PAGES, genrePagePath } from "@/lib/taxonomy";

/**
 * SEO QA (genre system revision, 2026-10-30): no genre gets a public,
 * indexable landing page automatically. Only allowlisted genres
 * (taxonomy.ts INDEXABLE_GENRE_PAGES — Techno) have a route; there is no
 * dynamic /genres/[slug] segment, so every other /genres/* URL falls
 * through to Next.js' real 404 (with its injected noindex), never a
 * generic 200 page.
 */
const GENRES_DIR = path.join(__dirname);
const routeDirs = readdirSync(GENRES_DIR).filter((name) => statSync(path.join(GENRES_DIR, name)).isDirectory());

describe("/genres/* routes", () => {
  it("the allowlist approves Techno only", () => {
    expect(INDEXABLE_GENRE_PAGES).toEqual(["techno"]);
    expect(GENRES.filter((g) => genrePagePath(g.slug) !== null).map((g) => g.slug)).toEqual(["techno"]);
  });

  it("has no dynamic or catch-all segment under /genres — unapproved slugs are real 404s", () => {
    for (const dir of routeDirs) expect(dir, dir).not.toMatch(/^[[(]/);
  });

  it("has exactly one route per allowlisted genre, at its urlSlug, and no other genre route", () => {
    expect(routeDirs.sort()).toEqual(INDEXABLE_GENRE_PAGES.map((slug) => genrePagePath(slug)!.replace("/genres/", "")).sort());
  });
});
