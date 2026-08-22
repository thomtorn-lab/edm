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

describe("globals.css — no unlayered universal border-color reset (Round 15 cascade fix)", () => {
  it("does not redeclare `* { border-color: ... }` outside a Tailwind @layer", () => {
    // The exact same class of bug as the anchor-color fix above, found via a
    // real headless-browser check while building the Filters active-state
    // accent border: an unlayered `* { border-color: var(--border); }` rule
    // wins over every border-color utility (living in @layer utilities)
    // regardless of specificity, silently forcing every border-accent /
    // border-border-strong / etc. on every element in the app to render as
    // the plain --border token instead. Confirmed this broke even the
    // already-shipped active-pill border (EventExplorer.tsx's pillClasses).
    // Every border-side utility in this codebase already pairs with an
    // explicit border-color utility, so no element relies on this rule for
    // an implicit default — it must never come back.
    const css = readGlobalsCss();
    const bareUniversalBorderRule = /(^|\n)\s*\*\s*\{[^}]*border-color\s*:/;
    expect(bareUniversalBorderRule.test(css)).toBe(false);
  });
});
