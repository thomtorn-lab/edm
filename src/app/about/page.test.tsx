// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AboutPage from "./page";

describe("About page (Round 8)", () => {
  afterEach(cleanup);

  it("renders the approved copy — geographic positioning is Copenhagen, not Copenhagen/Frederiksberg", () => {
    render(<AboutPage />);
    expect(
      screen.getByText(/Electronic CPH is a fast, curated index of electronic music events and concerts in Copenhagen/),
    ).toBeTruthy();
    expect(screen.queryByText(/Copenhagen\/Frederiksberg/)).toBeNull();
  });

  it('links "Get in touch" to /contact', () => {
    render(<AboutPage />);
    const link = screen.getByRole("link", { name: "Get in touch" });
    expect(link.getAttribute("href")).toBe("/contact");
  });

  it('links "Suggest an event" to /suggest-event', () => {
    render(<AboutPage />);
    const link = screen.getByRole("link", { name: "Suggest an event" });
    expect(link.getAttribute("href")).toBe("/suggest-event");
  });

  it("includes the non-official-source disclaimer without overclaiming completeness", () => {
    render(<AboutPage />);
    expect(
      screen.getByText(/it is not the official source for any event/),
    ).toBeTruthy();
  });
});

describe("About page — top-level heading hierarchy (Round 19)", () => {
  afterEach(cleanup);

  it("renders the H1 in the accent purple with no eyebrow line above it", () => {
    render(<AboutPage />);
    const heading = screen.getByRole("heading", { level: 1, name: "About" });
    expect(heading.className).toContain("text-accent");
    expect(heading.className).not.toContain("text-text-primary");
    expect(screen.queryByText(/^ABOUT$/i, { selector: "p" })).toBeNull();
  });

  it("does not turn the body copy purple", () => {
    render(<AboutPage />);
    const body = screen.getByText(/Electronic CPH is a fast, curated index/);
    expect(body.className).not.toContain("text-accent");
  });
});
