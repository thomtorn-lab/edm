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
    probableEnd: null,
    probableTicketUrl: null,
    probableFree: false,
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

describe("DiscoveryQueue — post-save button state (admin/manual-event work package, 2026-08-24)", () => {
  afterEach(cleanup);

  it("re-enables Edit/Publish/Ignore after a successful action, without a page reload (regression: busy never reset on the success path)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    render(<DiscoveryQueue items={[makeItem({ probableVenueName: "Culture Box" })]} venues={VENUES} />);

    const ignoreButton = screen.getByRole("button", { name: "Ignore" }) as HTMLButtonElement;
    fireEvent.click(ignoreButton);
    await vi.waitFor(() => expect(ignoreButton.disabled).toBe(false));

    const editButton = screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement;
    expect(editButton.disabled).toBe(false);
    fireEvent.click(editButton); // proves it's genuinely clickable, not just non-disabled in the DOM
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("also re-enables buttons after a failed action (already worked before this fix, still holds)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "nope" }) }));
    render(<DiscoveryQueue items={[makeItem({ probableVenueName: "Culture Box" })]} venues={VENUES} />);

    const ignoreButton = screen.getByRole("button", { name: "Ignore" }) as HTMLButtonElement;
    fireEvent.click(ignoreButton);
    await screen.findByText("nope");
    expect(ignoreButton.disabled).toBe(false);
  });
});

describe("DiscoveryQueue — typed date entry (admin/manual-event work package, 2026-08-24 — the real Kaj manual-add bug)", () => {
  afterEach(cleanup);

  it("does not silently save while leaving the date missing when the date input ends up empty after being touched (an incomplete typed entry, real browser behavior)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<DiscoveryQueue items={[makeItem({ probableStart: null, probableVenueName: "Culture Box", missingFields: ["date"] })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dateInput = screen.getByLabelText("Date & time");
    // A native datetime-local input reports value="" for any incomplete
    // typed entry — simulate a real interaction (a value change, so the
    // touched flag genuinely flips) landing back on an incomplete value.
    fireEvent.change(dateInput, { target: { value: "2026-09-20T20:00" } });
    fireEvent.change(dateInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/isn't a complete, valid date/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    // The edit form must stay open so the admin can fix it, not silently close.
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("saves normally when a complete date is entered via the picker (unaffected by the new validation)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<DiscoveryQueue items={[makeItem({ probableStart: null, probableVenueName: "Culture Box", missingFields: ["date"] })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Date & time"), { target: { value: "2026-09-20T20:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/discovery/dq-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"probableStart"'),
        }),
      ),
    );
  });

  it("does not block saving other fields when the date was never touched at all (still genuinely unset, not a failed attempt)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<DiscoveryQueue items={[makeItem({ probableStart: null, probableVenueName: "Culture Box", missingFields: ["date"] })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});

describe("DiscoveryQueue — End time / Ticket URL / FREE fields in the real pre-publish editor (correction item 1, 2026-08-24)", () => {
  afterEach(cleanup);

  it("lets an admin add an end time, ticket URL, and mark an event free on a candidate that had none of these — before it is ever published — and sends all three in the PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<DiscoveryQueue items={[makeItem({ probableVenueName: "Culture Box" })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(/End time/), { target: { value: "2026-09-21T02:00" } });
    fireEvent.change(screen.getByLabelText(/Ticket URL/), { target: { value: "https://tickets.example.com/kaj" } });
    fireEvent.click(screen.getByLabelText(/Free entry/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/discovery/dq-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"probableTicketUrl":"https://tickets.example.com/kaj"'),
        }),
      ),
    );
    const [, options] = fetchMock.mock.calls[0];
    const { patch } = JSON.parse((options as { body: string }).body);
    expect(patch.probableEnd).toBe(new Date("2026-09-21T02:00").toISOString());
    expect(patch.probableTicketUrl).toBe("https://tickets.example.com/kaj");
    expect(patch.probableFree).toBe(true);
  });

  it("pre-fills End time, Ticket URL, and FREE from the candidate's existing values when opening the editor (e.g. already extracted by the admin 'Add event from URL' tool for 'Kaj - Din ven i solen')", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(
      <DiscoveryQueue
        items={[
          makeItem({
            probableVenueName: "Culture Box",
            probableEnd: "2026-09-21T02:00:00.000Z",
            probableTicketUrl: "https://tickets.example.com/kaj",
            probableFree: true,
          }),
        ]}
        venues={VENUES}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText(/Ticket URL/) as HTMLInputElement).value).toBe("https://tickets.example.com/kaj");
    expect((screen.getByLabelText(/Free entry/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/End time/) as HTMLInputElement).value).toBe("2026-09-21T02:00");
  });

  it("leaves end time out of the patch (never sends a corrupted value) when it was never touched and the candidate never had one", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<DiscoveryQueue items={[makeItem({ probableVenueName: "Culture Box" })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(/Ticket URL/), { target: { value: "https://tickets.example.com/kaj" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, options] = fetchMock.mock.calls[0];
    const { patch } = JSON.parse((options as { body: string }).body);
    expect(patch).not.toHaveProperty("probableEnd");
  });
});
