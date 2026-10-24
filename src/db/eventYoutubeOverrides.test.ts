import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * The SQL the per-event override writes actually send (2026-10-23), through
 * the real drizzle query builder against a fake client. The point: set/hide/
 * clear/verify write event_youtube_preview_overrides ONLY — never the
 * per-artist cache the automated matcher owns — and unpinArtistPreviewRow
 * (the one-off artist-pin migration) touches exactly one artist row.
 */

const sent: { text: string; values: unknown[] }[] = [];
const fakeClient = {
  query: vi.fn(async (config: { text: string } | string, values?: unknown[]) => {
    sent.push({ text: typeof config === "string" ? config : config.text, values: values ?? [] });
    return { rows: [], rowCount: 0, fields: [] };
  }),
};
vi.mock("./client", () => ({ db: drizzle({ client: fakeClient as never, schema }) }));

const { setEventVideo, hideEventVideo, clearEventOverride, applyVerification, unpinArtistPreviewRow } = await import("./eventYoutubeOverrides");

const now = new Date("2026-10-26T05:17:00Z");
const video = { videoId: "Pbb0KmuwYSA", title: "steamboi | REX Radio (10.11.25)", channelId: "UCIvOWIx4ISwqaYLc9kEwqxA", channelTitle: "REX Radio" };
const writes = () => sent.filter((q) => /^(insert|update|delete)/i.test(q.text));

beforeEach(() => {
  sent.length = 0;
});

describe("event override writes never touch the artist cache", () => {
  it.each<[string, () => Promise<void>]>([
    ["setEventVideo", () => setEventVideo("e-a2b5cf47", video, "STEAMBOI", now)],
    ["hideEventVideo", () => hideEventVideo("e-a2b5cf47", now)],
    ["clearEventOverride", () => clearEventOverride("e-a2b5cf47")],
    [
      "applyVerification",
      () =>
        applyVerification(
          [
            { eventId: "e-1", videoId: "v1", available: false, unavailableSince: now, changed: true },
            { eventId: "e-2", videoId: "v2", available: true, unavailableSince: undefined, changed: false },
          ],
          now,
        ),
    ],
  ])("%s writes only event_youtube_preview_overrides", async (_name, op) => {
    await op();
    expect(writes().length).toBeGreaterThan(0);
    for (const q of writes()) {
      expect(q.text).toMatch(/^(insert into|update|delete from) "event_youtube_preview_overrides"/i);
      expect(q.text).not.toContain("artist_youtube_preview_cache");
    }
  });

  it("setEventVideo upserts on the event id and marks the video available and verified now", async () => {
    await setEventVideo("e-a2b5cf47", video, "STEAMBOI", now);
    const [q] = writes();
    expect(q.text).toMatch(/on conflict \("event_id"\) do update/i);
    expect(q.values).toEqual(expect.arrayContaining(["e-a2b5cf47", "video", "Pbb0KmuwYSA", "STEAMBOI", true]));
  });

  it("hideEventVideo only changes the mode (the chosen video's details stay on the row)", async () => {
    await hideEventVideo("e-a2b5cf47", now);
    const [q] = writes();
    const updateSet = q.text.slice(q.text.toLowerCase().indexOf("do update set"));
    expect(updateSet).toContain('"mode"');
    expect(updateSet).not.toMatch(/"video_id"|"video_title"|"available"/);
  });

  it("clearEventOverride deletes exactly this event's row", async () => {
    await clearEventOverride("e-a2b5cf47");
    expect(writes()).toHaveLength(1);
    expect(writes()[0].values).toEqual(["e-a2b5cf47"]);
  });

  it("applyVerification leaves unavailable_since alone when nothing flipped", async () => {
    await applyVerification([{ eventId: "e-2", videoId: "v2", available: true, unavailableSince: undefined, changed: false }], now);
    expect(writes()[0].text).not.toContain("unavailable_since");
  });
});

describe("unpinArtistPreviewRow (one-off artist-pin migration)", () => {
  const pinned = {
    artistNameNormalized: "steamboi",
    provider: "youtube",
    status: "accepted",
    matchRule: "manual",
    query: "",
    videoId: "Pbb0KmuwYSA",
    videoTitle: "steamboi | REX Radio (10.11.25)",
    channelId: "UCIvOWIx4ISwqaYLc9kEwqxA",
    channelTitle: "REX Radio",
    evidence: { manualPin: { pinnedAt: "2026-10-23T13:34:18Z" } },
    manualBlock: false,
    matchedAt: now,
    lastVerifiedAt: now,
    expiresAt: new Date("2100-01-01T00:00:00Z"),
  };

  it("updates exactly that one artist row to an expired abstain, keeping manual_block and the pin's audit trail", async () => {
    await unpinArtistPreviewRow(pinned, now);
    expect(writes()).toHaveLength(1);
    const [q] = writes();
    expect(q.text).toMatch(/^update "artist_youtube_preview_cache" set/i);
    expect(q.text).toMatch(/where "artist_youtube_preview_cache"\."artist_name_normalized" = \$\d+$/);
    expect(q.values.at(-1)).toBe("steamboi");
    expect(q.text).not.toContain("manual_block");
    expect(q.values).toContain("abstain");
    const evidence = JSON.parse(q.values.find((v) => typeof v === "string" && v.includes("unpinned")) as string);
    expect(evidence.unpinned).toMatchObject({ pinnedVideoId: "Pbb0KmuwYSA", pinEvidence: pinned.evidence });
    // expires_at = now, so the next lookup re-matches instead of waiting out a TTL.
    expect(q.values.filter((v) => v === now.toISOString()).length).toBeGreaterThanOrEqual(1);
  });
});
