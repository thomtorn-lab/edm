// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EventManager from "./EventManager";
import type { EventWithVenue } from "@/lib/queries";
import type { Venue } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CULTURE_BOX: Venue = {
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
};

const VENUES = [CULTURE_BOX];

function makeEvent(overrides: Partial<EventWithVenue> = {}): EventWithVenue {
  return {
    id: "e-1",
    title: "Kaj - Din ven i solen",
    slug: "kaj-din-ven-i-solen-e-1",
    description: null,
    artists: ["Kaj"],
    startDatetime: "2026-09-20T20:00:00.000Z",
    endDatetime: null,
    timezone: "Europe/Copenhagen",
    venueId: "v-culture-box",
    primaryGenre: "techno",
    subgenres: ["techno"],
    genreConfidence: "high",
    officialEventUrl: null,
    ticketUrl: null,
    facebookUrl: null,
    residentAdvisorUrl: null,
    otherSourceUrls: [],
    imageUrl: null,
    priceFrom: null,
    currency: null,
    soldOut: false,
    cancelled: false,
    dateChanged: false,
    timeChanged: false,
    published: true,
    manualOverride: false,
    overriddenFields: [],
    confidence: "high",
    canonicalSourceId: null,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    lastSourceCheck: null,
    lastChanged: null,
    venue: CULTURE_BOX,
    ...overrides,
  };
}

describe("EventManager — post-save button state (admin/manual-event work package, 2026-08-24)", () => {
  afterEach(cleanup);

  it("re-enables Edit/Hide after a successful save, without a page reload (regression: busy never reset on the success path)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent()]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Kaj - Din ven i solen (corrected)" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const editButton = await screen.findByRole("button", { name: "Edit" });
    expect((editButton as HTMLButtonElement).disabled).toBe(false);
    // Genuinely clickable again, not just non-disabled in the DOM.
    fireEvent.click(editButton);
    expect(screen.getByRole("button", { name: /Save/ })).toBeTruthy();
  });

  it("re-enables Hide/Unhide after use, and it works a second time in the same session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent()]} venues={VENUES} />);

    const hideButton = screen.getByRole("button", { name: "Hide" }) as HTMLButtonElement;
    fireEvent.click(hideButton);
    await vi.waitFor(() => expect(hideButton.disabled).toBe(false));
    fireEvent.click(hideButton); // second use — would be permanently disabled before this fix
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe("EventManager — end time (admin/manual-event work package, 2026-08-24)", () => {
  afterEach(cleanup);

  it("persists a newly-set end time through the existing admin edit PATCH, supporting an overnight end (later calendar date)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ startDatetime: "2026-09-20T22:00:00.000Z" })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(/End time/), { target: { value: "2026-09-21T06:00" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/events/e-1",
        expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"endDatetime"') }),
      ),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.endDatetime).toBe(new Date("2026-09-21T06:00").toISOString());
  });

  it("never invents an end time when the field is left untouched", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent()]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Kaj - Din ven i solen (v2)" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch).not.toHaveProperty("endDatetime");
  });

  it("blocks save with a clear error when a touched end time ends up incomplete/invalid, mirroring the discovery-queue date fix", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ endDatetime: "2026-09-21T04:00:00.000Z" })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const endInput = screen.getByLabelText(/End time/);
    fireEvent.change(endInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(await screen.findByText(/isn't a complete, valid date/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("EventManager — FREE (admin/manual-event work package, 2026-08-24)", () => {
  afterEach(cleanup);

  it("sets the existing canonical priceFrom=0 representation when Free is checked, using the existing public FREE convention", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ priceFrom: null })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.priceFrom).toBe(0);
  });

  it("never infers FREE merely because ticketUrl is absent — unchecked and no prior free flag means no priceFrom patch at all", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ ticketUrl: null, priceFrom: null })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Kaj - Din ven i solen (v3)" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch).not.toHaveProperty("priceFrom");
  });

  it("preserves an existing real price when Free is left unchecked (never invents a new price architecture)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ priceFrom: 150, currency: "DKK" })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Kaj - Din ven i solen (v4)" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch).not.toHaveProperty("priceFrom");
  });

  it("clears priceFrom back to null (not a new default) when Free is unchecked after previously being free", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ priceFrom: 0 })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("checkbox")); // was checked (priceFrom 0), now unchecking
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.priceFrom).toBeNull();
  });

  it("Ticket URL still works and can coexist with Free in the data model (Tickets link takes rendering precedence — see src/lib/links.ts's showFreeCta)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ ticketUrl: null, priceFrom: null })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Ticket URL"), { target: { value: "https://billet.example.com/e/1" } });
    fireEvent.click(screen.getByRole("checkbox")); // also mark Free — both fields set at once
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.ticketUrl).toBe("https://billet.example.com/e/1");
    expect(body.patch.priceFrom).toBe(0);
  });
});
