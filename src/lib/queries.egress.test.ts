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

const {
  getEventBySlugWithVenue,
  getEventsForVenue,
  getArtistYoutubePreviewForLineup,
  getArtistPreviewAvailabilityForLineups,
  getSoundcloudLinksForLineup,
  getSoundcloudAvailabilityForEvents,
  getRecentSyncIdentityChanges,
  getPublishedEventSitemapEntries,
  getVenueSitemapEntries,
  getVenuesBySlugs,
  getUpcomingPublishedEventsForList,
  getUpcomingEventCountsByVenue,
  UPCOMING_PREFILTER_LOOKBACK_MS,
} = await import("./queries");

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

describe("SoundCloud artist link reads (2026-10-13) select only what the pages use", () => {
  const link = (eventId: string, artistName: string, url: string) =>
    row(schema.eventSoundcloudLinks, { event_id: eventId, source_id: "src-culture-box", artist_name: artistName, url });
  const soundcloudQueries = () => sent.filter((q) => /from "event_soundcloud_links"/i.test(q.text));
  const NOT_BLOCKED = /not exists \(select 1 from "soundcloud_link_blocks" where "soundcloud_link_blocks"\."url" = "event_soundcloud_links"\."url"\)/;

  beforeEach(() => {
    tableRows.event_soundcloud_links = [
      link("e-1", "GUY J", "https://soundcloud.com/guy-j"),
      link("e-1", "TIM ANDRESEN", "https://soundcloud.com/tim-andresen"),
      link("e-2", "ALX", "https://soundcloud.com/alx"),
    ];
  });

  it("event detail: one query for that event only, artist_name + url, blocked URLs excluded in SQL", async () => {
    const result = await getSoundcloudLinksForLineup("e-1", ["TIM ANDRESEN", "SOMEONE", "GUY J"]);

    expect(result).toEqual([
      { name: "TIM ANDRESEN", url: "https://soundcloud.com/tim-andresen" },
      { name: "GUY J", url: "https://soundcloud.com/guy-j" },
    ]);
    const [query, ...extra] = soundcloudQueries();
    expect(extra).toHaveLength(0);
    expect(selectedColumns(query.text)).toEqual(["artist_name", "url"]);
    expect(query.text).toMatch(/"event_soundcloud_links"\."event_id" = \$1/);
    expect(query.text).toMatch(NOT_BLOCKED);
    expect(query.values).toEqual(["e-1"]);
  });

  it("event detail with no lineup: no query", async () => {
    await expect(getSoundcloudLinksForLineup("e-1", [])).resolves.toEqual([]);
    expect(soundcloudQueries()).toHaveLength(0);
  });

  it("list pages: ONE batched query for every listed event, event_id + artist_name only", async () => {
    const result = await getSoundcloudAvailabilityForEvents([
      { id: "e-1", artists: ["GUY J"] },
      { id: "e-2", artists: ["SHK"] }, // a row exists, but not for a name in this lineup
      { id: "e-3", artists: [] },
    ]);

    expect(result).toEqual([true, false, false]);
    const [query, ...extra] = soundcloudQueries();
    expect(extra).toHaveLength(0);
    expect(selectedColumns(query.text)).toEqual(["event_id", "artist_name"]);
    expect(query.text).toMatch(NOT_BLOCKED);
    expect(query.values).toEqual(["e-1", "e-2"]); // events without a lineup are not even sent
  });

  it("list pages with no lineups at all: no query", async () => {
    await expect(getSoundcloudAvailabilityForEvents([{ id: "e-3", artists: [] }])).resolves.toEqual([false]);
    expect(soundcloudQueries()).toHaveLength(0);
  });

  describe("reuse through Artist Alerts identities (2026-11-03)", () => {
    const reuseQueries = () => sent.filter((q) => /from "event_artists" "here"/i.test(q.text));

    it("is skipped when every lineup name already has its own link", async () => {
      await getSoundcloudLinksForLineup("e-1", ["GUY J", "TIM ANDRESEN"]);
      expect(reuseQueries()).toHaveLength(0);
    });

    it("two queries: the artist's other resolved appearances, and the artist's identity key when no other active artist shares it", async () => {
      await getSoundcloudLinksForLineup("e-1", ["GUY J", "Rexie Lex"]);
      const [viaAppearances, unique, ...extra] = reuseQueries();
      expect(extra).toHaveLength(0);
      expect(selectedColumns(viaAppearances.text)).toEqual(["event_id", "lineup_entry", "lineup_entry", "url"]);
      expect(viaAppearances.text).toMatch(/inner join "artists" on \("artists"\."id" = "here"\."artist_id" and "artists"\."merged_into_id" is null and "artists"\."status" <> \$\d+\)/);
      expect(viaAppearances.text).toMatch(/inner join "event_artists" "other" on \("other"\."artist_id" = "here"\."artist_id" and "other"\."confidence" in \(\$\d+, \$\d+\) and "other"\."removed_at" is null\)/);
      expect(viaAppearances.text).toMatch(/inner join "event_soundcloud_links" on \("event_soundcloud_links"\."event_id" = "other"\."event_id" and "event_soundcloud_links"\."artist_name" = "other"\."lineup_entry"\)/);
      expect(viaAppearances.text).toMatch(/"here"\."event_id" in \(\$\d+\) and "here"\."confidence" in \(\$\d+, \$\d+\) and "here"\."removed_at" is null/);
      expect(viaAppearances.text).toMatch(NOT_BLOCKED);
      expect(viaAppearances.values).toEqual(expect.arrayContaining(["rejected", "high", "confirmed", "e-1"]));
      expect(selectedColumns(unique.text)).toEqual(["event_id", "lineup_entry", "name_key"]);
      expect(unique.text).toMatch(
        /not exists \(select 1 from "artists" "same_key" where \("same_key"\."name_key" = "here"\."name_key" and "same_key"\."id" <> "artists"\."id" and "same_key"\."merged_into_id" is null and "same_key"\."status" <> \$\d+\)\)/,
      );
    });

    it("a reused profile is shown for a lineup name without its own link, in lineup order", async () => {
      tableRows.event_artists = [{ event_id: "e-1", lineup_entry: "Rexie Lex", url: "https://soundcloud.com/rexie_lex" }];
      await expect(getSoundcloudLinksForLineup("e-1", ["Rexie Lex", "GUY J"])).resolves.toEqual([
        { name: "Rexie Lex", url: "https://soundcloud.com/rexie_lex" },
        { name: "GUY J", url: "https://soundcloud.com/guy-j" },
      ]);
      delete tableRows.event_artists;
    });

    it("list pages: the reuse query only covers listed events without an own link, batched", async () => {
      tableRows.event_artists = [{ event_id: "e-2", lineup_entry: "Rexie Lex", url: "https://soundcloud.com/rexie_lex" }];
      const result = await getSoundcloudAvailabilityForEvents([
        { id: "e-1", artists: ["GUY J"] },
        { id: "e-2", artists: ["Rexie Lex"] },
        { id: "e-3", artists: ["Nobody"] },
      ]);
      expect(result).toEqual([true, true, false]);
      const queries = reuseQueries();
      expect(queries).toHaveLength(2); // one batched query per path, never one per event
      for (const query of queries) {
        expect(query.values).toEqual(expect.arrayContaining(["e-2", "e-3"]));
        expect(query.values).not.toContain("e-1");
      }
      delete tableRows.event_artists;
    });

    it("historical venue links: one batched lookup by case-insensitive name, blocked links excluded", async () => {
      tableRows.event_artists = [{ event_id: "e-1", lineup_entry: "B From E", name_key: "b from e", url: "https://soundcloud.com/bfrome" }];
      await getSoundcloudLinksForLineup("e-1", ["B From E"]);
      const lookups = sent.filter((q) => /from "event_soundcloud_links" where \(lower\("event_soundcloud_links"\."artist_name"\) in/.test(q.text));
      expect(lookups).toHaveLength(1);
      expect(lookups[0].values[0]).toBe("b from e");
      expect(lookups[0].text).toMatch(NOT_BLOCKED);
      delete tableRows.event_artists;
    });

    it("Discogs-verified profiles: read from the Discogs cache, found + medium identity only", async () => {
      tableRows.event_artists = [{ event_id: "e-1", lineup_entry: "Sub Zero Project", name_key: "sub zero project", url: null }];
      await getSoundcloudLinksForLineup("e-1", ["Sub Zero Project"]);
      const q = sent.find((x) => /from "artist_genre_cache"/.test(x.text));
      expect(q?.text).toMatch(/"artist_genre_cache"\."lookup_status" = \$\d+ and "artist_genre_cache"\."identity_confidence" = \$\d+/);
      expect(q?.values).toEqual(expect.arrayContaining(["sub zero project", "found", "medium"]));
      delete tableRows.event_artists;
    });

    it("no lookup by key when no appearance qualifies", async () => {
      await getSoundcloudLinksForLineup("e-1", ["GUY J", "Nobody"]);
      expect(sent.filter((q) => /lower\("event_soundcloud_links"\."artist_name"\)/.test(q.text))).toHaveLength(0);
    });

    it("a failing reuse read keeps the event's own links", async () => {
      await getSoundcloudLinksForLineup("e-1", []); // no-op, keeps call order simple
      fakeClient.query.mockImplementationOnce(async (config: { text: string } | string, values?: unknown[]) => {
        const text = typeof config === "string" ? config : config.text;
        sent.push({ text, values: values ?? [] });
        return { rows: answer(text, values ?? []), rowCount: 0, fields: [] };
      });
      fakeClient.query.mockRejectedValueOnce(new Error("relation \"event_artists\" does not exist"));
      await expect(getSoundcloudLinksForLineup("e-1", ["GUY J", "Rexie Lex"])).resolves.toEqual([{ name: "GUY J", url: "https://soundcloud.com/guy-j" }]);
    });
  });

  it("a failing read degrades to no links / no indicator, never an error", async () => {
    fakeClient.query.mockRejectedValueOnce(new Error("relation does not exist"));
    await expect(getSoundcloudLinksForLineup("e-1", ["GUY J"])).resolves.toEqual([]);
    fakeClient.query.mockRejectedValueOnce(new Error("relation does not exist"));
    await expect(getSoundcloudAvailabilityForEvents([{ id: "e-1", artists: ["GUY J"] }])).resolves.toEqual([false]);
  });
});

describe("admin data-quality change lookup (getRecentSyncIdentityChanges)", () => {
  it("reads only recent, sync-made date/venue/URL changes, with five narrow columns", async () => {
    tableRows.event_change_log = [
      row(schema.eventChangeLog, {
        id: "log-1",
        event_id: "e-7208d716",
        changed_by: "src-pumpehuset",
        change_type: "sync",
        fields_changed: ["officialEventUrl", "startDatetime", "dateChanged"],
        created_at: "2026-10-14 12:29:49+00",
      }),
    ];

    const result = await getRecentSyncIdentityChanges(14);

    const query = sent.find((q) => /from "event_change_log"/i.test(q.text));
    expect(query).toBeDefined();
    expect(selectedColumns(query!.text)).toEqual(["event_id", "changed_by", "change_type", "fields_changed", "created_at"]);
    expect(query!.text).toMatch(/"created_at" >= \$1/);
    expect(query!.text).toMatch(/"changed_by" <> \$2/);
    expect(query!.values[1]).toBe("admin");
    expect(query!.text).toContain("ARRAY['startDatetime', 'venueId', 'officialEventUrl']::text[]");
    expect(result).toEqual([
      {
        eventId: "e-7208d716",
        changedBy: "src-pumpehuset",
        changeType: "sync",
        fieldsChanged: ["officialEventUrl", "startDatetime", "dateChanged"],
        createdAt: "2026-10-14T12:29:49.000Z",
      },
    ]);
  });
});

/**
 * Supabase egress work, 2026-11-01. Production pg_stat_statements (79 days)
 * showed full events/venues reads as the largest result sets; these pin the
 * narrowed SQL for the sitemap, the public event lists and /venues.
 */
const eventQueries = () => sent.filter((q) => /from "events"/i.test(q.text));
// Columns that only admin, sync or the event-detail page use — never the lists.
const ADMIN_OR_DETAIL_ONLY_EVENT_COLUMNS = [
  "timezone",
  "genre_confidence",
  "image_url",
  "currency",
  "cancelled",
  "time_changed",
  "published",
  "admin_unpublish_reason",
  "admin_unpublish_note",
  "admin_unpublished_at",
  "source_cancelled_at",
  "source_cancelled_by_source_id",
  "source_cancellation_evidence",
  "manual_override",
  "confidence",
  "created_at",
  "updated_at",
  "last_source_check",
  "last_changed",
];

describe("sitemap reads only the fields its entries use", () => {
  it("events: slug + updated_at of published events, joined to venues so the event set is unchanged", async () => {
    tableRows.events = [
      { ...event("e-1", "v-vega"), updated_at: "2026-10-21 08:30:00+00" },
      { ...event("e-hidden", "v-vega"), published: false },
    ];

    const entries = await getPublishedEventSitemapEntries();

    expect(entries).toEqual([{ slug: "e-1", updatedAt: "2026-10-21T08:30:00.000Z" }]);
    const [query, ...extra] = eventQueries();
    expect(extra).toHaveLength(0);
    expect(selectedColumns(query.text)).toEqual(["slug", "updated_at"]);
    expect(query.text).toMatch(/inner join "venues" on "venues"\."id" = "events"\."venue_id"/i);
    expect(query.text).toMatch(/where "events"\."published" = \$1/i);
    expect(query.values).toEqual([true]);
  });

  it("venues: id + slug only, in the same name order getVenues used", async () => {
    const entries = await getVenueSitemapEntries();

    expect(entries.map((v) => v.id).sort()).toEqual(["v-culture-box", "v-hangaren", "v-vega"]);
    const [query] = venueQueries();
    expect(selectedColumns(query.text)).toEqual(["id", "slug"]);
    expect(query.text).toMatch(/order by "venues"\."name"/i);
  });
});

describe("/venues reads only the curated venues and one narrow count query", () => {
  it("getVenuesBySlugs asks for exactly the given slugs", async () => {
    const result = await getVenuesBySlugs(["v-vega", "v-hangaren"]);

    expect(result.map((v) => v.id).sort()).toEqual(["v-hangaren", "v-vega"]);
    const [query] = venueQueries();
    expect(query.text).toMatch(/where "venues"\."slug" in \(\$1, \$2\)/i);
    expect(query.values).toEqual(["v-vega", "v-hangaren"]);
  });

  it("getUpcomingEventCountsByVenue: one query, three columns, and past events still excluded by isPastEvent", async () => {
    const now = new Date("2026-10-20T12:00:00.000Z");
    tableRows.events = [
      event("e-1", "v-vega"),
      event("e-2", "v-vega"),
      event("e-3", "v-hangaren"),
      // Over by isPastEvent (no end: ends 06:00 the day after its nightlife day) — never counted.
      { ...event("e-past", "v-vega"), start_datetime: "2026-10-18 20:00:00+00" },
    ];

    const counts = await getUpcomingEventCountsByVenue(["v-vega", "v-hangaren", "v-culture-box"], now);

    expect(Object.fromEntries(counts)).toEqual({ "v-vega": 2, "v-hangaren": 1 });
    const [query, ...extra] = eventQueries();
    expect(extra).toHaveLength(0);
    expect(venueQueries()).toHaveLength(0);
    expect(selectedColumns(query.text)).toEqual(["venue_id", "start_datetime", "end_datetime"]);
    expect(query.text).toMatch(/"events"\."venue_id" in \(\$2, \$3, \$4\)/i);
    expect(query.text).toMatch(/\("events"\."start_datetime" >= \$5 or "events"\."end_datetime" > \$6\)/i);
    expect(query.values.slice(4)).toEqual([new Date(now.getTime() - UPCOMING_PREFILTER_LOOKBACK_MS).toISOString(), now.toISOString()]);
  });

  it("no venues → no query", async () => {
    await expect(getUpcomingEventCountsByVenue([], new Date())).resolves.toEqual(new Map());
    expect(sent).toHaveLength(0);
  });
});

describe("public event lists (homepage, genre and venue pages) read upcoming events with list columns only", () => {
  const now = new Date("2026-10-20T12:00:00.000Z");

  it("filters published + upcoming candidates in SQL and never selects admin/detail-only columns", async () => {
    await getUpcomingPublishedEventsForList(now);

    const [query, ...extra] = eventQueries();
    expect(extra).toHaveLength(0);
    const columns = selectedColumns(query.text);
    for (const column of ADMIN_OR_DETAIL_ONLY_EVENT_COLUMNS) expect(columns).not.toContain(column);
    expect(columns).toEqual(
      expect.arrayContaining(["id", "slug", "title", "description", "artists", "start_datetime", "end_datetime", "venue_id", "primary_genre", "subgenres"]),
    );
    expect(query.text).toMatch(
      /where \("events"\."published" = \$1 and \("events"\."start_datetime" >= \$2 or "events"\."end_datetime" > \$3\)\)/i,
    );
    expect(query.values).toEqual([true, new Date(now.getTime() - UPCOMING_PREFILTER_LOOKBACK_MS).toISOString(), now.toISOString()]);
  });

  it("reads only the five venue fields the rows show, for the referenced venues only", async () => {
    const result = await getUpcomingPublishedEventsForList(now);

    expect(result.map((e) => e.id)).toEqual(["e-1", "e-2", "e-3"]);
    const [venueQuery, ...extra] = venueQueries();
    expect(extra).toHaveLength(0);
    expect(selectedColumns(venueQuery.text).sort()).toEqual(["address", "aliases", "id", "name", "slug"]);
    expect([...venueQuery.values].sort()).toEqual(["v-hangaren", "v-vega"]);
  });

  it("maps values exactly as eventRowToRecord + withAboutKind did (ISO dates, labels-only About text → null, unresolvable venue skipped)", async () => {
    tableRows.events = [
      { ...event("e-1", "v-vega"), end_datetime: "2026-10-21 04:00:00+00", description: "A long night of techno." },
      { ...event("e-labels", "v-vega"), description: "Praktisk info:." },
      event("e-orphan", "v-missing"),
    ];

    const result = await getUpcomingPublishedEventsForList(now);

    expect(result.map((e) => e.id)).toEqual(["e-1", "e-labels"]);
    expect(result[0]).toMatchObject({
      startDatetime: "2026-10-20T20:00:00.000Z",
      endDatetime: "2026-10-21T04:00:00.000Z",
      description: "A long night of techno.",
      primaryGenre: "techno",
      venue: { id: "v-vega", slug: "v-vega", name: "VEGA", address: "VEGA street 1", aliases: [] },
    });
    expect(result[1].description).toBeNull();
  });

  it("venue pages: narrowed to the given venue ids in the same single query; empty list → no query", async () => {
    await getUpcomingPublishedEventsForList(now, ["v-vega", "v-vega-ideal-bar"]);
    const [query] = eventQueries();
    expect(query.text).toMatch(/"events"\."venue_id" in \(\$4, \$5\)/i);
    expect(query.values.slice(3)).toEqual(["v-vega", "v-vega-ideal-bar"]);

    sent.length = 0;
    await expect(getUpcomingPublishedEventsForList(now, [])).resolves.toEqual([]);
    expect(sent).toHaveLength(0);
  });
});
