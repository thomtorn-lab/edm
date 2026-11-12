// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import Footer from "./Footer";

afterEach(cleanup);

describe("Footer social links", () => {
  it("links to Electronic CPH's official Instagram profile in a new tab, without tracking parameters", () => {
    render(<Footer />);
    const link = screen.getByRole("link", { name: "Electronic CPH on Instagram (opens in a new tab)" });
    expect(link.getAttribute("href")).toBe("https://www.instagram.com/electronic_cph/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("links to Electronic CPH's official Facebook page by its permanent profile URL, in a new tab", () => {
    render(<Footer />);
    const link = screen.getByRole("link", { name: "Electronic CPH on Facebook (opens in a new tab)" });
    expect(link.getAttribute("href")).toBe("https://www.facebook.com/profile.php?id=61593650797017");
    expect(link.getAttribute("href")).not.toMatch(/\/share\/|mibextid/);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("groups the social links in a labelled list separate from the footer nav", () => {
    render(<Footer />);
    const list = screen.getByRole("list", { name: "Electronic CPH on social media" });
    expect(within(list).getAllByRole("link")).toHaveLength(2);
    const nav = screen.getByRole("navigation", { name: "Footer" });
    expect(within(nav).queryByRole("link", { name: /Instagram|Facebook/ })).toBeNull();
  });
});

// Genre landing pages (2026-10-31): every page links to the approved genre
// pages from the footer — and to no other genre URL.
describe("Footer — genre links", () => {
  it("links to /genres/techno, /genres/house and /genres/trance, and no other genre page", () => {
    render(<Footer />);
    const genreLinks = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/genres/"));
    expect(genreLinks.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Techno", "/genres/techno"],
      ["House", "/genres/house"],
      ["Trance", "/genres/trance"],
    ]);
  });
});

// Footer redesign (2026-11-03): two labelled link groups and identity text.
// Back to top is the site-wide floating BackToTopButton, not in the footer.
describe("Footer — redesign structure", () => {
  it("shows the identity text", () => {
    render(<Footer />);
    expect(screen.getByText("Electronic CPH")).toBeTruthy();
    expect(screen.getByText("An independent index of electronic music events in Copenhagen.")).toBeTruthy();
  });

  it("keeps the primary links, in order, in the Footer nav", () => {
    render(<Footer />);
    const nav = screen.getByRole("navigation", { name: "Footer" });
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Events", "/"],
      ["Venues", "/venues"],
      ["Festivals", "/festivals"],
      ["Techno", "/genres/techno"],
      ["House", "/genres/house"],
      ["Trance", "/genres/trance"],
    ]);
  });

  it("adds Artist alerts after Festivals, in the first column, when Artist Alerts takes signups", () => {
    for (const mode of ["test", "live"]) {
      process.env.ARTIST_ALERTS_MODE = mode;
      render(<Footer />);
      const nav = screen.getByRole("navigation", { name: "Footer" });
      expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
        ["Events", "/"],
        ["Venues", "/venues"],
        ["Festivals", "/festivals"],
        ["Artist alerts", "/artists"],
        ["Techno", "/genres/techno"],
        ["House", "/genres/house"],
        ["Trance", "/genres/trance"],
      ]);
      expect(nav.querySelector("ul")!.className).toContain("grid-rows-4");
      cleanup();
    }
    delete process.env.ARTIST_ALERTS_MODE;
  });

  it("keeps the information links in their own nav", () => {
    render(<Footer />);
    const nav = screen.getByRole("navigation", { name: "Footer information" });
    const links = within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual(
      expect.arrayContaining([
        ["About", "/about"],
        ["Suggest an event", "/suggest-event"],
        ["Contact", "/contact"],
        ["Privacy", "/privacy"],
      ]),
    );
  });

  it("does not render its own Back to top button", () => {
    render(<Footer />);
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();
  });
});
