import { beforeEach, describe, expect, it, vi } from "vitest";

// The report's "shown today" must be exactly what the event page renders.
// This runs the page's own query function against a fake db and compares.
const state: { rows: Record<string, unknown>[] } = { rows: [] };
vi.mock("@/db/client", () => ({
  db: { select: () => ({ from: () => ({ where: async () => state.rows }) }) },
}));

import { getArtistYoutubePreviewForLineup } from "@/lib/queries";
import { shownPreviewArtist, type CacheRow } from "./youtubePreviewRiskReport";

function row(key: string, videoId: string | null, opts: { status?: string; manualBlock?: boolean } = {}): CacheRow {
  return {
    artist_name_normalized: key,
    status: opts.status ?? "accepted",
    video_id: videoId,
    video_title: `${key} video`,
    channel_title: key,
    manual_block: opts.manualBlock ?? false,
    evidence: {},
  };
}

describe("shownPreviewArtist matches getArtistYoutubePreviewForLineup", () => {
  beforeEach(() => {
    state.rows = [];
  });

  it.each([
    ["first accepted in lineup order", ["SARAH WILD", "PELZMAN", "DASHA", "ANYA"], [row("dasha", "d"), row("anya", "a")]],
    ["skips blocked and abstain rows", ["A", "B", "C"], [row("a", "va", { manualBlock: true }), row("b", null, { status: "abstain" }), row("c", "vc")]],
    ["bracket annotations and case are normalized", ["Oliver Koletzki [Stil vor Talent]", "x"], [row("oliver koletzki", "ok")]],
    ["duplicate names keep the first position", ["B", "A", "b"], [row("a", "va"), row("b", "vb")]],
    ["no match at all", ["Nobody"], [row("someone", "s")]],
  ])("%s", async (_label, lineup, rows) => {
    state.rows = rows.map((r) => ({
      artistNameNormalized: r.artist_name_normalized,
      status: r.status,
      manualBlock: r.manual_block,
      videoId: r.video_id,
      videoTitle: r.video_title,
      channelTitle: r.channel_title,
    }));
    const page = await getArtistYoutubePreviewForLineup(lineup);
    const report = shownPreviewArtist(lineup, new Map(rows.map((r) => [r.artist_name_normalized, r])));
    expect(report?.row.video_id ?? null).toBe(page?.videoId ?? null);
    expect(report?.artist ?? null).toBe(page?.artistName ?? null);
  });
});
