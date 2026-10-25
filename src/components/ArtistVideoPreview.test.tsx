import { describe, expect, it } from "vitest";
import { videoPlayerTitle } from "./ArtistVideoPreview";

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
