// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import VenueAddressLink from "./VenueAddressLink";

afterEach(cleanup);

describe("VenueAddressLink — venue address -> Google Maps backlog item", () => {
  it("links the full address text to a keyless Google Maps search URL", () => {
    render(<VenueAddressLink address="Kronprinsessegade 54A, 1306 København K" />);
    const link = screen.getByRole("link", { name: /Kronprinsessegade 54A, 1306 København K/ });
    expect(link.getAttribute("href")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Kronprinsessegade%2054A%2C%201306%20K%C3%B8benhavn%20K",
    );
  });

  it("opens in a new tab with safe rel attributes", () => {
    render(<VenueAddressLink address="Test St 1" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders a decorative map-pin icon alongside the address", () => {
    const { container } = render(<VenueAddressLink address="Test St 1" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("carries an accessible 'opens in a new tab' hint for screen readers", () => {
    render(<VenueAddressLink address="Test St 1" />);
    expect(screen.getByText(/opens Google Maps in a new tab/)).toBeDefined();
  });

  it("renders nothing for an empty address — never a broken map link", () => {
    const { container } = render(<VenueAddressLink address="" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a whitespace-only address", () => {
    const { container } = render(<VenueAddressLink address="   " />);
    expect(container.innerHTML).toBe("");
  });

  it("trims surrounding whitespace before building the link and displaying text", () => {
    render(<VenueAddressLink address="  Test St 1  " />);
    const link = screen.getByRole("link", { name: /^Test St 1/ });
    expect(link.getAttribute("href")).toBe("https://www.google.com/maps/search/?api=1&query=Test%20St%201");
  });
});
