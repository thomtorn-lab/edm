// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import AdminQueueTabs from "./AdminQueueTabs";
import type { AdminQueueGroups, AdminUnpublishedRow, PublishedQueueRow } from "@/lib/adminQueue";
import type { DiscoveryQueueItem, Venue } from "@/lib/types";
import type { GroupedReviewList, NotInSourceReview, PastStaleSplit, PrioritizedReviewRow, ReviewPriority, ReviewPriorityList } from "@/lib/reviewPriority";

const { getSearchParams, setSearchParams } = vi.hoisted(() => {
  let params = new URLSearchParams();
  return {
    getSearchParams: () => params,
    setSearchParams: (p: URLSearchParams) => {
      params = p;
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => getSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setSearchParams(new URLSearchParams());
});

function makeItem(id: string, title: string): DiscoveryQueueItem {
  return {
    id,
    probableTitle: title,
    probableStart: "2026-09-20T20:00:00.000Z",
    probableEnd: null,
    probableTicketUrl: null,
    probableOfficialEventUrl: null,
    probableResidentAdvisorUrl: null,
    description: null,
    probableFree: false,
    probableVenueName: "Culture Box",
    probableSubVenue: null,
    sourceName: "src-test",
    sourceUrl: "https://example.com/1",
    sourceId: "src-test",
    detectedLineup: [],
    predictedGenre: "techno",
    predictedSecondaryGenre: null,
    genreConfidence: "high",
    suspectedDuplicateOfEventId: null,
    missingFields: [],
    overallConfidence: "high",
    status: "pending",
    holdReason: null,
    lastSeenAt: null,
    venueResolvedDecision: null,
    venueResolvedHoldReason: null,
  };
}

const VENUES: Venue[] = [
  {
    id: "v-culture-box",
    slug: "culture-box",
    name: "Culture Box",
    aliases: [],
    address: "Kronprinsessegade 54A, 1306 København K",
    city: "Copenhagen",
    postalCode: "1306",
    websiteUrl: null,
    description: "",
    shortDescription: null,
    venueProfile: null,
  },
];

const EMPTY_GROUPS: AdminQueueGroups = {
  needs_review: [makeItem("dq-nr", "Needs Review Item")],
  venue_blocked: [makeItem("dq-vb", "Venue Blocked Item")],
  insufficient: [],
  rejected: [],
  past_stale: [],
};

const PUBLISHED: PublishedQueueRow[] = [
  {
    item: makeItem("dq-pub", "Published Item"),
    canonicalEventId: "e-1",
    canonicalTitle: "Published Item (canonical)",
    canonicalVenueName: "Culture Box",
  },
];

const ADMIN_UNPUBLISHED: AdminUnpublishedRow[] = [
  {
    eventId: "e-jasho",
    title: "Jasho Club // Poolen Outside",
    reason: "cancelled",
    note: null,
    unpublishedAt: "2026-09-06T09:00:00+02:00",
    venueName: "Poolen",
    sourceName: "src-poolen",
  },
];

describe("AdminQueueTabs", () => {
  afterEach(cleanup);

  it("defaults to the Needs review tab, showing only its rows", () => {
    render(<AdminQueueTabs groups={EMPTY_GROUPS} published={PUBLISHED} adminUnpublished={ADMIN_UNPUBLISHED} venues={VENUES} />);

    const needsReviewTab = screen.getByRole("tab", { name: /Needs review/ });
    expect(needsReviewTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Needs Review Item")).toBeTruthy();
    expect(screen.queryByText("Venue Blocked Item")).toBeNull();
    expect(screen.queryByText("Published Item (canonical)")).toBeNull();
  });

  it("shows a count badge per tab matching the row counts passed in", () => {
    render(<AdminQueueTabs groups={EMPTY_GROUPS} published={PUBLISHED} adminUnpublished={ADMIN_UNPUBLISHED} venues={VENUES} />);
    expect(screen.getByRole("tab", { name: "Needs review 1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Venue blocked 1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Insufficient evidence 0" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Published 1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Unpublished by admin 1" })).toBeTruthy();
  });

  it("switches to the Venue blocked tab and shows only that group's rows", () => {
    render(<AdminQueueTabs groups={EMPTY_GROUPS} published={PUBLISHED} adminUnpublished={ADMIN_UNPUBLISHED} venues={VENUES} />);
    fireEvent.click(screen.getByRole("tab", { name: "Venue blocked 1" }));
    expect(screen.getByText("Venue Blocked Item")).toBeTruthy();
    expect(screen.queryByText("Needs Review Item")).toBeNull();
  });

  it("shows the canonical (current) title/venue for a published row, not a raw diagnostic dump", () => {
    render(<AdminQueueTabs groups={EMPTY_GROUPS} published={PUBLISHED} adminUnpublished={ADMIN_UNPUBLISHED} venues={VENUES} />);
    fireEvent.click(screen.getByRole("tab", { name: "Published 1" }));
    expect(screen.getByText("Published Item (canonical)")).toBeTruthy();
  });

  it(
    "Discovery two-genre support (2026-10-06): a Needs Review row can set/save a secondary genre — proves the shared " +
      "DiscoveryQueue editor, secondary genre included, is reachable from this tab, not just the default queue view",
    async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
      vi.stubGlobal("fetch", fetchMock);
      render(<AdminQueueTabs groups={EMPTY_GROUPS} published={PUBLISHED} adminUnpublished={ADMIN_UNPUBLISHED} venues={VENUES} />);
      // Needs review is the default tab — already showing "Needs Review Item".
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText(/Secondary genre/), { target: { value: "house" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse((options as { body: string }).body);
      expect(body.patch.predictedSecondaryGenre).toBe("house");
    },
  );

  it("Discovery two-genre support (2026-10-06): a Venue Blocked row's secondary genre field pre-fills from its existing value", () => {
    const groupsWithSecondary: AdminQueueGroups = {
      ...EMPTY_GROUPS,
      venue_blocked: [{ ...makeItem("dq-vb", "Venue Blocked Item"), predictedSecondaryGenre: "trance" }],
    };
    vi.stubGlobal("fetch", vi.fn());
    render(<AdminQueueTabs groups={groupsWithSecondary} published={PUBLISHED} adminUnpublished={ADMIN_UNPUBLISHED} venues={VENUES} />);
    fireEvent.click(screen.getByRole("tab", { name: "Venue blocked 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText(/Secondary genre/) as HTMLSelectElement).value).toBe("trance");
  });

  it("shows title, reason and venue for an admin-unpublished canonical event", () => {
    render(<AdminQueueTabs groups={EMPTY_GROUPS} published={PUBLISHED} adminUnpublished={ADMIN_UNPUBLISHED} venues={VENUES} />);
    fireEvent.click(screen.getByRole("tab", { name: "Unpublished by admin 1" }));
    expect(screen.getByText("Jasho Club // Poolen Outside")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.getByText(/· source: src-poolen/)).toBeTruthy();
  });

  it("shows an empty-state message rather than nothing when a tab has zero rows", () => {
    render(<AdminQueueTabs groups={EMPTY_GROUPS} published={PUBLISHED} adminUnpublished={ADMIN_UNPUBLISHED} venues={VENUES} />);
    fireEvent.click(screen.getByRole("tab", { name: "Insufficient evidence 0" }));
    expect(screen.getByText(/Queue is empty/)).toBeTruthy();
  });
});

describe("AdminQueueTabs — direct handoff from Analyze (unified event create/edit model, 2026-09-08, Section 5/10)", () => {
  it("opens directly on the tab named by the ?tab= query param, instead of always defaulting to Needs review", () => {
    setSearchParams(new URLSearchParams("tab=insufficient"));
    const groups: AdminQueueGroups = { ...EMPTY_GROUPS, insufficient: [makeItem("dq-1", "Insufficient Candidate")] };
    render(<AdminQueueTabs groups={groups} published={PUBLISHED} adminUnpublished={ADMIN_UNPUBLISHED} venues={VENUES} />);
    expect(screen.getByRole("tab", { name: /Insufficient evidence/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Insufficient Candidate")).toBeTruthy();
  });

  it("falls back to Needs review when ?tab= names something that isn't a real tab — never crashes or shows a blank view", () => {
    setSearchParams(new URLSearchParams("tab=not-a-real-tab"));
    render(<AdminQueueTabs groups={EMPTY_GROUPS} published={PUBLISHED} adminUnpublished={ADMIN_UNPUBLISHED} venues={VENUES} />);
    expect(screen.getByRole("tab", { name: /Needs review/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("with no ?tab= param at all, defaults to Needs review exactly as before", () => {
    render(<AdminQueueTabs groups={EMPTY_GROUPS} published={PUBLISHED} adminUnpublished={ADMIN_UNPUBLISHED} venues={VENUES} />);
    expect(screen.getByRole("tab", { name: /Needs review/ }).getAttribute("aria-selected")).toBe("true");
  });
});

function prioritized(id: string, title: string, overrides: Partial<ReviewPriority> = {}): PrioritizedReviewRow {
  return {
    item: makeItem(id, title),
    priority: {
      itemId: id,
      relevanceScore: 4,
      priority: 4,
      tier: "likely",
      relevanceState: "missing_genre_info",
      startsWithin72h: false,
      hoursToStart: 200,
      signals: [
        { key: "strong_venue", points: 3, label: "MODULE is a primarily electronic venue" },
        { key: "lineup", points: 1, label: "Lineup listed (2)" },
        { key: "venue_unresolved", points: 0, label: "No venue given" },
      ],
      seriesMatch: null,
      recommendedAction: "Check the source, then pick a genre and publish — or ignore",
      ...overrides,
    },
  };
}

describe("AdminQueueTabs — Likely relevant (review prioritisation)", () => {
  afterEach(cleanup);

  const MANY_LIKELY: ReviewPriorityList = {
    likely: [
      prioritized("dq-tanzen", "TANZEN UND SPRINGEN", { startsWithin72h: true }),
      ...Array.from({ length: 16 }, (_, i) => prioritized(`dq-l${i}`, `Likely ${i}`)),
    ],
    possible: [prioritized("dq-prodigy", "The Prodigy", { tier: "possible" })],
    urgentCount: 1,
    urgentLikelyCount: 1,
    urgentPossibleCount: 0,
  };

  // The real shape on 2026-10-17: 3 likely, 28 possible.
  const FEW_LIKELY: ReviewPriorityList = {
    likely: [
      prioritized("dq-afro", "Afrobeats Party", { startsWithin72h: true }),
      prioritized("dq-br1", "Boiler Room"),
      prioritized("dq-br2", "Boiler Room (Poolen)"),
    ],
    possible: Array.from({ length: 28 }, (_, i) =>
      prioritized(i === 13 ? "dq-prodigy" : `dq-p${i}`, i === 13 ? "The Prodigy" : `Possible ${i}`, {
        tier: "possible",
        startsWithin72h: i === 0,
        signals: [{ key: "source_category", points: 2, label: "KultuNaut lists it under Elektronisk / Club-DJ" }],
      }),
    ),
    urgentCount: 2,
    urgentLikelyCount: 1,
    urgentPossibleCount: 1,
  };

  // Ungrouped fixtures: every row is its own event.
  const asGroups = (list: ReviewPriorityList | GroupedReviewList): GroupedReviewList =>
    "primary" in (list.likely[0] ?? list.possible[0] ?? { primary: null })
      ? (list as GroupedReviewList)
      : {
          ...list,
          likely: (list as ReviewPriorityList).likely.map((primary) => ({ primary, others: [] })),
          possible: (list as ReviewPriorityList).possible.map((primary) => ({ primary, others: [] })),
        };

  function renderWith(list: ReviewPriorityList | GroupedReviewList, split?: PastStaleSplit<DiscoveryQueueItem>, notInSource?: NotInSourceReview) {
    render(
      <AdminQueueTabs
        groups={EMPTY_GROUPS}
        published={PUBLISHED}
        adminUnpublished={ADMIN_UNPUBLISHED}
        venues={VENUES}
        priorityList={asGroups(list)}
        pastStaleSplit={split}
        notInSource={notInSource}
      />,
    );
  }

  const tierOf = (el: HTMLElement) => el.getAttribute("data-tier");

  it("counts likely and possible rows on the tab", () => {
    renderWith(MANY_LIKELY);
    expect(screen.getByRole("tab", { name: "Likely relevant 18" })).toBeTruthy();
  });

  it("shows the series-memory reason on its own line, marked as ranking only", () => {
    const label =
      "Series “final descent”: 2 earlier published event(s) — “69/96: The Final Descent” (2026-10-24, Basement); support: same venue, this listing has its own electronic signal";
    renderWith({
      likely: [prioritized("dq-fd", "Final Descent: Amina Hocine (SE)", { signals: [{ key: "series_same_venue", points: 2, label }] })],
      possible: [],
      urgentCount: 0,
      urgentLikelyCount: 0,
      urgentPossibleCount: 0,
    });
    fireEvent.click(screen.getByRole("tab", { name: "Likely relevant 1" }));
    const line = screen.getByTestId("series-memory");
    expect(line.textContent).toContain("Series memory (+2, ranking only — never publishes or sets a genre)");
    expect(line.textContent).toContain("“69/96: The Final Descent” (2026-10-24, Basement)");
    expect(screen.getByTestId("priority-explanation").textContent).not.toMatch(/For: Series/);
  });

  it("shows both counts in the banner, and the 72-hour warning split by tier", () => {
    renderWith(FEW_LIKELY);
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("3 likely relevant");
    expect(banner.textContent).toContain("28 possible (source category only)");
    expect(banner.textContent).toContain("1 likely relevant and 1 possible events start within 72 hours");
    fireEvent.click(screen.getByRole("button", { name: "Review them" }));
    expect(screen.getByRole("tab", { name: "Likely relevant 31" }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the banner as a quiet status, not an alert, when nothing is urgent", () => {
    renderWith({ ...FEW_LIKELY, urgentCount: 0, urgentLikelyCount: 0, urgentPossibleCount: 0 });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("3 likely relevant");
  });

  it("shows no banner when there is nothing to review", () => {
    renderWith({ likely: [], possible: [], urgentCount: 0, urgentLikelyCount: 0, urgentPossibleCount: 0 });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows every likely event in full, however many there are, and every possible event at least as a compact row", () => {
    renderWith(MANY_LIKELY);
    fireEvent.click(screen.getByRole("tab", { name: "Likely relevant 18" }));
    const likelySection = screen.getByRole("region", { name: "Likely relevant" });
    const likelyBoxes = within(likelySection).getAllByTestId("priority-explanation");
    expect(likelyBoxes).toHaveLength(17);
    expect(likelyBoxes.every((el) => tierOf(el) === "likely")).toBe(true);
    expect(screen.getAllByText(/For: MODULE is a primarily electronic venue · Lineup listed \(2\)/).length).toBeGreaterThan(0);
    // The Prodigy is in plain sight as a compact row, no "show all" needed.
    const possibleSection = screen.getByRole("region", { name: "Possible — source category only" });
    expect(within(possibleSection).getByText("The Prodigy")).toBeTruthy();
    expect(within(possibleSection).queryByTestId("priority-explanation")).toBeNull();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("shows urgent possible events in full and the rest as compact rows by start, each exactly once", () => {
    renderWith(FEW_LIKELY);
    fireEvent.click(screen.getByRole("tab", { name: "Likely relevant 31" }));
    const likelySection = screen.getByRole("region", { name: "Likely relevant" });
    expect(within(likelySection).getAllByTestId("priority-explanation")).toHaveLength(3);
    expect(within(likelySection).queryByText("Possible · source category only")).toBeNull();

    const possibleSection = screen.getByRole("region", { name: "Possible — source category only" });
    expect(within(possibleSection).getByText(/check the artist first/)).toBeTruthy();
    const urgent = within(possibleSection).getByRole("group", { name: "Possible — starts within 72 hours" });
    expect(within(urgent).getAllByTestId("priority-explanation")).toHaveLength(1);
    expect(within(urgent).getByText("Possible · source category only")).toBeTruthy();
    const rows = within(possibleSection).getAllByTestId("compact-possible-row");
    expect(rows).toHaveLength(27);
    // 28 possible events, each in exactly one place.
    for (let i = 0; i < 28; i++) {
      const title = i === 13 ? "The Prodigy" : `Possible ${i}`;
      expect(within(possibleSection).getAllByText(title), title).toHaveLength(1);
    }
  });

  it("opens a compact row in place with the full reasons and the usual actions, and closes it again", () => {
    renderWith(FEW_LIKELY);
    fireEvent.click(screen.getByRole("tab", { name: "Likely relevant 31" }));
    const prodigyRow = screen.getAllByTestId("compact-possible-row").find((row) => row.textContent?.includes("The Prodigy"))!;
    const toggle = within(prodigyRow).getByRole("button", { name: /The Prodigy/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const explanation = within(prodigyRow).getByTestId("priority-explanation");
    expect(tierOf(explanation)).toBe("possible");
    expect(within(prodigyRow).getByText(/Recommended:/)).toBeTruthy();
    expect(prodigyRow.querySelector("#dq-dq-prodigy")).toBeTruthy();
    expect(screen.getAllByTestId("compact-possible-row")).toHaveLength(27);
    fireEvent.click(toggle);
    expect(within(prodigyRow).queryByTestId("priority-explanation")).toBeNull();
  });

  it("shows the same event from two sources as one entry naming both sources, with each listing's own actions one click away", () => {
    const kultunaut = prioritized("dq-br-kn", "Boiler Room");
    kultunaut.item.sourceName = "KultuNaut";
    const poolen = prioritized("dq-br-poolen", "Boiler Room");
    poolen.item.sourceName = "Poolen";
    const grouped: GroupedReviewList = {
      likely: [{ primary: kultunaut, others: [poolen] }, ...Array.from({ length: 14 }, (_, i) => ({ primary: prioritized(`dq-g${i}`, `Night ${i}`), others: [] }))],
      possible: [{ primary: prioritized("dq-prodigy", "The Prodigy", { tier: "possible" }), others: [] }],
      urgentCount: 0,
      urgentLikelyCount: 0,
      urgentPossibleCount: 0,
    };
    renderWith(grouped);
    // 15 likely events in 16 rows: the group takes one place.
    expect(screen.getByRole("tab", { name: "Likely relevant 16" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Likely relevant 16" }));
    const likelySection = screen.getByRole("region", { name: "Likely relevant" });
    expect(within(likelySection).getAllByTestId("priority-explanation")).toHaveLength(15);
    expect(within(likelySection).getAllByText("Boiler Room")).toHaveLength(1);
    expect(within(likelySection).getByTestId("group-sources").textContent).toContain("Same event from 2 sources: KultuNaut · Poolen");

    fireEvent.click(screen.getByRole("button", { name: "Show the other listing" }));
    expect(within(likelySection).getAllByText("Boiler Room")).toHaveLength(2);
    expect(document.getElementById("dq-dq-br-poolen")).toBeTruthy();
    expect(document.getElementById("dq-dq-br-kn")).toBeTruthy();
  });

  it("ranks the upcoming rows the source dropped, collapses the rest and the expired rows, and never calls them cancelled", () => {
    const moved = prioritized("dq-twilight", "Twilight Rave");
    const split: PastStaleSplit<DiscoveryQueueItem> = {
      upcomingNotInSource: [moved.item, makeItem("dq-yoga", "Klangbad")],
      expired: [makeItem("dq-old", "Old Party")],
    };
    const notInSource: NotInSourceReview = {
      prioritized: { likely: [moved], possible: [], urgentCount: 0, urgentLikelyCount: 0, urgentPossibleCount: 0 },
      others: [makeItem("dq-yoga", "Klangbad")],
    };
    renderWith(FEW_LIKELY, split, notInSource);
    fireEvent.click(screen.getByRole("tab", { name: /Past \/ stale/ }));
    expect(screen.getByText("Upcoming, no longer listed by the source (2)")).toBeTruthy();
    expect(screen.getByText(/Nothing here has been marked cancelled or moved/)).toBeTruthy();
    expect(screen.getByText("Twilight Rave")).toBeTruthy();
    expect(screen.queryByText("Klangbad")).toBeNull();
    expect(screen.queryByText("Old Party")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the rest (1)" }));
    expect(screen.getByText("Klangbad")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show expired (1)" }));
    expect(screen.getByText("Old Party")).toBeTruthy();
  });

  it("still splits Past / stale without a ranking", () => {
    const split: PastStaleSplit<DiscoveryQueueItem> = {
      upcomingNotInSource: [makeItem("dq-moved", "Fluid Sound Festival, day 1")],
      expired: [makeItem("dq-old", "Old Party")],
    };
    renderWith(FEW_LIKELY, split);
    fireEvent.click(screen.getByRole("tab", { name: /Past \/ stale/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show all (1)" }));
    expect(screen.getByText("Fluid Sound Festival, day 1")).toBeTruthy();
    expect(screen.queryByText("Old Party")).toBeNull();
  });
});
