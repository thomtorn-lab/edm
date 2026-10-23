import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";

/**
 * Per-event YouTube override precedence (2026-10-23), through the REAL
 * drizzle query builder against a fake node-postgres client (same approach as
 * queries.egress.test.ts): the event page (getEventYoutubePreview) and the
 * homepage VIDEO indicator (getPreviewAvailabilityForEvents) must agree for
 * every override state, an override must never fall back to an artist video,
 * and an event without one must behave exactly as before.
 */

const sent: { text: string; values: unknown[] }[] = [];
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
    sent.push({ text, values: values ?? [] });
    return { rows: answer(text, values ?? []), rowCount: 0, fields: [] };
  }),
};

vi.mock("@/db/client", () => ({ db: drizzle({ client: fakeClient as never, schema }) }));

const { getEventYoutubePreview, getPreviewAvailabilityForEvents } = await import("./queries");

function artistRow(name: string, videoId: string, overrides: Record<string, unknown> = {}) {
  return { artist_name_normalized: name, status: "accepted", manual_block: false, video_id: videoId, video_title: `${name} set`, channel_title: name, ...overrides };
}

function overrideRow(eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    event_id: eventId,
    mode: "video",
    video_id: "Pbb0KmuwYSA",
    video_title: "steamboi | REX Radio (10.11.25)",
    channel_title: "REX Radio",
    artist_name: "STEAMBOI",
    available: true,
    ...overrides,
  };
}

const cacheQueries = () => sent.filter((q) => /from "artist_youtube_preview_cache"/i.test(q.text));
const overrideQueries = () => sent.filter((q) => /from "event_youtube_preview_overrides"/i.test(q.text));

beforeEach(() => {
  sent.length = 0;
  failTable = null;
  tableRows = {
    artist_youtube_preview_cache: [artistRow("steamboi", "AUTOsteamb1"), artistRow("kardinal bertram", "AUTOkardin1")],
    event_youtube_preview_overrides: [],
  };
});

const LINEUP = ["STEAMBOI", "KARDINAL BERTRAM"];

describe("getEventYoutubePreview — override precedence for one event", () => {
  it("no override: the automated artist match, exactly as before", async () => {
    await expect(getEventYoutubePreview({ id: "e-11111111", artists: LINEUP })).resolves.toMatchObject({ artistName: "STEAMBOI", videoId: "AUTOsteamb1" });
  });

  it("an available chosen video wins, and the artist cache is not even read", async () => {
    tableRows.event_youtube_preview_overrides = [overrideRow("e-a2b5cf47")];
    await expect(getEventYoutubePreview({ id: "e-a2b5cf47", artists: LINEUP })).resolves.toEqual({
      artistName: "STEAMBOI",
      videoId: "Pbb0KmuwYSA",
      videoTitle: "steamboi | REX Radio (10.11.25)",
      channelTitle: "REX Radio",
    });
    expect(cacheQueries()).toHaveLength(0);
  });

  it("an unavailable chosen video shows nothing — never another artist's video instead", async () => {
    tableRows.event_youtube_preview_overrides = [overrideRow("e-a2b5cf47", { available: false })];
    await expect(getEventYoutubePreview({ id: "e-a2b5cf47", artists: LINEUP })).resolves.toBeNull();
    expect(cacheQueries()).toHaveLength(0);
  });

  it("a hidden override shows nothing", async () => {
    tableRows.event_youtube_preview_overrides = [overrideRow("e-a2b5cf47", { mode: "hidden" })];
    await expect(getEventYoutubePreview({ id: "e-a2b5cf47", artists: LINEUP })).resolves.toBeNull();
  });

  it("only applies to its own event: another event with the same artist keeps the automated match", async () => {
    tableRows.event_youtube_preview_overrides = [overrideRow("e-a2b5cf47")];
    await expect(getEventYoutubePreview({ id: "e-22222222", artists: ["STEAMBOI"] })).resolves.toMatchObject({ videoId: "AUTOsteamb1" });
  });

  it("an override without a recorded artist name falls back to the first lineup name for the iframe title", async () => {
    tableRows.event_youtube_preview_overrides = [overrideRow("e-a2b5cf47", { artist_name: null })];
    await expect(getEventYoutubePreview({ id: "e-a2b5cf47", artists: LINEUP })).resolves.toMatchObject({ artistName: "STEAMBOI" });
  });

  it("a failed override read (table not migrated yet, e.g. a Preview database) degrades to the automated match, never an error", async () => {
    failTable = "event_youtube_preview_overrides";
    await expect(getEventYoutubePreview({ id: "e-a2b5cf47", artists: LINEUP })).resolves.toMatchObject({ videoId: "AUTOsteamb1" });
  });

  it("never selects anything but the display columns from the override table", async () => {
    tableRows.event_youtube_preview_overrides = [overrideRow("e-a2b5cf47")];
    await getEventYoutubePreview({ id: "e-a2b5cf47", artists: LINEUP });
    expect(overrideQueries()[0].text).not.toMatch(/"channel_id"|"last_verified_at"|"unavailable_since"/);
  });
});

describe("getPreviewAvailabilityForEvents — the VIDEO indicator agrees with the event page in every state", () => {
  const list = [
    { id: "e-00000001", artists: LINEUP }, // override, available
    { id: "e-00000002", artists: LINEUP }, // override, unavailable — artist has a match, still no video
    { id: "e-00000003", artists: LINEUP }, // hidden — artist has a match, still no video
    { id: "e-00000004", artists: LINEUP }, // no override — automated match
    { id: "e-00000005", artists: ["Nobody Known"] }, // no override, no match
    { id: "e-00000006", artists: ["Nobody Known"] }, // override, available, artist without any match
  ];

  beforeEach(() => {
    tableRows.event_youtube_preview_overrides = [
      overrideRow("e-00000001"),
      overrideRow("e-00000002", { available: false }),
      overrideRow("e-00000003", { mode: "hidden" }),
      overrideRow("e-00000006"),
    ];
  });

  it("returns the expected flag per event, with at most two queries for the whole list", async () => {
    await expect(getPreviewAvailabilityForEvents(list)).resolves.toEqual([true, false, false, true, false, true]);
    expect(overrideQueries()).toHaveLength(1);
    expect(cacheQueries()).toHaveLength(1);
  });

  it("matches getEventYoutubePreview for every event", async () => {
    const flags = await getPreviewAvailabilityForEvents(list);
    for (const [i, e] of list.entries()) {
      expect((await getEventYoutubePreview(e)) !== null, e.id).toBe(flags[i]);
    }
  });

  it("reads the artist cache only for the events without an override", async () => {
    await getPreviewAvailabilityForEvents(list);
    expect(cacheQueries()[0].values.sort()).toEqual(["kardinal bertram", "nobody known", "steamboi"].sort());
  });

  it("skips the artist cache entirely when every event has an override", async () => {
    await expect(getPreviewAvailabilityForEvents([list[0], list[2]])).resolves.toEqual([true, false]);
    expect(cacheQueries()).toHaveLength(0);
  });

  it("an empty list issues no queries", async () => {
    await expect(getPreviewAvailabilityForEvents([])).resolves.toEqual([]);
    expect(sent).toHaveLength(0);
  });
});
