// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DiscoveryQueue from "./DiscoveryQueue";
import type { DiscoveryQueueItem, Venue } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PUMPEHUSET: Venue = {
  id: "v-pumpehuset",
  slug: "pumpehuset",
  name: "Pumpehuset",
  aliases: ["Pumpehuset Copenhagen", "The Pumpehuset"],
  address: "Studiestræde 52, 1554 København V",
  city: "Copenhagen",
  postalCode: "1554",
  websiteUrl: null,
  description: "",
  shortDescription: null,
  venueProfile: null,
};

const CULTURE_BOX: Venue = {
  id: "v-culture-box",
  slug: "culture-box",
  name: "Culture Box",
  aliases: ["Culturebox"],
  address: "Kronprinsessegade 54A, 1306 København K",
  city: "Copenhagen",
  postalCode: "1306",
  websiteUrl: null,
  description: "",
  shortDescription: null,
  venueProfile: null,
};

const VENUES = [PUMPEHUSET, CULTURE_BOX];

function makeItem(overrides: Partial<DiscoveryQueueItem> = {}): DiscoveryQueueItem {
  return {
    id: "dq-1",
    probableTitle: "Unknown Venue Night",
    probableStart: "2026-09-20T20:00:00.000Z",
    probableVenueName: "Suporama",
    sourceName: "src-ra-copenhagen",
    sourceUrl: "https://ra.co/events/1",
    sourceId: null,
    detectedLineup: ["DJ X"],
    predictedGenre: "techno",
    genreConfidence: "medium",
    suspectedDuplicateOfEventId: null,
    missingFields: ["venue (unresolved against registry)"],
    overallConfidence: "medium",
    status: "pending",
    ...overrides,
  };
}

function openCreatePanel() {
  fireEvent.click(screen.getByRole("button", { name: "+ Create new venue" }));
}

describe("DiscoveryQueue — admin venue creation (held item, unknown venue)", () => {
  afterEach(cleanup);

  it("creates a genuinely new venue and selects it for publication without a page reload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        created: true,
        venue: { ...PUMPEHUSET, id: "v-suporama", slug: "suporama", name: "Suporama", aliases: [] },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscoveryQueue items={[makeItem()]} venues={VENUES} />);
    openCreatePanel();

    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "Nørrebrogade 1" } });
    fireEvent.change(screen.getByLabelText("Postal code"), { target: { value: "2200" } });
    fireEvent.click(screen.getByRole("button", { name: "Create venue" }));

    await screen.findByRole("option", { name: "Suporama" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/venues",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Suporama",
          address: "Nørrebrogade 1",
          city: "Copenhagen",
          postalCode: "2200",
          websiteUrl: undefined,
          confirmed: false,
        }),
      }),
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("v-suporama");
    // The create panel closes and no full-page navigation/reload occurred —
    // only the local venue list and selection changed.
    expect(screen.queryByRole("button", { name: "Create venue" })).toBeNull();
  });

  it("shows a live hint and blocks creation when the typed name exactly matches an existing venue", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<DiscoveryQueue items={[makeItem({ probableVenueName: "culture box" })]} venues={VENUES} />);
    openCreatePanel();

    expect(screen.getByText(/Matches existing venue.*Culture Box/)).toBeTruthy();
    const createButton = screen.getByRole("button", { name: "Create venue" }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
  });

  it("shows a live hint when the typed name matches an existing alias", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<DiscoveryQueue items={[makeItem({ probableVenueName: null })]} venues={VENUES} />);
    openCreatePanel();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Culturebox" } });
    expect(screen.getByText(/Matches existing venue.*Culture Box/)).toBeTruthy();
  });
});

describe("DiscoveryQueue — Byhaven / Culture Box room safety (no accidental standalone venue)", () => {
  afterEach(cleanup);

  it("requires explicit confirmation before creating a standalone 'Byhaven' venue", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: "Byhaven is part of Pumpehuset, not a standalone venue.", needsConfirmation: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, created: true, venue: { ...PUMPEHUSET, id: "v-byhaven-2", slug: "byhaven-2", name: "Byhaven" } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscoveryQueue items={[makeItem({ probableVenueName: "Byhaven" })]} venues={VENUES} />);
    openCreatePanel();
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "Some other address" } });
    fireEvent.change(screen.getByLabelText("Postal code"), { target: { value: "2200" } });

    // Live warning shown before any submission.
    expect(screen.getByText(/sub-area\/room of an existing venue/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create venue" }));
    await screen.findByText(/Byhaven is part of Pumpehuset/);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/admin/venues",
      expect.objectContaining({ body: expect.stringContaining('"confirmed":false') }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Yes, this is a genuinely different venue/ }));
    await screen.findByRole("option", { name: "Byhaven" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/venues",
      expect.objectContaining({ body: expect.stringContaining('"confirmed":true') }),
    );
  });

  it("requires explicit confirmation before creating a standalone 'Black Box' or 'Red Box' venue", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<DiscoveryQueue items={[makeItem({ probableVenueName: null })]} venues={VENUES} />);
    openCreatePanel();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Black Box" } });
    expect(screen.getByText(/sub-area\/room of an existing venue/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Red Box" } });
    expect(screen.getByText(/sub-area\/room of an existing venue/)).toBeTruthy();
  });
});

describe("DiscoveryQueue — failure handling", () => {
  afterEach(cleanup);

  it("shows a clear error and keeps the form open when venue creation fails outright", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Postal code is required." }) }),
    );
    render(<DiscoveryQueue items={[makeItem()]} venues={VENUES} />);
    openCreatePanel();
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "Somewhere" } });
    fireEvent.change(screen.getByLabelText("Postal code"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create venue" }));

    const alert = await screen.findByText("Postal code is required.");
    expect(alert).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create venue" })).toBeTruthy();
  });

  it("surfaces a network error without losing the entered form data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    render(<DiscoveryQueue items={[makeItem()]} venues={VENUES} />);
    openCreatePanel();
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "Somewhere" } });
    fireEvent.change(screen.getByLabelText("Postal code"), { target: { value: "2200" } });
    fireEvent.click(screen.getByRole("button", { name: "Create venue" }));

    await screen.findByText("Network error.");
    expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe("Somewhere");
  });
});

describe("DiscoveryQueue — normal existing-venue publication unchanged", () => {
  afterEach(cleanup);

  it("still resolves and publishes against an existing venue without touching the create-venue flow", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, eventId: "e-1" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscoveryQueue items={[makeItem({ probableVenueName: "Culture Box" })]} venues={VENUES} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("v-culture-box");

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/discovery/dq-1/publish", expect.objectContaining({ method: "POST" })));
  });
});
