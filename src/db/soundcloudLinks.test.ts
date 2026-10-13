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
/** Statements matching this fail like a dropped connection would. */
let failOn: RegExp | null = null;

const fakeClient = {
  query: vi.fn(async (config: { text: string } | string, values?: unknown[]) => {
    const text = typeof config === "string" ? config : config.text;
    sent.push({ text, values: values ?? [] });
    if (failOn?.test(text)) throw new Error("connection terminated unexpectedly");
    const isSelect = /^select /i.test(text);
    return { rows: isSelect ? storedRows : [], rowCount: 0, fields: [] };
  }),
};

vi.mock("./client", () => ({ db: drizzle({ client: fakeClient as never, schema }) }));

const { reconcileSourceSoundcloudLinks, blockSoundcloudProfile, unblockSoundcloudProfile } = await import("./soundcloudLinks");

const GUY_J = { name: "GUY J", url: "https://soundcloud.com/guy-j" };
const TIM = { name: "TIM ANDRESEN", url: "https://soundcloud.com/tim-andresen" };
/** A completely parsed night (absence documented) carrying `links`. */
const night = (...links: { name: string; url: string }[]) => ({ links, absenceDocumented: true });

beforeEach(() => {
  sent.length = 0;
  storedRows = [];
  failOn = null;
});

describe("reconcileSourceSoundcloudLinks — database usage per sync run", () => {
  it("no observations: no query at all", async () => {
    await reconcileSourceSoundcloudLinks("src-culture-box", new Map());
    expect(sent).toEqual([]);
  });

  it("one narrow read scoped to this source and the observed events only", async () => {
    await reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", night(GUY_J)], ["e-2", night()]]));
    const read = sent[0];
    expect(read.text).toMatch(/^select "event_id", "artist_name", "url" from "event_soundcloud_links" where \("event_soundcloud_links"\."source_id" = \$1 and "event_soundcloud_links"\."event_id" in \(\$2, \$3\)\)$/);
    expect(read.values).toEqual(["src-culture-box", "e-1", "e-2"]);
  });

  it("steady state (nothing changed): the read is the only query — no writes", async () => {
    storedRows = [["e-1", "GUY J", GUY_J.url]];
    await reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", night(GUY_J)]]));
    expect(sent).toHaveLength(1);
  });

  it("new and changed links: one upsert for all of them, keyed on (event, source, name)", async () => {
    storedRows = [["e-1", "GUY J", "https://soundcloud.com/old"]];
    await reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", night(GUY_J, TIM)]]));
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toMatch(/^insert into "event_soundcloud_links" .* on conflict \("event_id","source_id","artist_name"\) do update set "url" = excluded\.url, "updated_at" = \$\d+$/);
    expect(sent[1].values).toEqual(expect.arrayContaining(["e-1", "src-culture-box", "GUY J", GUY_J.url, "TIM ANDRESEN", TIM.url]));
  });

  it("a documented removal deletes only that source's row for that event and name", async () => {
    storedRows = [
      ["e-1", "GUY J", GUY_J.url],
      ["e-1", "TIM ANDRESEN", TIM.url],
    ];
    await reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", night(GUY_J)]]));
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toMatch(/^delete from "event_soundcloud_links" where \(.*"source_id" = \$1 and .*"event_id" = \$2 and .*"artist_name" in \(\$3\)\)$/);
    expect(sent[1].values).toEqual(["src-culture-box", "e-1", "TIM ANDRESEN"]);
  });

  it("a run that saw no links at all deletes nothing", async () => {
    storedRows = [["e-1", "GUY J", GUY_J.url]];
    const plan = await reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", night()]]));
    expect(sent).toHaveLength(1);
    expect(plan.suppressedDeletes).toBe(1);
  });

  it("never reads or writes the block table, so blocks survive every sync", async () => {
    storedRows = [["e-1", "TIM ANDRESEN", TIM.url]];
    await reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", night(GUY_J)]]));
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

describe("partial database failures — why no transaction is needed (see the comment in reconcileSourceSoundcloudLinks)", () => {
  const TIM_ROW = ["e-1", "TIM ANDRESEN", TIM.url];
  const GUY_ROW = ["e-1", "GUY J", GUY_J.url];

  it("upsert fails: the run stops before any delete, so nothing at all changed", async () => {
    storedRows = [TIM_ROW];
    failOn = /^insert into "event_soundcloud_links"/;
    await expect(reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", night(GUY_J)]]))).rejects.toThrow();
    expect(sent.map((q) => q.text.split(" ")[0])).toEqual(["select", "insert"]);
  });

  it("delete fails after a successful upsert: the new link is live, the old row remains, and the next run plans only that delete", async () => {
    storedRows = [TIM_ROW];
    failOn = /^delete from "event_soundcloud_links"/;
    await expect(reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", night(GUY_J)]]))).rejects.toThrow();
    expect(sent.map((q) => q.text.split(" ")[0])).toEqual(["select", "insert", "delete"]);

    // Next run: the database now holds the upserted GUY J row plus the stale TIM row.
    sent.length = 0;
    failOn = null;
    storedRows = [GUY_ROW, TIM_ROW];
    const plan = await reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", night(GUY_J)]]));
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([{ eventId: "e-1", artistName: "TIM ANDRESEN" }]);
    expect(sent.map((q) => q.text.split(" ")[0])).toEqual(["select", "delete"]);
  });

  it("each event's delete is its own single statement, so a failure leaves every event either fully old or fully new", async () => {
    storedRows = [
      ["e-1", "TIM ANDRESEN", TIM.url],
      ["e-2", "TIM ANDRESEN", TIM.url],
    ];
    await reconcileSourceSoundcloudLinks("src-culture-box", new Map([["e-1", night(GUY_J)], ["e-2", night(GUY_J)]]));
    const deletes = sent.filter((q) => q.text.startsWith("delete"));
    expect(deletes.map((q) => q.values)).toEqual([
      ["src-culture-box", "e-1", "TIM ANDRESEN"],
      ["src-culture-box", "e-2", "TIM ANDRESEN"],
    ]);
  });
});
