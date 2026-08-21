import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readGlobalsCss(): string {
  return readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf-8");
}

describe("globals.css — no unlayered anchor color reset (Round 11 cascade fix)", () => {
  it("does not redeclare `a { color: inherit; }` outside a Tailwind @layer", () => {
    // Root cause of a real production bug: Tailwind's own preflight already
    // sets `a { color: inherit; }` inside `@layer base`, so every
    // hover:text-*/focus-visible:text-* utility (living in @layer utilities)
    // correctly overrides it. Re-adding the same rule directly in this file,
    // unlayered, makes it win over ALL Tailwind utilities regardless of
    // specificity — silently breaking every text-color hover/focus state on
    // every <a>/<Link> in the app. See src/components/EventRow.tsx and
    // src/app/events/[slug]/page.tsx for the components this protects.
    const css = readGlobalsCss();
    const bareAnchorRule = /(^|\n)\s*a\s*\{[^}]*color\s*:\s*inherit/;
    expect(bareAnchorRule.test(css)).toBe(false);
  });
});
