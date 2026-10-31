// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Footer from "./Footer";

afterEach(cleanup);

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
