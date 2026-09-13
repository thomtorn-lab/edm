// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
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

  it("mobile horizontal padding is reduced (px-2.5, not a bare px-3), and the line-height stays pinned to leading-4", () => {
    render(<FestivalExplorer festivals={[FESTIVAL_WITH_URL]} />);
    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      const classes = select.className.split(/\s+/);
      expect(classes).toContain("px-2.5");
      expect(classes).not.toContain("px-3");
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

describe("FestivalExplorer — final mobile compactness polish (2026-09-13 follow-up, final review adjustment): border weight is trimmed on mobile only, vertical padding stays at py-1.5, still 16px-safe, desktop untouched", () => {
  afterEach(cleanup);

  it("mobile text stays 16px-safe (text-base, not text-xs) even after the compactness pass", () => {
    render(<FestivalExplorer festivals={[FESTIVAL_WITH_URL]} />);
    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      const classes = select.className.split(/\s+/);
      expect(classes).toContain("text-base");
      expect(classes).not.toContain("text-xs");
      expect(classes).toContain("sm:text-xs");
    }
  });

  it("mobile vertical padding stays at py-1.5 (final review adjustment: not reduced to py-1)", () => {
    render(<FestivalExplorer festivals={[FESTIVAL_WITH_URL]} />);
    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      const classes = select.className.split(/\s+/);
      expect(classes).toContain("py-1.5");
      expect(classes).not.toContain("py-1");
    }
  });

  it("desktop keeps the same vertical padding via sm:py-1.5, unaffected by the mobile lightening", () => {
    render(<FestivalExplorer festivals={[FESTIVAL_WITH_URL]} />);
    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      const classes = select.className.split(/\s+/);
      expect(classes).toContain("sm:py-1.5");
    }
  });

  it("mobile border switches to the dimmer border token (border-border, not border-border-strong)", () => {
    render(<FestivalExplorer festivals={[FESTIVAL_WITH_URL]} />);
    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      const classes = select.className.split(/\s+/);
      expect(classes).toContain("border-border");
      expect(classes).not.toContain("border-border-strong");
    }
  });

  it("desktop restores the original stronger border via sm:border-border-strong, unaffected by the mobile lightening", () => {
    render(<FestivalExplorer festivals={[FESTIVAL_WITH_URL]} />);
    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      const classes = select.className.split(/\s+/);
      expect(classes).toContain("sm:border-border-strong");
    }
  });

  it("border width/radius system is unchanged — still a plain 1px border (no border-2/border-0) and rounded-full", () => {
    render(<FestivalExplorer festivals={[FESTIVAL_WITH_URL]} />);
    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      const classes = select.className.split(/\s+/);
      expect(classes).toContain("border");
      expect(classes).toContain("rounded-full");
      expect(classes).not.toContain("border-2");
      expect(classes).not.toContain("border-0");
    }
  });

  it("no viewport zoom-restricting attributes are introduced by this change (layout.tsx untouched)", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/app/layout.tsx"), "utf-8");
    expect(source).not.toContain("user-scalable");
    expect(source).not.toContain("maximum-scale");
  });

  it("filter behavior is unaffected: selecting a country still filters the festival list", () => {
    render(
      <FestivalExplorer
        festivals={[
          FESTIVAL_WITH_URL,
          { ...FESTIVAL_WITH_URL, id: "f2", slug: "other-festival", name: "Other Festival", country: "Germany" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /Other Festival/ })).toBeTruthy();
    const [countrySelect] = screen.getAllByRole("combobox");
    fireEvent.change(countrySelect, { target: { value: "Netherlands" } });
    expect(screen.queryByRole("link", { name: /Other Festival/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Test Festival/ })).toBeTruthy();
  });
});
