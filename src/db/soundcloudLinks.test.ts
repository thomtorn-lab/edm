import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Runs the REAL drizzle query builder against a fake node-postgres client
 * (same approach as src/lib/queries.egress.test.ts), so these assert on the
 * exact SQL the sync and the block workflow send.
 */
interface SentQuery {
  text: string;
  values: unknown[];
}
const sent: SentQuery[] = [];
let storedRows: unknown[][] = [];

const fakeClient = {
  query: vi.fn(async (config: { text: string } | string, values?: unknown[]) => {
    const text = typeof config === "string" ? config : config.text;
    sent.push({ text, values: values ?? [] });
    const isSelect = /^select /i.test(text);
    return { rows: isSelect ? storedRows : [], rowCount: 0, fields: [] };
  }),
};

vi.mock("./client", () => ({ db: drizzle({ client: fakeClient as never, schema }) }));

const { reconcileSourceSoundcloudLinks, blockSoundcloudProfile, unblockSoundcloudProfile } = await import("./soundcloudLinks");

const GUY_J = { name: "GUY J", url: "https://soundcloud.com/guy-j" };
const TIM = { name: "TIM ANDRESEN", url: "https://soundcloud.com/tim-andresen" };

beforeEach(() => {
  sent.length = 0;
  storedRows = [];
});

describe("reconcileSourceSoundcloudLinks — database usage per sync run", () => {
  it("no observations: no query at all", async () => {
    await reconcileSourceSoundcloudLinks("src-culture-box", new Map());
    expect(sent).toEqual([]);
  });

  it("one narrow read scoped to this source and the observed events only", async () => {
    await reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", [GUY_J]], ["e-2", []]]));
    const read = sent[0];
    expect(read.text).toMatch(/^select "event_id", "artist_name", "url" from "event_soundcloud_links" where \("event_soundcloud_links"\."source_id" = \$1 and "event_soundcloud_links"\."event_id" in \(\$2, \$3\)\)$/);
    expect(read.values).toEqual(["src-culture-box", "e-1", "e-2"]);
  });

  it("steady state (nothing changed): the read is the only query — no writes", async () => {
    storedRows = [["e-1", "GUY J", GUY_J.url]];
    await reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", [GUY_J]]]));
    expect(sent).toHaveLength(1);
  });

  it("new and changed links: one upsert for all of them, keyed on (event, source, name)", async () => {
    storedRows = [["e-1", "GUY J", "https://soundcloud.com/old"]];
    await reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", [GUY_J, TIM]]]));
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toMatch(/^insert into "event_soundcloud_links" .* on conflict \("event_id","source_id","artist_name"\) do update set "url" = excluded\.url, "updated_at" = \$\d+$/);
    expect(sent[1].values).toEqual(expect.arrayContaining(["e-1", "src-culture-box", "GUY J", GUY_J.url, "TIM ANDRESEN", TIM.url]));
  });

  it("a documented removal deletes only that source's row for that event and name", async () => {
    storedRows = [
      ["e-1", "GUY J", GUY_J.url],
      ["e-1", "TIM ANDRESEN", TIM.url],
    ];
    await reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", [GUY_J]]]));
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toMatch(/^delete from "event_soundcloud_links" where \(.*"source_id" = \$1 and .*"event_id" = \$2 and .*"artist_name" in \(\$3\)\)$/);
    expect(sent[1].values).toEqual(["src-culture-box", "e-1", "TIM ANDRESEN"]);
  });

  it("a run that saw no links at all deletes nothing", async () => {
    storedRows = [["e-1", "GUY J", GUY_J.url]];
    const plan = await reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", []]]));
    expect(sent).toHaveLength(1);
    expect(plan.suppressedDeletes).toBe(1);
  });

  it("never reads or writes the block table, so blocks survive every sync", async () => {
    storedRows = [["e-1", "TIM ANDRESEN", TIM.url]];
    await reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", [GUY_J]]]));
    expect(sent.length).toBeGreaterThan(1);
    for (const q of sent) expect(q.text).not.toContain("soundcloud_link_blocks");
  });
});

describe("block / unblock — touch only the block table", () => {
  it("block inserts the profile URL, idempotently", async () => {
    await blockSoundcloudProfile("https://soundcloud.com/wrong", "not this artist");
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/^insert into "soundcloud_link_blocks" .* on conflict do nothing$/);
    expect(sent[0].values).toEqual(expect.arrayContaining(["https://soundcloud.com/wrong", "not this artist"]));
  });

  it("unblock deletes exactly that URL's block row", async () => {
    await unblockSoundcloudProfile("https://soundcloud.com/wrong");
    expect(sent).toEqual([{ text: 'delete from "soundcloud_link_blocks" where "soundcloud_link_blocks"."url" = $1', values: ["https://soundcloud.com/wrong"] }]);
  });
});
