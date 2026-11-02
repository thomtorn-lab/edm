// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ArtistVideoPreview, { videoPlayerTitle, youtubeEmbedUrl } from "./ArtistVideoPreview";

/** The YouTube iframe's accessible name (2026-10-24). */
describe("videoPlayerTitle", () => {
  it("uses the video's own title when there is one", () => {
    expect(videoPlayerTitle({ videoTitle: "steamboi | REX Radio (10.11.25)", artistName: null, eventTitle: "Steamboi" })).toBe(
      "YouTube video: steamboi | REX Radio (10.11.25)",
    );
  });

  it("falls back to the artist the video was matched or chosen for", () => {
    expect(videoPlayerTitle({ videoTitle: null, artistName: "STEAMBOI", eventTitle: "Night" })).toBe("YouTube video: STEAMBOI");
  });

  it("falls back to the event title for an admin-chosen video without an artist", () => {
    expect(videoPlayerTitle({ videoTitle: null, artistName: null, eventTitle: "Warehouse Night" })).toBe("YouTube video for Warehouse Night");
  });

  it("treats blank titles/names as missing, so the player is never unnamed", () => {
    expect(videoPlayerTitle({ videoTitle: "  ", artistName: " ", eventTitle: "Warehouse Night" })).toBe("YouTube video for Warehouse Night");
    expect(videoPlayerTitle({ videoTitle: "", artistName: null, eventTitle: "" })).toBe("YouTube video for this event");
  });
});

describe("youtubeEmbedUrl", () => {
  it("uses the privacy-enhanced embed domain and autoplays (the press already asked for the video)", () => {
    expect(youtubeEmbedUrl("abc123XYZ")).toBe("https://www.youtube-nocookie.com/embed/abc123XYZ?autoplay=1");
  });

  it("encodes the id so it can never change the URL's path or query", () => {
    expect(youtubeEmbedUrl("a/b?c")).toBe("https://www.youtube-nocookie.com/embed/a%2Fb%3Fc?autoplay=1");
  });
});

/**
 * Click-to-load (GDPR review, 2026-10-30): before the visitor presses play,
 * the rendered markup must not reference any YouTube/Google resource — no
 * iframe, image, link, script or other URL a browser would fetch.
 */
describe("ArtistVideoPreview click-to-load", () => {
  afterEach(cleanup);

  /** A URL (absolute or protocol-relative) on any host YouTube or Google serves the player or its assets from. */
  const GOOGLE_URL = /(?:https?:)?\/\/[^/\s"']*(?:youtube|youtu\.be|ytimg|googlevideo|google|gstatic|doubleclick|ggpht)/i;

  function renderPreview(videoTitle: string | null = "Eric Prydz DJ Set") {
    return render(<ArtistVideoPreview artistName="Eric Prydz" eventTitle="Night" videoId="abc123XYZ" videoTitle={videoTitle} />);
  }

  it("renders no iframe, image, script or embed before the visitor presses play", () => {
    const { container } = renderPreview();
    expect(container.querySelector("iframe, img, script, object, embed, video, link, source, picture")).toBeNull();
  });

  it("puts no YouTube/Google URL in any attribute before play", () => {
    const { container } = renderPreview();
    const urls = Array.from(container.querySelectorAll("*")).flatMap((el) => Array.from(el.attributes, (attr) => attr.value));
    expect(urls.filter((value) => GOOGLE_URL.test(value))).toEqual([]);
    expect(container.innerHTML).not.toMatch(GOOGLE_URL);

    // The same check does see the player once it is loaded.
    fireEvent.click(screen.getByRole("button", { name: /^Play YouTube video/ }));
    expect(container.innerHTML).toMatch(GOOGLE_URL);
  });

  it("shows a play button named after the video, described by the data-sharing notice", () => {
    renderPreview();
    const button = screen.getByRole("button", { name: "Play YouTube video: Eric Prydz DJ Set" });
    const notice = document.getElementById(button.getAttribute("aria-describedby")!);
    expect(notice?.textContent).toContain("loads the video from YouTube (Google)");
    expect(notice?.textContent).toContain("receives your IP address");
    expect(notice?.textContent).toContain("may store information on your device");
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
  });

  it("shows the stored video title on the button, and nothing extra when there is none", () => {
    renderPreview();
    expect(screen.getByText("Eric Prydz DJ Set")).toBeTruthy();
    cleanup();
    renderPreview(null);
    expect(screen.getByRole("button", { name: "Play YouTube video: Eric Prydz" }).textContent).toBe("Play video");
  });

  it("loads the privacy-enhanced embed only after the press, with autoplay, and drops the button", () => {
    const { container } = renderPreview();
    fireEvent.click(screen.getByRole("button", { name: /^Play YouTube video/ }));

    const iframes = container.querySelectorAll("iframe");
    expect(iframes).toHaveLength(1);
    expect(iframes[0].getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/abc123XYZ?autoplay=1");
    expect(iframes[0].getAttribute("title")).toBe("YouTube video: Eric Prydz DJ Set");
    expect(iframes[0].getAttribute("allow")).toContain("autoplay");
    expect(iframes[0].getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(screen.queryByRole("button", { name: /^Play YouTube video/ })).toBeNull();
  });

  it("never writes to the page's own browser storage", () => {
    localStorage.clear();
    sessionStorage.clear();
    renderPreview();
    fireEvent.click(screen.getByRole("button", { name: /^Play YouTube video/ }));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });
});
