import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Metadata } from "next";

/**
 * Robots meta hygiene (2026-10-09). The root layout used to set
 * `robots: { index: true, follow: true }`, which every page inherited —
 * including the 404 page, where Next.js also injects its own
 * `<meta name="robots" content="noindex">`, so 404 responses carried two
 * contradicting robots tags. These tests lock in the fix: no robots tag
 * from the layout, Next's own noindex as the only one on 404s, and every
 * page's own noindex metadata still in force.
 */

vi.mock("next/font/google", () => ({ Inter: () => ({ variable: "font-inter", className: "font-inter" }) }));
vi.mock("@/lib/queries", () => ({}));
vi.mock("@/db/newsletter", () => ({}));

const require = createRequire(import.meta.url);
// Next.js's own robots metadata -> meta tag content resolver, so the
// expectations below are exactly what the rendered <meta> would say.
const { resolveRobots } = require("next/dist/lib/metadata/resolvers/resolve-basics") as {
  resolveRobots: (robots: Metadata["robots"]) => { basic: string | null } | null;
};

describe("robots meta tags", () => {
  it("the root layout sets no robots metadata, so ordinary pages get no explicit robots tag from it", async () => {
    const { metadata } = await import("./layout");
    expect(metadata.robots).toBeUndefined();
    expect(resolveRobots(metadata.robots)).toBeNull();
  });

  it("404 pages emit only Next.js's noindex: not-found.tsx adds no robots metadata of its own and Next injects noindex for 404s", async () => {
    const notFoundModule = (await import("./not-found")) as Record<string, unknown>;
    expect(notFoundModule.metadata).toBeUndefined();
    expect(notFoundModule.generateMetadata).toBeUndefined();
    // Next.js 16's app renderer adds <meta name="robots" content="noindex">
    // whenever the page is the 404 page or the status code is > 400 — the
    // single robots tag a 404 response should carry. Guarded here so a Next
    // upgrade that drops this behavior fails loudly instead of silently
    // leaving 404s without any noindex.
    const appRender = readFileSync(require.resolve("next/dist/server/app-render/app-render.js"), "utf8");
    expect(appRender).toMatch(/function NonIndex\([\s\S]*?is404Page \|\| isInvalidStatusCode[\s\S]*?content: 'noindex'/);
  });

  it("pages with their own noindex metadata keep it", async () => {
    const pages: Array<[string, Promise<{ metadata: Metadata }>, string]> = [
      ["/admin", import("./admin/page"), "noindex, nofollow"],
      ["/newsletter/manage", import("./newsletter/manage/page"), "noindex"],
      ["/newsletter/confirm", import("./newsletter/confirm/page"), "noindex"],
    ];
    for (const [route, mod, expected] of pages) {
      const { metadata } = await mod;
      expect(resolveRobots(metadata.robots)?.basic, route).toBe(expected);
    }
  });
});
