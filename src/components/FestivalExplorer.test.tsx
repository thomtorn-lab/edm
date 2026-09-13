// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import FestivalExplorer from "./FestivalExplorer";
import type { FestivalRecord } from "@/lib/types";

const FESTIVAL_WITH_URL: FestivalRecord = {
  id: "f1",
  slug: "test-festival",
  name: "Test Festival",
  country: "Netherlands",
  location: "Amsterdam",
  typicalMonth: "July",
  edition: { kind: "confirmed", dates: "12–14 Jul 2026" },
  genres: ["techno"],
  description: "A test festival.",
  officialUrl: "https://testfestival.example.com/",
  ticketUrl: null,
  imageUrl: null,
};

describe("FestivalExplorer — festival entries link out, not to a removed detail page (Round 19)", () => {
  afterEach(cleanup);

  it("links the festival name directly to its official site, in a new tab", () => {
    render(<FestivalExplorer festivals={[FESTIVAL_WITH_URL]} />);
    const link = screen.getByRole("link", { name: /Test Festival/ });
    expect(link.getAttribute("href")).toBe("https://testfestival.example.com/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    // Never links to the removed internal /festivals/[slug] route.
    expect(link.getAttribute("href")).not.toMatch(/^\/festivals\//);
  });

  it("renders the festival name as plain, non-clickable text when there is no official URL", () => {
    const festival = { ...FESTIVAL_WITH_URL, officialUrl: "" };
    render(<FestivalExplorer festivals={[festival]} />);
    expect(screen.queryByRole("link", { name: /Test Festival/ })).toBeNull();
    expect(screen.getByText("Test Festival")).toBeTruthy();
  });
});

describe("FestivalExplorer — mobile iOS auto-zoom fix (2026-09-13): the Country/Month/Genre filter selects render at >= 16px on mobile so focusing them never triggers Safari's viewport zoom, while desktop keeps its original compact size", () => {
  afterEach(cleanup);

  it("all three filter selects render mobile-effective text-base (16px), not a bare text-xs (12px)", () => {
    render(<FestivalExplorer festivals={[FESTIVAL_WITH_URL]} />);
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(3);
    for (const select of selects) {
      const classes = select.className.split(/\s+/);
      expect(classes).toContain("text-base");
      expect(classes).not.toContain("text-xs");
    }
  });

  it("all three filter selects still carry sm:text-xs — desktop's original 12px size is unchanged, only overridden below the sm breakpoint", () => {
    render(<FestivalExplorer festivals={[FESTIVAL_WITH_URL]} />);
    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      const classes = select.className.split(/\s+/);
      expect(classes).toContain("sm:text-xs");
    }
  });
});

describe("FestivalExplorer — mobile visual-weight refinement (2026-09-13): the 16px-safe filter selects read lighter/more compact on mobile without dropping below 16px, while desktop is completely unaffected", () => {
  afterEach(cleanup);

  it("mobile drops to font-medium (not the heavier font-semibold) and tracking-normal (not tracking-wide), while text-base (16px) is preserved", () => {
    render(<FestivalExplorer festivals={[FESTIVAL_WITH_URL]} />);
    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      const classes = select.className.split(/\s+/);
      expect(classes).toContain("text-base");
      expect(classes).toContain("font-medium");
      expect(classes).not.toContain("font-semibold");
      expect(classes).toContain("tracking-normal");
      expect(classes).not.toContain("tracking-wide");
    }
  });

  it("mobile horizontal padding is reduced (px-2.5, not px-3) while vertical padding (py-1.5) — and so the control's touch-target height — is unchanged", () => {
    render(<FestivalExplorer festivals={[FESTIVAL_WITH_URL]} />);
    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      const classes = select.className.split(/\s+/);
      expect(classes).toContain("px-2.5");
      expect(classes).not.toContain("px-3");
      expect(classes).toContain("py-1.5");
      expect(classes).toContain("leading-4");
    }
  });

  it("desktop restores the exact original weight/tracking/padding via sm: overrides — sm:font-semibold, sm:tracking-wide, sm:px-3 — so desktop styling is completely unaffected by the mobile refinement", () => {
    render(<FestivalExplorer festivals={[FESTIVAL_WITH_URL]} />);
    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      const classes = select.className.split(/\s+/);
      expect(classes).toContain("sm:font-semibold");
      expect(classes).toContain("sm:tracking-wide");
      expect(classes).toContain("sm:px-3");
    }
  });

  it("border radius and colors are untouched — still rounded-full, text-text-secondary, hover:text-text-primary", () => {
    render(<FestivalExplorer festivals={[FESTIVAL_WITH_URL]} />);
    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      const classes = select.className.split(/\s+/);
      expect(classes).toContain("rounded-full");
      expect(classes).toContain("text-text-secondary");
      expect(classes).toContain("hover:text-text-primary");
    }
  });
});
