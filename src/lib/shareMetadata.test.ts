import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildEventShareDescription, buildShareMetadata, FALLBACK_SHARE_IMAGE, shareImageForEvent, shareTitle } from "./shareMetadata";

describe("FALLBACK_SHARE_IMAGE — the approved static branded fallback", () => {
  it("points at public/og/default.png, a 1200×630 PNG small enough for every platform", () => {
    expect(FALLBACK_SHARE_IMAGE).toMatchObject({ url: "/og/default.png", width: 1200, height: 630, type: "image/png" });
    expect(FALLBACK_SHARE_IMAGE.alt).toBeTruthy();
    const file = readFileSync(path.join(__dirname, "../../public/og/default.png"));
    expect(file.subarray(1, 4).toString("ascii")).toBe("PNG");
    // PNG IHDR: width and height are big-endian uint32 at bytes 16 and 20.
    expect(file.readUInt32BE(16)).toBe(1200);
    expect(file.readUInt32BE(20)).toBe(630);
    expect(file.length).toBeLessThan(300 * 1024);
  });
});

describe("shareImageForEvent", () => {
  it("uses the event's own https image, with no invented dimensions", () => {
    const img = shareImageForEvent("https://culture-box.com/wp-content/uploads/2026/07/x-1300x746.jpg", "Timo Maas");
    expect(img).toEqual({ url: "https://culture-box.com/wp-content/uploads/2026/07/x-1300x746.jpg", alt: "Timo Maas" });
  });

  it("accepts WebP and large images as they are", () => {
    expect(shareImageForEvent("https://hvaderpaa.dk/images/events/13006.webp", "E").url).toBe("https://hvaderpaa.dk/images/events/13006.webp");
    expect(shareImageForEvent("https://alicecph.com/content/uploads/2026/06/Bruno-Berle-scaled.jpg", "E").url).toBe(
      "https://alicecph.com/content/uploads/2026/06/Bruno-Berle-scaled.jpg",
    );
  });

  it("falls back for a missing, blank or malformed URL", () => {
    expect(shareImageForEvent(null, "E")).toBe(FALLBACK_SHARE_IMAGE);
    expect(shareImageForEvent(undefined, "E")).toBe(FALLBACK_SHARE_IMAGE);
    expect(shareImageForEvent("  ", "E")).toBe(FALLBACK_SHARE_IMAGE);
    expect(shareImageForEvent("not a url", "E")).toBe(FALLBACK_SHARE_IMAGE);
  });

  it("never rewrites http to https — an http image falls back", () => {
    expect(shareImageForEvent("http://gravitycph.dk/wp-content/uploads/2026/05/AvB_PressPic.jpg", "E")).toBe(FALLBACK_SHARE_IMAGE);
  });

  it("maps a stored KultuNaut 154×154 thumbnail to the 484×252 copy, with its known size", () => {
    const thumb = "https://www.kultunaut.dk/perl/images/billetto/W154H154_0lod2fy098jdy9b7.jpg";
    expect(shareImageForEvent(thumb, "Electro Werkz")).toEqual({
      url: "https://www.kultunaut.dk/perl/images/billetto/W484H252_0lod2fy098jdy9b7.jpg",
      width: 484,
      height: 252,
      alt: "Electro Werkz",
    });
  });

  it("keeps a KultuNaut 484×252 image with its known size, and falls back for any other too-small KultuNaut size", () => {
    expect(shareImageForEvent("https://www.kultunaut.dk/perl/images/billetlugen4/W484H252_a.jpg", "E")).toEqual({
      url: "https://www.kultunaut.dk/perl/images/billetlugen4/W484H252_a.jpg",
      width: 484,
      height: 252,
      alt: "E",
    });
    expect(shareImageForEvent("https://www.kultunaut.dk/perl/images/x/W100H100_a.jpg", "E")).toBe(FALLBACK_SHARE_IMAGE);
  });
});

describe("buildShareMetadata", () => {
  it("returns the complete Open Graph + large Twitter card set, defaulting to the fallback image", () => {
    expect(buildShareMetadata({ title: shareTitle("Venues"), description: "D", path: "/venues" })).toEqual({
      openGraph: {
        type: "website",
        siteName: "Electronic CPH",
        locale: "en_GB",
        url: "/venues",
        title: "Venues — Electronic CPH",
        description: "D",
        images: [FALLBACK_SHARE_IMAGE],
      },
      twitter: {
        card: "summary_large_image",
        title: "Venues — Electronic CPH",
        description: "D",
        images: [{ url: FALLBACK_SHARE_IMAGE.url, alt: FALLBACK_SHARE_IMAGE.alt }],
      },
    });
  });

  it("uses the given image, and leaves title/description/url unset for the layout default", () => {
    const image = { url: "https://example.com/a.jpg", alt: "A" };
    expect(buildShareMetadata({ title: "T", description: "D", path: "/x", image }).openGraph).toMatchObject({ images: [image] });
    const layoutDefault = buildShareMetadata({});
    expect(layoutDefault.openGraph).toEqual({ type: "website", siteName: "Electronic CPH", locale: "en_GB", images: [FALLBACK_SHARE_IMAGE] });
    expect(layoutDefault.twitter).toEqual({ card: "summary_large_image", images: [{ url: FALLBACK_SHARE_IMAGE.url, alt: FALLBACK_SHARE_IMAGE.alt }] });
  });
});

describe("buildEventShareDescription", () => {
  const base = {
    title: "Night Shift",
    artists: ["DJ One"],
    showArtists: true,
    genres: ["House"],
    venueName: "Culture Box",
    city: "Copenhagen",
    dateLabel: "Friday 20 November 2026",
  };

  it("keeps the existing full form when everything is known", () => {
    expect(buildEventShareDescription(base)).toBe("Night Shift: DJ One — House at Culture Box, Copenhagen, on Friday 20 November 2026.");
  });

  it("drops a missing genre without a dangling dash", () => {
    expect(buildEventShareDescription({ ...base, genres: [] })).toBe("Night Shift: DJ One at Culture Box, Copenhagen, on Friday 20 November 2026.");
  });

  it("drops a missing lineup, and both", () => {
    expect(buildEventShareDescription({ ...base, artists: [] })).toBe("Night Shift — House at Culture Box, Copenhagen, on Friday 20 November 2026.");
    expect(buildEventShareDescription({ ...base, artists: [], genres: [] })).toBe("Night Shift at Culture Box, Copenhagen, on Friday 20 November 2026.");
  });

  it("does not repeat a lineup the title already names, and shortens a long lineup", () => {
    expect(buildEventShareDescription({ ...base, title: "DJ One", showArtists: false })).toBe(
      "DJ One — House at Culture Box, Copenhagen, on Friday 20 November 2026.",
    );
    expect(buildEventShareDescription({ ...base, artists: ["A", "B", "C", "D", "E", "F"] })).toBe(
      "Night Shift: A, B, C, D and 2 more — House at Culture Box, Copenhagen, on Friday 20 November 2026.",
    );
  });
});
