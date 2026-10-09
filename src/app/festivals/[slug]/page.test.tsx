import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn();
const permanentRedirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  permanentRedirect: (url: string) => permanentRedirectMock(url),
}));

const { default: FestivalDetailPage } = await import("./page");

describe("Festival detail route — removed, redirects to /festivals (Round 19)", () => {
  it("redirects any old/bookmarked/indexed /festivals/[slug] URL to /festivals instead of 404ing or rendering a redundant detail page", async () => {
    await FestivalDetailPage();
    expect(permanentRedirectMock).toHaveBeenCalledWith("/festivals");
  });

  it("redirects permanently (308 via permanentRedirect), never with the temporary redirect()", async () => {
    redirectMock.mockClear();
    permanentRedirectMock.mockClear();
    await FestivalDetailPage();
    expect(permanentRedirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
