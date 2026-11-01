import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";

/**
 * Supabase egress work, 2026-11-01: /events/[slug] and /venues/[slug] look
 * up the same row from generateMetadata and from the page. Both lookups are
 * wrapped in React `cache`, which memoizes per server request (Next.js docs:
 * "Memoizing data requests"). Outside a request — which is where vitest runs
 * — React's `cache` just calls through, so here it is replaced by a plain
 * memoizer standing in for one request, to check that the wrapper is in
 * place: two calls with the same slug send the queries once.
 */

const sent: string[] = [];
const fakeClient = {
  query: vi.fn(async (config: { text: string } | string) => {
    sent.push(typeof config === "string" ? config : config.text);
    return { rows: [], rowCount: 0, fields: [] };
  }),
};

vi.mock("@/db/client", () => ({ db: drizzle({ client: fakeClient as never, schema }) }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const memo = new Map<string, R>();
      return (...args: A) => {
        const key = JSON.stringify(args);
        if (!memo.has(key)) memo.set(key, fn(...args));
        return memo.get(key)!;
      };
    },
  };
});

const { getEventBySlugWithVenue, getVenueBySlug } = await import("./queries");

beforeEach(() => {
  sent.length = 0;
});

describe("metadata + page lookups are memoized per request", () => {
  it("getEventBySlugWithVenue: the second call for the same slug sends no query", async () => {
    await getEventBySlugWithVenue("memo-event");
    const afterFirst = sent.length;
    await getEventBySlugWithVenue("memo-event");
    expect(afterFirst).toBe(1); // no event row → no venue query
    expect(sent).toHaveLength(1);
    // A different slug is its own lookup.
    await getEventBySlugWithVenue("other-event");
    expect(sent).toHaveLength(2);
  });

  it("getVenueBySlug: the second call for the same slug sends no query", async () => {
    await getVenueBySlug("memo-venue");
    await getVenueBySlug("memo-venue");
    expect(sent).toHaveLength(1);
  });
});
