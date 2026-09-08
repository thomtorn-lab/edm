// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AddEventFromUrl from "./AddEventFromUrl";

/**
 * Unified event create/edit model, 2026-09-08. Covers the specific gaps the
 * audit found in the old read-only version: Analyze's result exposed no
 * inputs at all (Section 4), and a saved Discovery Queue candidate had no
 * direct handoff back to the exact row it landed on (Section 5).
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function discoveryExtractResponse(overrides: Record<string, unknown> = {}) {
  return {
    raw: {
      sourceId: "admin-paste",
      sourceUrl: "https://venue.example.com/event/123",
      title: "Test Night",
      description: "A night of raw techno.",
      artists: [],
      startDatetime: null,
      endDatetime: null,
      venueName: null,
      officialEventUrl: "https://venue.example.com/event/123",
      ticketUrl: null,
      facebookUrl: null,
      residentAdvisorUrl: null,
      imageUrl: null,
      priceFrom: null,
      genreHint: null,
      genreConfidenceHint: null,
    },
    result: {
      normalizedArtists: [],
      genre: null,
      genreConfidence: "low",
      decision: "review_queue",
      holdReason: null,
      resolvedVenueId: null,
      resolvedSubVenue: null,
      duplicateOfEventId: null,
      duplicateConfidence: "none",
      missingFields: ["date (not found in page metadata)", "venue (unresolved against registry)"],
    },
    persisted: { kind: "discovery", id: "dq-abc12345" },
    category: "insufficient",
    duplicateDiscoveryQueueId: null,
    ...overrides,
  };
}

async function analyze(fetchMock: ReturnType<typeof vi.fn>) {
  render(<AddEventFromUrl />);
  fireEvent.change(screen.getByPlaceholderText(/Paste a venue/), { target: { value: "https://venue.example.com/event/123" } });
  fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await screen.findByLabelText("Title");
}

describe("AddEventFromUrl — Analyze result is editable (Section 4: 'the admin must be able to correct or complete the relevant event fields before proceeding')", () => {
  it("pre-fills every core field the shared editor exposes from what Analyze found", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => discoveryExtractResponse() });
    vi.stubGlobal("fetch", fetchMock);
    await analyze(fetchMock);

    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Test Night");
    expect((screen.getByLabelText(/Description/) as HTMLTextAreaElement).value).toBe("A night of raw techno.");
    expect((screen.getByLabelText(/Official event URL/) as HTMLInputElement).value).toBe("https://venue.example.com/event/123");
  });

  it("lets the admin fill in the missing date and venue Analyze itself flagged, and saves them via the existing Discovery Queue PATCH endpoint", async () => {
    const extractMock = vi.fn().mockResolvedValue({ ok: true, json: async () => discoveryExtractResponse() });
    vi.stubGlobal("fetch", extractMock);
    await analyze(extractMock);

    const saveMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", saveMock);
    fireEvent.change(screen.getByLabelText(/Date &amp; time|Date & time/), { target: { value: "2026-10-05T21:00" } });
    fireEvent.change(screen.getByLabelText(/Venue name/), { target: { value: "VEGA" } });
    fireEvent.click(screen.getByRole("button", { name: "Save corrections" }));

    await vi.waitFor(() => expect(saveMock).toHaveBeenCalled());
    const [path, options] = saveMock.mock.calls[0];
    expect(path).toBe("/api/admin/discovery/dq-abc12345");
    const { patch } = JSON.parse((options as { body: string }).body);
    expect(patch.probableStart).toBe(new Date("2026-10-05T21:00").toISOString());
    expect(patch.probableVenueName).toBe("VEGA");
  });

  it("rejects a non-http(s) Official Event URL client-side before saving, same rule as Discovery Queue/Published edit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => discoveryExtractResponse() });
    vi.stubGlobal("fetch", fetchMock);
    await analyze(fetchMock);

    fireEvent.change(screen.getByLabelText(/Official event URL/), { target: { value: "not a url" } });
    fireEvent.click(screen.getByRole("button", { name: "Save corrections" }));

    expect(await screen.findByText(/Official event URL isn't a valid/)).toBeTruthy();
  });
});

describe("AddEventFromUrl — direct handoff to the exact created row (Section 5)", () => {
  it("shows which bucket the row was saved to and a direct link to that exact row, not just 'Discovery Queue'", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => discoveryExtractResponse({ category: "insufficient" }) });
    vi.stubGlobal("fetch", fetchMock);
    await analyze(fetchMock);

    expect(screen.getByText("Insufficient evidence")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Open in Insufficient evidence/ }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/admin?tab=insufficient#dq-dq-abc12345");
  });

  it("shows a duplicate-Discovery-Queue-candidate warning with a direct link, without auto-merging", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => discoveryExtractResponse({ duplicateDiscoveryQueueId: "dq-existing99" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await analyze(fetchMock);

    expect(screen.getByText(/already be a pending Discovery Queue candidate/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "dq-existing99" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/admin#dq-dq-existing99");
  });

  it("omits the duplicate warning when no pending DQ candidate matches", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => discoveryExtractResponse({ duplicateDiscoveryQueueId: null }) });
    vi.stubGlobal("fetch", fetchMock);
    await analyze(fetchMock);

    expect(screen.queryByText(/already be a pending Discovery Queue candidate/)).toBeNull();
  });
});
