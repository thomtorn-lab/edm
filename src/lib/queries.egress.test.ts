import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";

/**
 * Supabase egress regression tests (2026-10-12). Unlike queries.test.ts,
 * which stubs the query builder, these run the REAL drizzle query builder
 * against a fake node-postgres client, so they assert on the exact SQL the
 * app sends: which venue rows are requested for an event, and which
 * artist_youtube_preview_cache columns the render-time reads select. A
 * regression back to a full-table venues read or to `select *` on the
 * preview cache (which drags the large `evidence` JSON along) fails here.
 */

interface SentQuery {
  text: string;
  values: unknown[];
}

const sent: SentQuery[] = [];
// Fixture rows per table, keyed by DB column name — the fake client answers
// each query with these, filtered by the WHERE values and projected onto
// whatever columns the SQL actually selected (rowMode "array", the way
// drizzle's node-postgres driver reads results).
let tableRows: Record<string, Record<string, unknown>[]> = {};

function selectedColumns(text: string): string[] {
  const list = /^select (.*?) from /i.exec(text)?.[1] ?? "";
  return list.split(", ").map((c) => c.replace(/^"[a-z_]+"\./, "").replace(/"/g, ""));
}

function answer(text: string, values: unknown[]): unknown[][] {
  const table = /from "([a-z_]+)"/i.exec(text)?.[1] ?? "";
  const rows = tableRows[table] ?? [];
  // Every query under test filters on one key column with = or IN ($n...);
  // apply that filter so a test can tell "only the referenced rows" apart
  // from "the whole table".
  // `where ("t"."col" = $1 and ...)` matches on $1 only; `where "t"."col" in ($1, ...)` on every value.
  const key = /where \(?"[a-z_]+"\."([a-z_]+)" (=|in)/i.exec(text);
  const keyValues = key?.[2] === "=" ? values.slice(0, 1) : values;
  const matching = key ? rows.filter((r) => keyValues.includes(r[key[1]])) : rows;
  const columns = selectedColumns(text);
  return matching.map((r) => columns.map((c) => r[c] ?? null));
}

const fakeClient = {
  query: vi.fn(async (config: { text: string } | string, values?: unknown[]) => {
    const text = typeof config === "string" ? config : config.text;
    const params = values ?? [];
    sent.push({ text, values: params });
    return { rows: answer(text, params), rowCount: 0, fields: [] };
  }),
};

vi.mock("@/db/client", () => ({
  db: drizzle({ client: fakeClient as never, schema }),
}));

const { getEventBySlugWithVenue, getEventsForVenue, getArtistYoutubePreviewForLineup, getArtistPreviewAvailabilityForLineups } =
  await import("./queries");

/** A complete row for `table` with type-appropriate defaults, keyed by DB column name. */
function row(table: Table, overrides: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of Object.values(getTableColumns(table))) {
    let value: unknown = null;
    if (column.notNull) {
      if (column.columnType === "PgArray") value = [];
      else if (column.columnType === "PgBoolean") value = false;
      else if (column.columnType === "PgTimestamp") value = "2026-10-01 00:00:00+00";
      else if (column.columnType === "PgJsonb") value = [];
      else if (column.columnType === "PgInteger") value = 0;
      else value = "x";
    }
    out[column.name] = value;
  }
  return { ...out, ...overrides };
}

function venue(id: string, name: string) {
  return row(schema.venues, { id, slug: id, name, address: `${name} street 1`, city: "Copenhagen", postal_code: "1000" });
}

function event(id: string, venueId: string) {
  return row(schema.events, {
    id,
    slug: id,
    title: `Event ${id}`,
    venue_id: venueId,
    published: true,
    start_datetime: "2026-10-20 20:00:00+00",
    primary_genre: "techno",
  });
}

const venueQueries = () => sent.filter((q) => /from "venues"/i.test(q.text));
const previewQueries = () => sent.filter((q) => /from "artist_youtube_preview_cache"/i.test(q.text));

beforeEach(() => {
  sent.length = 0;
  fakeClient.query.mockClear();
  tableRows = {
    venues: [venue("v-culture-box", "Culture Box"), venue("v-vega", "VEGA"), venue("v-hangaren", "Hangaren")],
    events: [event("e-1", "v-vega"), event("e-2", "v-vega"), event("e-3", "v-hangaren")],
    artist_youtube_preview_cache: [],
  };
});

describe("venue lookups fetch only the referenced venues, never the whole table", () => {
  it("event detail / calendar.ics (getEventBySlugWithVenue) requests exactly the event's own venue", async () => {
    const result = await getEventBySlugWithVenue("e-1");

    expect(result?.id).toBe("e-1");
    expect(result?.venue).toMatchObject({ id: "v-vega", name: "VEGA", address: "VEGA street 1" });
    const [venueQuery, ...extra] = venueQueries();
    expect(extra).toHaveLength(0);
    expect(venueQuery.text).toMatch(/where "venues"\."id" in \(\$1\)/i);
    expect(venueQuery.values).toEqual(["v-vega"]);
  });

  it("still returns undefined for an event whose venue does not resolve (unchanged public-site rule)", async () => {
    tableRows.events = [event("e-orphan", "v-missing")];
    await expect(getEventBySlugWithVenue("e-orphan")).resolves.toBeUndefined();
  });

  it("does not query venues at all when the slug matches no published event", async () => {
    await expect(getEventBySlugWithVenue("no-such-event")).resolves.toBeUndefined();
    expect(venueQueries()).toHaveLength(0);
  });

  it("getEventsForVenue requests that one venue once, deduplicated across its events", async () => {
    const result = await getEventsForVenue("v-vega");

    expect(result.map((e) => e.id)).toEqual(["e-1", "e-2"]);
    expect(result.every((e) => e.venue.id === "v-vega")).toBe(true);
    const [venueQuery, ...extra] = venueQueries();
    expect(extra).toHaveLength(0);
    expect(venueQuery.values).toEqual(["v-vega"]);
  });
});

describe("YouTube preview cache render-time reads select only the fields they use", () => {
  const acceptedPrydz = () =>
    row(schema.artistYoutubePreviewCache, {
      artist_name_normalized: "eric prydz",
      status: "accepted",
      manual_block: false,
      video_id: "v1",
      video_title: "Eric Prydz Set",
      channel_title: "Eric Prydz",
      query: "eric prydz dj set",
      evidence: { primaryAttempt: { rejected: Array.from({ length: 5 }, () => ({ title: "a long rejected title" })) } },
    });

  it("event detail (getArtistYoutubePreviewForLineup) never selects evidence/query, and still resolves the preview", async () => {
    tableRows.artist_youtube_preview_cache = [acceptedPrydz()];

    const result = await getArtistYoutubePreviewForLineup(["Eric Prydz"]);

    expect(result).toEqual({ artistName: "Eric Prydz", videoId: "v1", videoTitle: "Eric Prydz Set", channelTitle: "Eric Prydz" });
    const [query] = previewQueries();
    expect(selectedColumns(query.text).sort()).toEqual(
      ["artist_name_normalized", "channel_title", "manual_block", "status", "video_id", "video_title"].sort(),
    );
  });

  it("homepage VIDEO indicator (getArtistPreviewAvailabilityForLineups) selects only the acceptance-predicate fields", async () => {
    tableRows.artist_youtube_preview_cache = [acceptedPrydz()];

    const result = await getArtistPreviewAvailabilityForLineups([["Eric Prydz"], ["Someone Else"]]);

    expect(result).toEqual([true, false]);
    const [query] = previewQueries();
    expect(selectedColumns(query.text).sort()).toEqual(["artist_name_normalized", "manual_block", "status", "video_id"].sort());
  });

  it("both reads still honor manual_block and status exactly as before", async () => {
    tableRows.artist_youtube_preview_cache = [
      { ...acceptedPrydz(), manual_block: true },
      row(schema.artistYoutubePreviewCache, { artist_name_normalized: "abstainer", status: "abstain", query: "q" }),
    ];

    await expect(getArtistYoutubePreviewForLineup(["Eric Prydz", "Abstainer"])).resolves.toBeNull();
    await expect(getArtistPreviewAvailabilityForLineups([["Eric Prydz"], ["Abstainer"]])).resolves.toEqual([false, false]);
  });
});
