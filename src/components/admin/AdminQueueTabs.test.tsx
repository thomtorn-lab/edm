// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AdminQueueTabs from "./AdminQueueTabs";
import type { AdminQueueGroups, AdminUnpublishedRow, PublishedQueueRow } from "@/lib/adminQueue";
import type { DiscoveryQueueItem, Venue } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeItem(id: string, title: string): DiscoveryQueueItem {
  return {
    id,
    probableTitle: title,
    probableStart: "2026-09-20T20:00:00.000Z",
    probableEnd: null,
    probableTicketUrl: null,
    probableOfficialEventUrl: null,
    probableFree: false,
    probableVenueName: "Culture Box",
    probableSubVenue: null,
    sourceName: "src-test",
    sourceUrl: "https://example.com/1",
    sourceId: "src-test",
    detectedLineup: [],
    predictedGenre: "techno",
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
