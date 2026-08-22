import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

const { default: FestivalDetailPage } = await import("./page");

describe("Festival detail route — removed, redirects to /festivals (Round 19)", () => {
  it("redirects any old/bookmarked/indexed /festivals/[slug] URL to /festivals instead of 404ing or rendering a redundant detail page", async () => {
    await FestivalDetailPage();
    expect(redirectMock).toHaveBeenCalledWith("/festivals");
  });
});
