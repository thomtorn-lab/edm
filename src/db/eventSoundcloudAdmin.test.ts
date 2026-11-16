import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Manual SoundCloud links per lineup artist (2026-11-16). Runs the REAL
 * drizzle query builder against a fake node-postgres client (same approach
 * as soundcloudLinks.test.ts), so these assert on the exact SQL sent.
 * Each select returns the next queued result.
 */
interface SentQuery {
  text: string;
  values: unknown[];
}
const sent: SentQuery[] = [];
let selectResults: unknown[][][] = [];

const fakeClient = {
  query: vi.fn(async (config: { text: string } | string, values?: unknown[]) => {
    const text = typeof config === "string" ? config : config.text;
    sent.push({ text, values: values ?? [] });
    const rows = /^select /i.test(text) ? (selectResults.shift() ?? []) : [];
    return { rows, rowCount: 0, fields: [] };
  }),
};

vi.mock("./client", () => ({ db: drizzle({ client: fakeClient as never, schema }) }));

const { getEventSoundcloudAdminState, setManualSoundcloudLink, removeManualSoundcloudLink, EventSoundcloudAdminError } = await import("./eventSoundcloudAdmin");

/** The lineup read (one row, one text[] column), ready to spread into selectResults. */
const EVENT_ROW = [[[["TICON", "ZORA"]]]];
const writes = () => sent.filter((q) => !/^select /i.test(q.text));

beforeEach(() => {
  sent.length = 0;
  selectResults = [];
});

describe("setManualSoundcloudLink — add", () => {
  it("stores the normalized profile for that event and artist under the admin source, creating the inactive source row once", async () => {
    // event lineup, block check (none), then the state read: links, blocks
    selectResults = [...EVENT_ROW, [], ...EVENT_ROW, [["src-admin-manual", "TICON", "https://soundcloud.com/ticon"]], []];
    const state = await setManualSoundcloudLink("e-1", "TICON", "https://www.soundcloud.com/Ticon/");

    const [sourceInsert, linkUpsert] = writes();
    expect(sourceInsert.text).toMatch(/^insert into "sources" .* on conflict do nothing$/);
    expect(sourceInsert.values).toContain("src-admin-manual");
    expect(sourceInsert.values).toContain(false); // active: false — never synced
    expect(linkUpsert.text).toMatch(/^insert into "event_soundcloud_links" .* on conflict \("event_id","source_id","artist_name"\) do update set "url" = excluded\.url/);
    expect(linkUpsert.values.slice(0, 4)).toEqual(["e-1", "src-admin-manual", "TICON", "https://soundcloud.com/ticon"]);
    expect(state.artists[0]).toEqual({ name: "TICON", manualUrl: "https://soundcloud.com/ticon", automaticUrl: null, manualBlocked: false });
  });

  it("refuses a name that is not in this event's lineup, without writing", async () => {
    selectResults = [...EVENT_ROW];
    await expect(setManualSoundcloudLink("e-1", "SOMEONE ELSE", "https://soundcloud.com/x")).rejects.toThrow(EventSoundcloudAdminError);
    expect(writes()).toEqual([]);
  });

  it.each([
    ["https://example.com/ticon", "isn't a soundcloud.com link"],
    ["https://soundcloud.com/ticon/some-track", "profile link"],
    ["https://soundcloud.com/iboga-records", "label or organisation"],
  ])("keeps the existing profile validation: %s is refused, nothing written", async (url, message) => {
    selectResults = [...EVENT_ROW];
    await expect(setManualSoundcloudLink("e-1", "TICON", url)).rejects.toThrow(message);
    expect(writes()).toEqual([]);
  });

  it("refuses a profile on the block list, nothing written", async () => {
    selectResults = [...EVENT_ROW, [["https://soundcloud.com/ticon"]]];
    await expect(setManualSoundcloudLink("e-1", "TICON", "https://soundcloud.com/ticon")).rejects.toThrow("block list");
    expect(writes()).toEqual([]);
  });

  it("404 for an unknown event", async () => {
    selectResults = [[]];
    await expect(setManualSoundcloudLink("e-x", "TICON", "https://soundcloud.com/ticon")).rejects.toMatchObject({ status: 404 });
  });
});

describe("setManualSoundcloudLink — change", () => {
  it("replaces the manual link in place (same event, admin source, artist), never another source's row", async () => {
    selectResults = [...EVENT_ROW, [], ...EVENT_ROW, [["src-admin-manual", "TICON", "https://soundcloud.com/ticon-official"]], []];
    await setManualSoundcloudLink("e-1", "TICON", "https://soundcloud.com/ticon-official");
    const upsert = writes()[1];
    expect(upsert.text).toMatch(/on conflict \("event_id","source_id","artist_name"\) do update/);
    expect(upsert.values.slice(0, 4)).toEqual(["e-1", "src-admin-manual", "TICON", "https://soundcloud.com/ticon-official"]);
  });
});

describe("removeManualSoundcloudLink", () => {
  it("deletes only the admin source's row for that event and artist; a source's own link stays", async () => {
    selectResults = [...EVENT_ROW, ...EVENT_ROW, [["src-culture-box", "TICON", "https://soundcloud.com/ticon"]], []];
    const state = await removeManualSoundcloudLink("e-1", "TICON");
    const [del] = writes();
    expect(del.text).toMatch(
      /^delete from "event_soundcloud_links" where \("event_soundcloud_links"\."event_id" = \$1 and "event_soundcloud_links"\."source_id" = \$2 and "event_soundcloud_links"\."artist_name" = \$3\)$/,
    );
    expect(del.values).toEqual(["e-1", "src-admin-manual", "TICON"]);
    expect(writes()).toHaveLength(1);
    expect(state.artists[0]).toEqual({ name: "TICON", manualUrl: null, automaticUrl: "https://soundcloud.com/ticon", manualBlocked: false });
  });
});

describe("getEventSoundcloudAdminState", () => {
  it("lists the lineup in order with the manual and the automatic link apart, and flags a manual link blocked later", async () => {
    selectResults = [
      ...EVENT_ROW,
      [
        ["src-culture-box", "TICON", "https://soundcloud.com/ticon"],
        ["src-admin-manual", "TICON", "https://soundcloud.com/ticon-official"],
        ["src-admin-manual", "ZORA", "https://soundcloud.com/zora-blocked"],
      ],
      [["https://soundcloud.com/zora-blocked"]],
    ];
    const state = await getEventSoundcloudAdminState("e-1");
    expect(state.artists).toEqual([
      { name: "TICON", manualUrl: "https://soundcloud.com/ticon-official", automaticUrl: "https://soundcloud.com/ticon", manualBlocked: false },
      { name: "ZORA", manualUrl: "https://soundcloud.com/zora-blocked", automaticUrl: null, manualBlocked: true },
    ]);
    expect(writes()).toEqual([]);
  });
});
