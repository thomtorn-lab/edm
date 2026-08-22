// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import FestivalsPage from "./page";

describe("/festivals — top-level heading hierarchy (Round 19)", () => {
  afterEach(cleanup);

  it("renders the H1 in the accent purple with no eyebrow line above it", () => {
    render(<FestivalsPage />);
    const heading = screen.getByRole("heading", { level: 1, name: "Festivals" });
    expect(heading.className).toContain("text-accent");
    expect(heading.className).not.toContain("text-text-primary");
    expect(screen.queryByText(/^FESTIVALS$/i, { selector: "p" })).toBeNull();
  });

  it("does not turn the body copy purple", () => {
    render(<FestivalsPage />);
    const body = screen.getByText(/A curated guide to the European electronic music festivals/);
    expect(body.className).not.toContain("text-accent");
  });
});
