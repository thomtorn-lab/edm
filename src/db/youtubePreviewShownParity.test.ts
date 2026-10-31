import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";

// The report's "shown today" must be exactly what the event page renders.
// This runs the page's own query function (getEventYoutubePreview, event
// overrides included) through the real drizzle query builder against a fake
// node-postgres client — same approach as queries.eventYoutubeOverride.test.ts.
let tableRows: Record<string, Record<string, unknown>[]> = {};
let failTable: string | null = null;

function answer(text: string, values: unknown[]): unknown[][] {
  const table = /from "([a-z_]+)"/i.exec(text)?.[1] ?? "";
  if (table === failTable) throw new Error(`relation "${table}" does not exist`);
  const key = /where \(?"[a-z_]+"\."([a-z_]+)" (=|in)/i.exec(text);
  const rows = (tableRows[table] ?? []).filter((r) => !key || values.includes(r[key[1]]));
  const columns = (/^select (.*?) from /i.exec(text)?.[1] ?? "").split(", ").map((c) => c.replace(/^"[a-z_]+"\./, "").replace(/"/g, ""));
  return rows.map((r) => columns.map((c) => r[c] ?? null));
}

const fakeClient = {
  query: vi.fn(async (config: { text: string } | string, values?: unknown[]) => {
    const text = typeof config === "string" ? config : config.text;
    return { rows: answer(text, values ?? []), rowCount: 0, fields: [] };
  }),
};

vi.mock("@/db/client", () => ({ db: drizzle({ client: fakeClient as never, schema }) }));

const { getEventYoutubePreview } = await import("@/lib/queries");
const { buildEventSection, shownPreviewArtist } = await import("./youtubePreviewRiskReport");
type CacheRow = import("./youtubePreviewRiskReport").CacheRow;
type OverrideRow = import("./youtubePreviewRiskReport").OverrideRow;

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

function override(o: Partial<OverrideRow> = {}): OverrideRow {
  return { event_id: "e-11111111", mode: "video", video_id: "Pbb0KmuwYSA", video_title: "steamboi | REX Radio", channel_title: "REX Radio", artist_name: "STEAMBOI", available: true, ...o };
}

beforeEach(() => {
  tableRows = {};
  failTable = null;
});

const LINEUP = ["SARAH WILD", "PELZMAN", "DASHA", "ANYA"];

describe("report shownToday matches getEventYoutubePreview", () => {
  it.each<[string, string[], CacheRow[], OverrideRow[]]>([
    ["first accepted in lineup order", LINEUP, [row("dasha", "d"), row("anya", "a")], []],
    ["skips blocked and abstain rows", ["A", "B", "C"], [row("a", "va", { manualBlock: true }), row("b", null, { status: "abstain" }), row("c", "vc")], []],
    ["bracket annotations and case are normalized", ["Oliver Koletzki [Stil vor Talent]", "x"], [row("oliver koletzki", "ok")], []],
    ["duplicate names keep the first position", ["B", "A", "b"], [row("a", "va"), row("b", "vb")], []],
    ["no match at all", ["Nobody"], [row("someone", "s")], []],
    ["an available override video wins over the artist match", LINEUP, [row("sarah wild", "sw")], [override()]],
    ["an override without artist name names no artist (never a lineup guess)", LINEUP, [row("dasha", "d")], [override({ artist_name: null })]],
    ["a hidden override shows nothing, never the artist match", LINEUP, [row("sarah wild", "sw")], [override({ mode: "hidden", video_id: null })]],
    ["an unavailable override shows nothing", LINEUP, [row("sarah wild", "sw")], [override({ available: false })]],
    ["an unknown override mode shows nothing", LINEUP, [row("sarah wild", "sw")], [override({ mode: "something-new" })]],
    ["another event's override does not apply", LINEUP, [row("dasha", "d")], [override({ event_id: "e-22222222" })]],
  ])("%s", async (_label, lineup, cache, overrides) => {
    tableRows.artist_youtube_preview_cache = cache.map((r) => ({ ...r }));
    tableRows.event_youtube_preview_overrides = overrides.map((o) => ({ ...o }));
    const page = await getEventYoutubePreview({ id: "e-11111111", artists: lineup });
    const report = buildEventSection([{ id: "e-11111111", slug: "x", title: "x", description: null, artists: lineup, image_url: null, start_datetime: "2026-11-06T22:00:00Z", canonical_source_id: null, source_ids: [] }], cache, overrides).events[0];
    expect(report.shownToday?.videoId ?? null).toBe(page?.videoId ?? null);
    expect(report.shownToday?.artist ?? null).toBe(page?.artistName ?? null);
    if (overrides.length === 0) expect(shownPreviewArtist(lineup, new Map(cache.map((r) => [r.artist_name_normalized, r])))?.row.video_id ?? null).toBe(page?.videoId ?? null);
  });

  it("a missing override table: the page fails closed, and so does the report", async () => {
    tableRows.artist_youtube_preview_cache = [{ ...row("sarah wild", "sw") }];
    failTable = "event_youtube_preview_overrides";
    const page = await getEventYoutubePreview({ id: "e-11111111", artists: LINEUP });
    const report = buildEventSection([{ id: "e-11111111", slug: "x", title: "x", description: null, artists: LINEUP, image_url: null, start_datetime: "2026-11-06T22:00:00Z", canonical_source_id: null, source_ids: [] }], [row("sarah wild", "sw")], "table_not_present").events[0];
    expect(page).toBeNull();
    expect(report.shownToday).toBeNull();
  });
});
