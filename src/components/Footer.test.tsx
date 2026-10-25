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
