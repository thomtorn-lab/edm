import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests, scoped to what this handler itself is responsible for
 * — input validation and translating src/db/writes.ts's createVenue()
 * outcomes into the right HTTP response. Server-side authorization is a
 * separate concern, already covered directly against the real proxy() in
 * src/proxy.test.ts (this route carries no inline auth check by design —
 * see that file's header comment for why that's the correct, existing
 * convention, not a gap). createVenue is mocked here so no real database is
 * touched — no Production/Preview data is created by these tests.
 */

const createVenueMock = vi.fn();

// Never import the real src/db/writes.ts here — it transitively imports
// src/db/client.ts, which throws at module-load time unless DATABASE_URL is
// set (see that file). A fully self-contained mock (including a standalone
// VenueNeedsConfirmationError class, matching the real one's `instanceof`
// shape) keeps this test independent of any database or environment config.
// Defined inside the factory since vi.mock is hoisted above module-level
// declarations.
vi.mock("@/db/writes", () => {
  class VenueNeedsConfirmationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "VenueNeedsConfirmationError";
    }
  }
  return {
    createVenue: (...args: unknown[]) => createVenueMock(...args),
    VenueNeedsConfirmationError,
  };
});

import { POST } from "./route";
import { VenueNeedsConfirmationError } from "@/db/writes";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/venues", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { name: "Suporama", address: "Nørrebrogade 1", city: "Copenhagen", postalCode: "2200" };

afterEach(() => {
  createVenueMock.mockReset();
});

describe("POST /api/admin/venues — validation", () => {
  it("rejects a missing name with 400 and never calls createVenue", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, name: "" }));
    expect(res.status).toBe(400);
    expect(createVenueMock).not.toHaveBeenCalled();
  });

  it("rejects a missing address with 400", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, address: "" }));
    expect(res.status).toBe(400);
  });

  it("rejects a city outside the Copenhagen/Frederiksberg union with 400", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, city: "Aarhus" }));
    expect(res.status).toBe(400);
    expect(createVenueMock).not.toHaveBeenCalled();
  });

  it("rejects a missing postal code with 400", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, postalCode: "" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/venues — normal (authorized-caller) create/reuse flow", () => {
  it("creates a genuinely new venue and returns it", async () => {
    const venue = { ...VALID_BODY, id: "v-suporama", slug: "suporama", aliases: [], websiteUrl: null, description: "", shortDescription: null, venueProfile: null };
    createVenueMock.mockResolvedValue({ created: true, venue });

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, created: true, venue });
    expect(createVenueMock).toHaveBeenCalledWith(
      { name: "Suporama", address: "Nørrebrogade 1", city: "Copenhagen", postalCode: "2200", websiteUrl: null },
      { confirmed: false },
    );
  });

  it("returns the existing venue instead of creating a duplicate (duplicate handling still works)", async () => {
    const venue = { ...VALID_BODY, name: "Culture Box", id: "v-culture-box", slug: "culture-box", aliases: [], websiteUrl: null, description: "", shortDescription: null, venueProfile: null };
    createVenueMock.mockResolvedValue({ created: false, venue });

    const res = await POST(makeRequest({ ...VALID_BODY, name: "CULTURE BOX!!" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toBe(false);
    expect(json.venue.id).toBe("v-culture-box");
  });

  it("passes confirmed:true through to createVenue when the client sends it", async () => {
    createVenueMock.mockResolvedValue({ created: true, venue: { ...VALID_BODY, name: "Byhaven", id: "v-byhaven-2", slug: "byhaven-2", aliases: [], websiteUrl: null, description: "", shortDescription: null, venueProfile: null } });

    await POST(makeRequest({ ...VALID_BODY, name: "Byhaven", confirmed: true }));
    expect(createVenueMock).toHaveBeenCalledWith(expect.objectContaining({ name: "Byhaven" }), { confirmed: true });
  });
});

describe("POST /api/admin/venues — protected sub-venue confirmation flow", () => {
  it("returns 409 with needsConfirmation when createVenue throws VenueNeedsConfirmationError", async () => {
    createVenueMock.mockRejectedValue(new VenueNeedsConfirmationError("\"Byhaven\" is normally a sub-area/room of an existing venue."));

    const res = await POST(makeRequest({ ...VALID_BODY, name: "Byhaven" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.needsConfirmation).toBe(true);
    expect(json.error).toContain("Byhaven");
  });
});

describe("POST /api/admin/venues — other failures", () => {
  it("returns 400 with the underlying message on a generic createVenue failure (e.g. slug collision)", async () => {
    createVenueMock.mockRejectedValue(new Error("A venue with a conflicting identity already exists"));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("conflicting identity");
  });
});
