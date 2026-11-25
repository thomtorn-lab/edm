// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ArtistAlertsBanner from "./ArtistAlertsBanner";

afterEach(cleanup);

describe("ArtistAlertsBanner", () => {
  it("is one link to /artists, and no button or nested link", () => {
    const { container } = render(<ArtistAlertsBanner />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/artists");
    expect(screen.getByRole("link", { name: /Artist Alerts/ })).toBeTruthy();
    expect(container.querySelector("button")).toBeNull();
  });

  it("keeps the desktop layout (md+) exactly as before: label, explanation, FIND ARTISTS → at the right", () => {
    const { container } = render(<ArtistAlertsBanner />);
    const desktop = container.querySelector("a > span.md\\:flex") as HTMLElement;
    expect(desktop.className.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "md:flex", "md:min-h-[50px]", "md:py-0"]));
    expect(desktop.textContent).toBe("Artist AlertsFind artists →Get email alerts for new events with artists you follow.");
  });

  it("shows ARTIST ALERTS · Find Artists with the arrow at the end, then the explanation, below md (2026-11-25)", () => {
    const { container } = render(<ArtistAlertsBanner />);
    const mobile = container.querySelector("a > span.md\\:hidden") as HTMLElement;
    expect(mobile.textContent).toBe("Artist Alerts·Find Artists→Get email alerts for new events with artists you follow.");
    const [heading, arrow] = Array.from(mobile.children) as HTMLElement[];
    expect(heading.textContent).toBe("Artist Alerts·Find Artists");
    expect(arrow.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Find Artists").className).toContain("whitespace-nowrap");
  });
});
