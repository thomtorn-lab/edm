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
