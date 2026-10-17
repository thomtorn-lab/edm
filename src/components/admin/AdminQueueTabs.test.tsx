// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AdminQueueTabs from "./AdminQueueTabs";
import type { AdminQueueGroups, AdminUnpublishedRow, PublishedQueueRow } from "@/lib/adminQueue";
import type { DiscoveryQueueItem, Venue } from "@/lib/types";
import type { PastStaleSplit, PrioritizedReviewRow, ReviewPriority, ReviewPriorityList } from "@/lib/reviewPriority";

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
      recommendedAction: "Check the source, then pick a genre and publish — or ignore",
      ...overrides,
    },
  };
}

describe("AdminQueueTabs — Likely relevant (review prioritisation)", () => {
  afterEach(cleanup);

  const LIST: ReviewPriorityList = {
    likely: [
      prioritized("dq-tanzen", "TANZEN UND SPRINGEN", { startsWithin72h: true }),
      ...Array.from({ length: 16 }, (_, i) => prioritized(`dq-l${i}`, `Likely ${i}`)),
    ],
    possible: [prioritized("dq-prodigy", "The Prodigy", { tier: "possible" })],
    urgentCount: 1,
  };

  function renderWith(list: ReviewPriorityList, split?: PastStaleSplit<DiscoveryQueueItem>) {
    render(
      <AdminQueueTabs
        groups={EMPTY_GROUPS}
        published={PUBLISHED}
        adminUnpublished={ADMIN_UNPUBLISHED}
        venues={VENUES}
        priorityList={list}
        pastStaleSplit={split}
      />,
    );
  }

  it("counts likely and possible rows on the tab", () => {
    renderWith(LIST);
    expect(screen.getByRole("tab", { name: "Likely relevant 18" })).toBeTruthy();
  });

  it("shows the 72-hour warning and opens the tab from it", () => {
    renderWith(LIST);
    expect(screen.getByRole("alert").textContent).toContain("1 likely relevant event starts within 72 hours");
    fireEvent.click(screen.getByRole("button", { name: "Review them" }));
    expect(screen.getByRole("tab", { name: "Likely relevant 18" }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows no warning when nothing is urgent", () => {
    renderWith({ ...LIST, urgentCount: 0 });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the top 15 with their reasons and recommended action, and all rows on request", () => {
    renderWith(LIST);
    fireEvent.click(screen.getByRole("tab", { name: "Likely relevant 18" }));
    expect(screen.getAllByTestId("priority-explanation")).toHaveLength(15);
    expect(screen.getByText("TANZEN UND SPRINGEN")).toBeTruthy();
    expect(screen.queryByText("Likely 15")).toBeNull();
    expect(screen.getAllByText(/For: MODULE is a primarily electronic venue · Lineup listed \(2\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Recommended: Check the source/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Show all 17" }));
    expect(screen.getByText("Likely 15")).toBeTruthy();
    expect(screen.getAllByTestId("priority-explanation")).toHaveLength(17);
  });

  it("keeps source-category-only rows in a separate section that opens on request", () => {
    renderWith(LIST);
    fireEvent.click(screen.getByRole("tab", { name: "Likely relevant 18" }));
    expect(screen.queryByText("The Prodigy")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /possibly relevant — source category only \(1\)/ }));
    expect(screen.getByText("The Prodigy")).toBeTruthy();
  });

  it("splits Past / stale into upcoming rows the source dropped and collapsed expired rows", () => {
    const split: PastStaleSplit<DiscoveryQueueItem> = {
      upcomingNotInSource: [makeItem("dq-moved", "Fluid Sound Festival, day 1")],
      expired: [makeItem("dq-old", "Old Party")],
    };
    renderWith(LIST, split);
    fireEvent.click(screen.getByRole("tab", { name: /Past \/ stale/ }));
    expect(screen.getByText("Fluid Sound Festival, day 1")).toBeTruthy();
    expect(screen.queryByText("Old Party")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show expired (1)" }));
    expect(screen.getByText("Old Party")).toBeTruthy();
  });
});
