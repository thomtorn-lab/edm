// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

// Footer redesign (2026-11-03): two labelled link groups, identity text and
// the footer's own back-to-top button.
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

  it("has a labelled back-to-top button that smooth-scrolls to the top", () => {
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    render(<Footer />);
    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});
