import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Admin-UI video writes through the REAL override writes and drizzle query
 * builder against a fake node-postgres client (as in eventYoutubeOverrides.test.ts):
 * choosing, hiding or resetting the video on one event writes exactly one
 * statement, against event_youtube_preview_overrides only, bound to that one
 * event id — no other event's override and no artist-cache row can change.
 */

const EVENT_ID = "e-a2b5cf47";
const OTHER_EVENT_ID = "e-11111111";
const sent: { text: string; values: unknown[] }[] = [];

function answer(text: string): unknown[][] {
  if (!/^select .* from "events"/i.test(text)) return [];
  const event: Record<string, unknown> = { id: EVENT_ID, slug: "steamboi", title: "Steamboi", artists: ["STEAMBOI"], start_datetime: new Date(), published: true };
  const columns = (/^select (.*?) from /i.exec(text)?.[1] ?? "").split(", ").map((c) => c.replace(/^"[a-z_]+"\./, "").replace(/"/g, ""));
  return [columns.map((c) => event[c] ?? null)];
}

const fakeClient = {
  query: vi.fn(async (config: { text: string } | string, values?: unknown[]) => {
    const text = typeof config === "string" ? config : config.text;
    sent.push({ text, values: values ?? [] });
    return { rows: answer(text), rowCount: 0, fields: [] };
  }),
};
vi.mock("./client", () => ({ db: drizzle({ client: fakeClient as never, schema }) }));
vi.mock("@/lib/enrichment/youtubeClient", () => ({
  getVideoSnippet: async (videoId: string) => ({ videoId, title: "t", channelId: "c", channelTitle: "ch", embeddable: true, privacyStatus: "public" }),
}));

const { setEventYoutubeVideo, hideEventYoutubeVideo, resetEventYoutubeToAuto } = await import("./eventYoutubeAdmin");
const writes = () => sent.filter((q) => /^(insert|update|delete)/i.test(q.text));

beforeEach(() => {
  sent.length = 0;
});

describe("admin video writes are scoped to one event", () => {
  it.each<[string, () => Promise<unknown>]>([
    ["choose a video", () => setEventYoutubeVideo(EVENT_ID, "https://youtu.be/Pbb0KmuwYSA")],
    ["hide", () => hideEventYoutubeVideo(EVENT_ID)],
    ["back to automatic", () => resetEventYoutubeToAuto(EVENT_ID)],
  ])("%s: one write, to event_youtube_preview_overrides, for this event id only", async (_label, op) => {
    await op();
    const w = writes();
    expect(w).toHaveLength(1);
    expect(w[0].text).toMatch(/^(insert into|delete from) "event_youtube_preview_overrides"/i);
    expect(w[0].text).not.toContain("artist_youtube_preview_cache");
    expect(w[0].values).toContain(EVENT_ID);
    expect(w[0].values).not.toContain(OTHER_EVENT_ID);
    // An upsert keyed on the event id, or a delete with that id bound — never an unbounded statement.
    expect(w[0].text).toMatch(/on conflict \("event_id"\) do update|where "event_youtube_preview_overrides"\."event_id" = \$1/i);
  });

  it("the delete for 'back to automatic' binds exactly the one event id", async () => {
    await resetEventYoutubeToAuto(EVENT_ID);
    expect(writes()[0].values).toEqual([EVENT_ID]);
  });
});
