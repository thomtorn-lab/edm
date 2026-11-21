import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListEvent } from "@/lib/queries";

const listMock = vi.fn();

vi.mock("@/lib/queries", () => ({
  getUpcomingPublishedEventsForList: (...args: unknown[]) => listMock(...args),
}));

const { GET } = await import("./route");

function listEvent(overrides: Partial<ListEvent> = {}): ListEvent {
  return {
    id: "e-1",
    slug: "techno-night-e-1",
    title: "Techno Night",
    description: null,
    artists: ["dj one", "DJ Two"],
    startDatetime: "2026-11-21T22:00:00.000Z",
    endDatetime: "2026-11-22T05:00:00.000Z",
    subVenue: null,
    primaryGenre: "techno",
    subgenres: ["techno"],
    officialEventUrl: "https://www.hangaren.dk/events/techno-night",
    ticketUrl: "https://tickets.example.com/techno-night",
    facebookUrl: null,
    residentAdvisorUrl: null,
    otherSourceUrls: [],
    canonicalSourceId: "src-hangaren",
    overriddenFields: [],
    priceFrom: null,
    soldOut: false,
    postponed: false,
    dateChanged: false,
    venue: { id: "v-hangaren", slug: "hangaren", name: "Hangaren", address: "Refshalevej 1", aliases: [] },
    ...overrides,
  };
}

beforeEach(() => {
  listMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-21T12:00:00.000Z"));
});

describe("GET /api/v1/events", () => {
  it("returns upcoming events in start order, using the site's presentation helpers", async () => {
    listMock.mockResolvedValue([
      listEvent({ id: "e-2", slug: "later-e-2", startDatetime: "2026-11-28T22:00:00.000Z", endDatetime: null, soldOut: true }),
      listEvent(),
      // Already over: last night's event (ended this morning).
      listEvent({ id: "e-0", slug: "past-e-0", startDatetime: "2026-11-20T22:00:00.000Z", endDatetime: "2026-11-21T05:00:00.000Z" }),
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=60");
    expect(body.events.map((e: { id: string }) => e.id)).toEqual(["e-1", "e-2"]);

    const [first, second] = body.events;
    expect(first).toMatchObject({
      slug: "techno-night-e-1",
      url: "https://www.electroniccph.com/events/techno-night-e-1",
      title: "Techno Night",
      venue: { id: "v-hangaren", name: "Hangaren", address: "Refshalevej 1" },
      subgenres: ["techno"],
      statuses: [],
      free: false,
    });
    expect(first.lineup).toEqual(["DJ One", "DJ Two"]);
    expect(first.links.map((l: { label: string }) => l.label)).toEqual(["Official event", "Tickets"]);
    expect(second.statuses).toEqual(["Sold out"]);
  });

  it("only exposes the app contract, never internal fields", async () => {
    listMock.mockResolvedValue([listEvent()]);
    const body = await (await GET()).json();
    expect(Object.keys(body.events[0]).sort()).toEqual(
      ["endDatetime", "free", "id", "lineup", "links", "slug", "startDatetime", "statuses", "subVenue", "subgenres", "title", "url", "venue"],
    );
  });
});
