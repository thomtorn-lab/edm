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
    subVenue: null,
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
    postponed: false,
    dateChanged: false,
    timeChanged: false,
    published: true,
    adminUnpublishReason: null,
    adminUnpublishNote: null,
    adminUnpublishedAt: null,
    sourceCancelledAt: null,
    sourceCancelledBySourceId: null,
    sourceCancellationEvidence: null,
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

  it("re-enables Unpublish/confirm after use, and it works a second time in the same session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent()]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    const confirmButton = screen.getByRole("button", { name: "Confirm unpublish" }) as HTMLButtonElement;
    fireEvent.click(confirmButton);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Confirmation panel closes and the Unpublish button reappears once the
    // request settles — proves busy/confirmingUnpublish were both reset.
    const reopenButton = await screen.findByRole("button", { name: "Unpublish" });

    // Re-open the confirmation panel and confirm a second time — would be
    // permanently disabled/stuck before this fix.
    fireEvent.click(reopenButton);
    fireEvent.click(screen.getByRole("button", { name: "Confirm unpublish" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe("EventManager — admin unpublish + Publish Again (admin unpublish/cancellation safety, 2026-09-06)", () => {
  afterEach(cleanup);

  it("clicking Unpublish opens a reason-selection confirmation before anything is sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent()]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    expect(screen.getByRole("combobox", { name: "Reason" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Cancel dismisses the confirmation without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent()]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("combobox", { name: "Reason" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Confirm unpublish posts the selected reason (and null note by default) to /unpublish", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent()]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Reason" }), { target: { value: "cancelled" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm unpublish" }));

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/events/e-1/unpublish",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "cancelled", note: null }) }),
      ),
    );
  });

  it("Confirm unpublish trims and posts an optional note", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent()]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Reason" }), { target: { value: "cancelled" } });
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "  promoter confirmed by email  " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm unpublish" }));

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/events/e-1/unpublish",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ reason: "cancelled", note: "promoter confirmed by email" }),
        }),
      ),
    );
  });

  it("shows UNPUBLISHED BY ADMIN with the reason for an admin-unpublished event, and offers Publish again instead of Unpublish", () => {
    render(
      <EventManager
        events={[makeEvent({ published: false, adminUnpublishReason: "cancelled", adminUnpublishedAt: "2026-09-06T00:00:00.000Z" })]}
        venues={VENUES}
      />,
    );

    expect(screen.getByText(/Unpublished by admin.*cancelled/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unpublish" })).toBeNull();
  });

  it("Publish again clears the admin override via /publish", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <EventManager
        events={[makeEvent({ published: false, adminUnpublishReason: "cancelled", adminUnpublishedAt: "2026-09-06T00:00:00.000Z" })]}
        venues={VENUES}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish again" }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/events/e-1/publish", expect.objectContaining({ method: "POST" })),
    );
  });

  it("an ordinary (non-admin) unpublished event still shows [hidden] and offers Publish again, with no admin-unpublished label", () => {
    render(<EventManager events={[makeEvent({ published: false })]} venues={VENUES} />);

    expect(screen.getByText("[hidden]")).toBeTruthy();
    expect(screen.queryByText(/Unpublished by admin/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Publish again" })).toBeTruthy();
  });
});

describe("EventManager — source-driven cancellation (2026-09-07)", () => {
  afterEach(cleanup);

  it("shows a 'Cancelled by source' label with evidence and timestamp, and offers 'Override & publish' instead of 'Publish again'", () => {
    render(
      <EventManager
        events={[
          makeEvent({
            published: false,
            sourceCancelledAt: "2026-09-06T09:00:00.000Z",
            sourceCancelledBySourceId: "src-poolen",
            sourceCancellationEvidence: 'Poolen status badge "Aflyst"',
          }),
        ]}
        venues={VENUES}
      />,
    );

    expect(screen.getByText(/Cancelled by source.*Aflyst/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Override & publish" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publish again" })).toBeNull();
  });

  it("Override & publish calls the dedicated override-cancellation route, not /publish", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <EventManager
        events={[
          makeEvent({
            published: false,
            sourceCancelledAt: "2026-09-06T09:00:00.000Z",
            sourceCancelledBySourceId: "src-poolen",
            sourceCancellationEvidence: "aflyst",
          }),
        ]}
        venues={VENUES}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Override & publish" }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/events/e-1/override-cancellation",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("admin-unpublished always takes precedence over a stale source-cancellation trace — shows the admin panel and Publish again, not the source-cancelled one", () => {
    render(
      <EventManager
        events={[
          makeEvent({
            published: false,
            adminUnpublishReason: "cancelled",
            adminUnpublishedAt: "2026-09-06T00:00:00.000Z",
            sourceCancelledAt: "2026-09-05T09:00:00.000Z",
            sourceCancelledBySourceId: "src-poolen",
            sourceCancellationEvidence: "aflyst",
          }),
        ]}
        venues={VENUES}
      />,
    );

    expect(screen.getByText(/Unpublished by admin/i)).toBeTruthy();
    expect(screen.queryByText(/Cancelled by source/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Publish again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Override & publish" })).toBeNull();
  });

  it("a published event with no source-cancellation trace shows neither label", () => {
    render(<EventManager events={[makeEvent()]} venues={VENUES} />);
    expect(screen.queryByText(/Cancelled by source/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Override & publish" })).toBeNull();
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
    fireEvent.click(screen.getByRole("checkbox", { name: /Free entry/ }));
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
    fireEvent.click(screen.getByRole("checkbox", { name: /Free entry/ })); // was checked (priceFrom 0), now unchecking
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.priceFrom).toBeNull();
  });

  it("adds an Official Event URL where none existed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ officialEventUrl: null })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Official event URL"), { target: { value: "https://venue.example.com/events/night" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.officialEventUrl).toBe("https://venue.example.com/events/night");
  });

  it("edits an existing Official Event URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ officialEventUrl: "https://venue.example.com/old" })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Official event URL"), { target: { value: "https://venue.example.com/corrected" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.officialEventUrl).toBe("https://venue.example.com/corrected");
  });

  it("clears an Official Event URL back to null", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ officialEventUrl: "https://venue.example.com/old" })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Official event URL"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.officialEventUrl).toBeNull();
  });

  it("edits an existing Ticket URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ ticketUrl: "https://tickets.example.com/old" })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Ticket URL"), { target: { value: "https://tickets.example.com/updated" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.ticketUrl).toBe("https://tickets.example.com/updated");
  });

  it("clears a Ticket URL back to null", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ ticketUrl: "https://tickets.example.com/old" })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Ticket URL"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.ticketUrl).toBeNull();
  });

  it("blocks save with an inline error on a malformed Official Event URL, never calling fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ officialEventUrl: null })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Official event URL"), { target: { value: "not a url" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(await screen.findByText(/Official event URL isn't a valid/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks save with an inline error on a malformed Ticket URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ ticketUrl: null })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Ticket URL"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(await screen.findByText(/Ticket URL isn't a valid/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("editing event A's Official Event URL never touches event B", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <EventManager
        events={[
          makeEvent({ id: "e-A", slug: "a", officialEventUrl: null }),
          makeEvent({ id: "e-B", slug: "b", title: "Other Night", officialEventUrl: null }),
        ]}
        venues={VENUES}
      />,
    );

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[0]);
    fireEvent.change(screen.getByLabelText("Official event URL"), { target: { value: "https://a.example.com" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Save/ })[0]);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/events/e-A");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.officialEventUrl).toBe("https://a.example.com");
  });

  it("Ticket URL still works and can coexist with Free in the data model (Tickets link takes rendering precedence — see src/lib/links.ts's showFreeCta)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ ticketUrl: null, priceFrom: null })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Ticket URL"), { target: { value: "https://billet.example.com/e/1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Free entry/ })); // also mark Free — both fields set at once
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.ticketUrl).toBe("https://billet.example.com/e/1");
    expect(body.patch.priceFrom).toBe(0);
  });
});

describe("EventManager — Sold out / Cancelled / Postponed (event lifecycle/status handling, 2026-08-28)", () => {
  afterEach(cleanup);

  it("sends soldOut in the patch only when toggled on", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent()]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Sold out" }));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.soldOut).toBe(true);
    expect(body.patch).not.toHaveProperty("cancelled");
    expect(body.patch).not.toHaveProperty("postponed");
  });

  it("sends cancelled in the patch only when toggled on", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent()]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Cancelled" }));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.cancelled).toBe(true);
  });

  it("sends postponed in the patch only when toggled on", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent()]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Postponed/ }));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.postponed).toBe(true);
  });

  it("unchecking an already-true status sends false, not omission", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent({ cancelled: true })]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Cancelled" }));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patch.cancelled).toBe(false);
  });

  it("leaves the patch untouched (and doesn't submit) when no status checkbox is changed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventManager events={[makeEvent()]} venues={VENUES} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    // No fields touched at all -> saveEdit's own empty-patch short-circuit,
    // matching every other no-op-edit path already tested in this file.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
