// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ArtistAlertsBanner from "./ArtistAlertsBanner";

afterEach(cleanup);

describe("ArtistAlertsBanner", () => {
  it("is one link to /artists with the agreed text, and no button or nested link", () => {
    const { container } = render(<ArtistAlertsBanner />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/artists");
    expect(links[0].textContent).toBe("Artist Alerts·Find Artists→Get email alerts for new events with artists you follow.");
    expect(screen.getByRole("link", { name: /Artist Alerts/ })).toBeTruthy();
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("ArtistAlertsBanner layout (2026-11-25)", () => {
  it("shows Find Artists on every width, with the arrow on its own at the end of the heading row", () => {
    render(<ArtistAlertsBanner />);
    const cta = screen.getByText("Find Artists");
    expect(cta.className.split(/\s+/)).toEqual(expect.arrayContaining(["font-medium", "text-sm"]));
    expect(cta.className.split(/\s+/)).not.toContain("hidden");
    const arrow = screen.getByText("→");
    expect(arrow.getAttribute("aria-hidden")).toBe("true");
    expect(arrow.previousElementSibling?.contains(screen.getByText("Artist Alerts"))).toBe(true);
  });

  it("keeps the previous height budget on md+ (50px inside: 18px + 4px + 16px + 2×6px)", () => {
    const { container } = render(<ArtistAlertsBanner />);
    const inner = container.querySelector("a > span") as HTMLElement;
    expect(inner.className.split(/\s+/)).toEqual(expect.arrayContaining(["md:min-h-[50px]", "md:py-1.5", "md:gap-y-1"]));
    expect(screen.getByText(/Get email alerts/).className).toContain("md:leading-4");
  });
});
