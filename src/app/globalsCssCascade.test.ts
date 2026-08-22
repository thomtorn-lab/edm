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

describe("globals.css — no outer focus ring on accent-select/search-field, internal focus treatment instead (Round 17 fix)", () => {
  it("suppresses the outline entirely for Genre/Venue and Search and replaces it with a border-color change on the control itself", () => {
    // Root cause of the "extra outer ring" report (both the original purple
    // version and the follow-up neutral-ring version): Chromium marks
    // <select> and <input type="search"> as :focus-visible even on a plain
    // mouse click (unlike <button>), so the sitewide
    // `:focus-visible { outline: 2px solid var(--focus-ring); }` rule above
    // always draws a SECOND boundary outside these controls' own border on
    // basically every interaction — recoloring that ring (the earlier fix)
    // still left a visible second ring, just not purple. The only way to
    // get back to a single boundary is to not render an outer ring at all
    // for these three controls and signal focus via the control's own
    // border instead. These rules are unlayered so they beat the Tailwind
    // border-color utilities (border-accent / border-border-strong) in
    // @layer utilities regardless of specificity — see the border-color
    // reset test above for why that's the established, intentional pattern
    // here, not a bug to avoid.
    const css = readGlobalsCss();
    expect(/\.accent-select:focus-visible,\s*\n\s*\.search-field:focus-visible\s*\{\s*\n\s*outline\s*:\s*none;/.test(css)).toBe(true);
    // Inactive Genre/Venue and Search have no purple to fall back on —
    // focus must still show a visible internal border-color change.
    expect(/\.accent-select:focus-visible:not\(\.border-accent\),\s*\n\s*\.search-field:focus-visible\s*\{\s*\n\s*border-color\s*:\s*var\(--text-secondary\);/.test(css)).toBe(true);
    // Active Genre/Venue keeps the purple language, just a brighter shade,
    // so keyboard focus stays locatable without a second boundary.
    expect(/\.accent-select\.border-accent:focus-visible\s*\{\s*\n\s*border-color\s*:\s*var\(--accent-strong\);/.test(css)).toBe(true);
    // Guard against this drifting back to an outer-ring approach for these
    // three controls specifically.
    expect(/\.accent-select:focus-visible[^}]*outline-color/.test(css)).toBe(false);
    expect(/\.search-field:focus-visible[^}]*outline-color/.test(css)).toBe(false);
  });

  it("leaves the sitewide :focus-visible outline rule untouched for every other element", () => {
    const css = readGlobalsCss();
    expect(/:focus-visible\s*\{\s*\n\s*outline\s*:\s*2px solid var\(--focus-ring\);\s*\n\s*outline-offset\s*:\s*2px;\s*\n\}/.test(css)).toBe(true);
  });
});
