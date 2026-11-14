// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ArtistVideoPreview, { playerStateFromMessage, SOUND_START_GRACE_MS, videoPlayerTitle, youtubeEmbedUrl } from "./ArtistVideoPreview";

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

describe("playerStateFromMessage", () => {
  it("reads the state from YouTube's widget messages (JSON strings or objects)", () => {
    expect(playerStateFromMessage(JSON.stringify({ event: "onStateChange", info: 1 }))).toBe(1);
    expect(playerStateFromMessage(JSON.stringify({ event: "infoDelivery", info: { playerState: 3, currentTime: 0 } }))).toBe(3);
    expect(playerStateFromMessage({ event: "initialDelivery", info: { playerState: -1 } })).toBe(-1);
  });

  it("ignores anything else", () => {
    expect(playerStateFromMessage("not json")).toBeNull();
    expect(playerStateFromMessage(JSON.stringify({ event: "infoDelivery", info: { volume: 50 } }))).toBeNull();
    expect(playerStateFromMessage(null)).toBeNull();
    expect(playerStateFromMessage(42)).toBeNull();
  });
});

describe("youtubeEmbedUrl", () => {
  it("uses the privacy-enhanced embed domain and autoplays (the press already asked for the video)", () => {
    expect(youtubeEmbedUrl("abc123XYZ")).toBe("https://www.youtube-nocookie.com/embed/abc123XYZ?autoplay=1&playsinline=1&enablejsapi=1");
  });

  it("passes our origin so the player accepts play/mute commands from the page", () => {
    expect(youtubeEmbedUrl("abc", "https://www.electroniccph.com")).toBe(
      "https://www.youtube-nocookie.com/embed/abc?autoplay=1&playsinline=1&enablejsapi=1&origin=https%3A%2F%2Fwww.electroniccph.com",
    );
  });

  it("encodes the id so it can never change the URL's path or query", () => {
    expect(youtubeEmbedUrl("a/b?c")).toBe("https://www.youtube-nocookie.com/embed/a%2Fb%3Fc?autoplay=1&playsinline=1&enablejsapi=1");
  });
});

/**
 * Click-to-load (GDPR review, 2026-10-30): before the visitor presses play,
 * the rendered markup must not reference any YouTube/Google resource — no
 * iframe, image, link, script or other URL a browser would fetch.
 */
describe("ArtistVideoPreview click-to-load", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

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
    expect(iframes[0].getAttribute("src")).toBe(
      `https://www.youtube-nocookie.com/embed/abc123XYZ?autoplay=1&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`,
    );
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

  /** One-press start (2026-11-14): after load the page itself tells the player to play, and falls back to muted if sound is blocked. */
  function loadPlayer() {
    const { container } = renderPreview();
    fireEvent.click(screen.getByRole("button", { name: /^Play YouTube video/ }));
    const iframe = container.querySelector("iframe")!;
    const posted: Array<{ event: string; func?: string }> = [];
    const targets: string[] = [];
    vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(((msg: string, target: string) => {
      posted.push(JSON.parse(msg));
      targets.push(target);
    }) as typeof window.postMessage);
    fireEvent.load(iframe);
    return { iframe, posted, targets };
  }

  function playerSays(iframe: HTMLIFrameElement, state: number, origin = "https://www.youtube-nocookie.com") {
    window.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify({ event: "onStateChange", info: state }), origin, source: iframe.contentWindow }),
    );
  }

  it("sends playVideo to the player as soon as it loads, only to the embed origin", () => {
    const { posted, targets } = loadPlayer();
    expect(posted.map((m) => m.func ?? m.event)).toEqual(["listening", "playVideo"]);
    expect(new Set(targets)).toEqual(new Set(["https://www.youtube-nocookie.com"]));
  });

  it("mutes and plays when the browser blocked the start with sound", () => {
    vi.useFakeTimers();
    try {
      const { posted } = loadPlayer();
      vi.advanceTimersByTime(SOUND_START_GRACE_MS);
      expect(posted.map((m) => m.func ?? m.event)).toEqual(["listening", "playVideo", "mute", "playVideo"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the sound on when the video started by itself", () => {
    vi.useFakeTimers();
    try {
      const { iframe, posted } = loadPlayer();
      playerSays(iframe, 1);
      vi.advanceTimersByTime(SOUND_START_GRACE_MS);
      expect(posted.map((m) => m.func ?? m.event)).not.toContain("mute");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores state messages from any other origin", () => {
    vi.useFakeTimers();
    try {
      const { iframe, posted } = loadPlayer();
      playerSays(iframe, 1, "https://evil.example");
      vi.advanceTimersByTime(SOUND_START_GRACE_MS);
      expect(posted.map((m) => m.func ?? m.event)).toContain("mute");
    } finally {
      vi.useRealTimers();
    }
  });
});
