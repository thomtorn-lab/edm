import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RA reference through the Discovery Queue, end to end (RA link integrity +
 * editorial screening, 2026-10-17/18): the real updateDiscoveryItem (admin
 * "Save edit", which locks only changed or cleared fields),
 * buildDiscoveryQueueClassificationPatch (the next sync's fill),
 * publishDiscoveryItem, the published event's next sync
 * (buildSyncPatch + stripOverriddenFields) and getExternalLinks. Only the
 * db client is mocked.
 */

// Awaitable directly (createEvent's own `events` row insert) AND chainable
// with .onConflictDoNothing() (recordSourceLink's `source_event_links`
// insert) — both real shapes db.insert(...).values(...) takes in writes.ts,
// so a full publishDiscoveryItem happy path (admin + public link integrity,
// 2026-09-08) can now be exercised end to end rather than only its early
// guard-throw branches, as every test below this originally stopped short of.
const insertValuesMock = vi.fn((row: unknown) => {
  void row; // typed only so insertValuesMock.mock.calls[n][0] below stays indexable — the mock ignores the actual value
  const resolved = Promise.resolve(undefined);
  return Object.assign(resolved, { onConflictDoNothing: () => Promise.resolve(undefined) });
});

// Queue of rows returned by successive db.select().from().where().limit()
// calls, consumed in call order (admin unpublish/cancellation safety,
// 2026-09-06 — adminUnpublishEvent/adminRepublishEvent/publishDiscoveryItem's
// duplicate guard all read an existing row via this exact chain shape).
let selectResults: unknown[][] = [];
const selectMock = vi.fn(() => ({
  from: () => ({
    where: () => ({
      limit: () => Promise.resolve(selectResults.shift() ?? []),
    }),
  }),
}));
const updateSetMock = vi.fn();
const updateMock = vi.fn(() => ({
  set: (patch: Record<string, unknown>) => {
    updateSetMock(patch);
    return { where: () => Promise.resolve(undefined) };
  },
}));

vi.mock("./client", () => ({
  db: {
    insert: () => ({ values: insertValuesMock }),
    select: () => selectMock(),
    update: () => updateMock(),
  },
}));

// createEvent's YouTube Artist Preview cache warm-up (2026-09-25) is
// deliberately mocked out here rather than exercised through this file's
// generic db mock above — every fixture below uses an empty lineup, so in
// practice the real hook never reaches a db call either way, but mocking it
// explicitly keeps that independent of any future fixture adding a
// non-empty detectedLineup, and lets the "never blocks event creation"
// contract be tested directly (see the dedicated describe block below).
const enrichArtistYoutubePreviewsMock = vi.fn(async (artistNames: string[]) => {
  void artistNames;
});
vi.mock("./youtubePreview", () => ({
  enrichArtistYoutubePreviews: (artistNames: string[]) => enrichArtistYoutubePreviewsMock(artistNames),
}));

const { publishDiscoveryItem, updateDiscoveryItem } = await import("./writes");
const { buildDiscoveryQueueClassificationPatch, buildSyncPatch } = await import("../lib/sync");
const { stripOverriddenFields } = await import("../lib/override");
const { getExternalLinks } = await import("../lib/links");


// #149 (RA reference kept through the Discovery Queue) + #151 (admin saves
// lock only changed/cleared fields), tested together (2026-10-17).
const RA_AUTO = "https://ra.co/events/2521204"; // what the adapter (HvadErPå offers.url) reported
const RA_OTHER = "https://ra.co/events/2600000"; // a later, different adapter value

const storedDq = {
  id: "dq-1",
  status: "pending",
  sourceId: "src-hvaderpaa",
  sourceUrl: "https://hvaderpaa.dk/da/event/19246/",
  probableTitle: "Whipped #6",
  description: "Whipped #6 præsenterer Alarico på Den Anden Side.",
  probableVenueName: "Den Anden Side",
  probableSubVenue: null as string | null,
  detectedLineup: ["Alarico"],
  predictedGenre: "techno",
  predictedSecondaryGenre: null as string | null,
  probableOfficialEventUrl: "https://hvaderpaa.dk/da/event/19246/",
  probableTicketUrl: null as string | null,
  probableResidentAdvisorUrl: RA_AUTO as string | null,
  probableFree: false,
  probableStart: new Date("2026-10-24T21:59:00Z"),
  probableEnd: new Date("2026-10-25T06:00:00Z") as Date | null,
  missingFields: [] as string[],
  overriddenFields: [] as string[],
  suspectedDuplicateOfEventId: null,
  genreConfidence: "medium",
  overallConfidence: "medium",
};

// Exactly what DiscoveryQueue.tsx "Save edit" posts: every editor field, the
// RA field pre-filled with whatever is stored.
function saveEditPayload(row: typeof storedDq, overrides: Record<string, unknown> = {}) {
  return {
    probableTitle: row.probableTitle,
    description: row.description,
    probableVenueName: row.probableVenueName,
    probableSubVenue: null,
    detectedLineup: [...row.detectedLineup],
    predictedGenre: row.predictedGenre,
    predictedSecondaryGenre: null,
    probableOfficialEventUrl: row.probableOfficialEventUrl,
    probableTicketUrl: row.probableTicketUrl,
    probableResidentAdvisorUrl: row.probableResidentAdvisorUrl,
    probableFree: false,
    probableStart: new Date(row.probableStart),
    probableEnd: row.probableEnd ? new Date(row.probableEnd) : null,
    ...overrides,
  } as Parameters<typeof updateDiscoveryItem>[1];
}

/** Runs the real DQ save, returns the row as it would now be stored. */
async function save(row: typeof storedDq, overrides: Record<string, unknown>) {
  updateSetMock.mockClear();
  selectResults = [[{ ...row }]];
  await updateDiscoveryItem(row.id, saveEditPayload(row, overrides));
  const written = updateSetMock.mock.calls[0]?.[0] ?? {};
  return { ...row, ...written } as typeof storedDq;
}

/** The next sync's RA-reference fill for this pending row. */
function nextSync(row: typeof storedDq, freshRa: string | null) {
  return buildDiscoveryQueueClassificationPatch(
    { genre: "techno", genreConfidence: "medium", decision: "review_queue", residentAdvisorUrl: freshRa },
    {
      status: "pending",
      predictedGenre: "techno",
      genreConfidence: "medium",
      overriddenFields: row.overriddenFields,
      overallConfidence: "medium",
      missingFields: [],
      probableSubVenue: null,
      suspectedDuplicateOfEventId: null,
      venueResolvedDecision: null,
      venueResolvedHoldReason: null,
      holdReason: null,
      probableTicketUrl: row.probableTicketUrl,
      probableOfficialEventUrl: row.probableOfficialEventUrl,
      probableResidentAdvisorUrl: row.probableResidentAdvisorUrl,
    },
  );
}

async function publish(row: typeof storedDq) {
  insertValuesMock.mockClear();
  selectResults = [[{ ...row }]];
  await publishDiscoveryItem(row.id, "v-den-anden-side");
  return insertValuesMock.mock.calls.find(
    (call) => typeof call[0] === "object" && call[0] !== null && "slug" in (call[0] as object),
  )?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  insertValuesMock.mockClear();
  updateSetMock.mockClear();
  selectResults = [];
});

describe("#149 + #151: RA reference in the Discovery Queue", () => {
  it("1. an ordinary admin save (title fixed, RA field untouched) does NOT mark the auto-found RA reference as a manual override", async () => {
    const saved = await save(storedDq, { probableTitle: "Whipped #6 with Alarico" });
    expect(saved.overriddenFields).toEqual(["probableTitle"]);
    expect(saved.probableResidentAdvisorUrl).toBe(RA_AUTO);
    // Still source-derived: published without a residentAdvisorUrl lock.
    const event = await publish(saved);
    expect(event.residentAdvisorUrl).toBe(RA_AUTO);
    expect(event.overriddenFields).toEqual(["title"]);
  });

  it("2a. a deliberately changed RA link is protected: the next sync never replaces it, and publish carries the lock", async () => {
    const saved = await save(storedDq, { probableResidentAdvisorUrl: "https://ra.co/events/1111111" });
    expect(saved.overriddenFields).toEqual(["probableResidentAdvisorUrl"]);
    expect(nextSync(saved, RA_OTHER)).not.toHaveProperty("probableResidentAdvisorUrl");
    const event = await publish(saved);
    expect(event.residentAdvisorUrl).toBe("https://ra.co/events/1111111");
    expect(event.overriddenFields).toContain("residentAdvisorUrl");
  });

  it("2b. a deliberately cleared RA link stays empty: the next sync never refills it, and publish carries the lock", async () => {
    const saved = await save(storedDq, { probableResidentAdvisorUrl: null });
    expect(saved.overriddenFields).toEqual(["probableResidentAdvisorUrl"]);
    expect(saved.probableResidentAdvisorUrl).toBeNull();
    expect(nextSync(saved, RA_AUTO)).not.toHaveProperty("probableResidentAdvisorUrl");
    const event = await publish(saved);
    expect(event.residentAdvisorUrl).toBeNull();
    expect(event.overriddenFields).toContain("residentAdvisorUrl");
  });

  it("2c. cleared on a row whose own sourceUrl is an RA page (admin pasted an RA link): publish must not restore it from sourceUrl", async () => {
    const raSourced = { ...storedDq, sourceId: "src-ra-copenhagen", sourceUrl: RA_AUTO, probableResidentAdvisorUrl: RA_AUTO };
    const saved = await save(raSourced, { probableResidentAdvisorUrl: null });
    const event = await publish(saved);
    expect(event.residentAdvisorUrl).toBeNull();
    expect(event.overriddenFields).toContain("residentAdvisorUrl");
  });

  it("3. an unprotected empty RA reference is still filled by a later sync, also after an ordinary admin save left it empty", async () => {
    const empty = { ...storedDq, probableResidentAdvisorUrl: null };
    expect(nextSync(empty, RA_AUTO)).toEqual({ probableResidentAdvisorUrl: RA_AUTO });
    const saved = await save(empty, { probableTitle: "Whipped #6 with Alarico" });
    expect(saved.overriddenFields).toEqual(["probableTitle"]);
    expect(nextSync(saved, RA_AUTO)).toEqual({ probableResidentAdvisorUrl: RA_AUTO });
  });

  it("3b. a stored, unprotected RA reference is never replaced by a different later value (fill-only)", () => {
    expect(nextSync(storedDq, RA_OTHER)).not.toHaveProperty("probableResidentAdvisorUrl");
  });

  it("5. after publish, the event's next source sync may update an unlocked RA reference but never a locked one, and never turns it into a ticket link", async () => {
    const syncFrom = (event: Record<string, unknown>) =>
      buildSyncPatch(
        {
          sourceId: "src-hvaderpaa",
          sourceUrl: "https://hvaderpaa.dk/da/event/19246/",
          title: "Whipped #6",
          description: null,
          artists: ["Alarico"],
          startDatetime: null,
          endDatetime: null,
          venueName: "Den Anden Side",
          officialEventUrl: "https://hvaderpaa.dk/da/event/19246/",
          ticketUrl: null,
          facebookUrl: null,
          residentAdvisorUrl: RA_OTHER,
          imageUrl: null,
          priceFrom: null,
          genreHint: null,
          genreConfidenceHint: null,
        },
        { resolvedVenueId: null, normalizedArtists: [], genre: null, genreConfidence: "low" },
        {
          id: "e-1",
          title: "Whipped #6",
          description: null,
          artists: ["Alarico"],
          venueId: "v-den-anden-side",
          subVenue: null,
          startDatetime: "2026-10-24T21:59:00Z",
          endDatetime: null,
          officialEventUrl: event.officialEventUrl as string,
          ticketUrl: (event.ticketUrl as string | null) ?? null,
          facebookUrl: null,
          residentAdvisorUrl: (event.residentAdvisorUrl as string | null) ?? null,
          imageUrl: null,
          primaryGenre: "techno",
          canonicalSourceId: "src-hvaderpaa",
          overriddenFields: event.overriddenFields as string[],
          soldOut: false,
          cancelled: false,
          postponed: false,
        },
      ).patch;

    // Ordinary save -> unlocked auto RA -> the source's newer RA reference is applied.
    const auto = await publish(await save(storedDq, { probableTitle: "Whipped #6 with Alarico" }));
    const autoPatch = stripOverriddenFields(syncFrom(auto), auto.overriddenFields as string[]);
    expect(autoPatch.residentAdvisorUrl).toBe(RA_OTHER);
    expect(autoPatch).not.toHaveProperty("ticketUrl");

    // Deliberately changed RA -> locked -> the source's value is stripped before it reaches the database.
    const manual = await publish(await save(storedDq, { probableResidentAdvisorUrl: "https://ra.co/events/1111111" }));
    expect(stripOverriddenFields(syncFrom(manual), manual.overriddenFields as string[])).not.toHaveProperty("residentAdvisorUrl");

    // Deliberately cleared RA -> locked -> never refilled by the sync.
    const cleared = await publish(await save(storedDq, { probableResidentAdvisorUrl: null }));
    expect(stripOverriddenFields(syncFrom(cleared), cleared.overriddenFields as string[])).not.toHaveProperty("residentAdvisorUrl");
  });

  it("4. an RA reference never becomes a Tickets link: not at publish, not in the public links", async () => {
    const event = await publish(storedDq);
    expect(event.residentAdvisorUrl).toBe(RA_AUTO);
    expect(event.ticketUrl).toBeNull();
    const links = getExternalLinks({
      officialEventUrl: event.officialEventUrl as string,
      ticketUrl: null,
      facebookUrl: null,
      residentAdvisorUrl: RA_AUTO,
      otherSourceUrls: [],
      canonicalSourceId: "src-hvaderpaa",
      overriddenFields: event.overriddenFields as string[],
      soldOut: false,
    });
    expect(links.some((l) => l.label === "Tickets")).toBe(false);
    expect(links.some((l) => l.href.includes("ra.co"))).toBe(false);
  });
});
