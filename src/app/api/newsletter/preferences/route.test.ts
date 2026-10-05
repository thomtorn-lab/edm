import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sanitizeGenreSelectionMock = vi.fn();
const updateSubscriberGenresMock = vi.fn();

vi.mock("@/db/newsletter", () => ({
  sanitizeGenreSelection: (...args: unknown[]) => sanitizeGenreSelectionMock(...args),
  updateSubscriberGenres: (...args: unknown[]) => updateSubscriberGenresMock(...args),
}));

import { POST } from "./route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/newsletter/preferences", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  sanitizeGenreSelectionMock.mockReset();
  updateSubscriberGenresMock.mockReset();
});

describe("POST /api/newsletter/preferences", () => {
  it("sanitizes the genre list and updates the subscriber", async () => {
    sanitizeGenreSelectionMock.mockReturnValue(["techno", "house"]);
    updateSubscriberGenresMock.mockResolvedValue(true);

    const res = await POST(makeRequest({ token: "manage-tok", genres: ["techno", "house", "bogus"] }));

    expect(sanitizeGenreSelectionMock).toHaveBeenCalledWith(["techno", "house", "bogus"]);
    expect(updateSubscriberGenresMock).toHaveBeenCalledWith("manage-tok", ["techno", "house"]);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, genres: ["techno", "house"] });
  });

  it("returns 404 for an unknown token", async () => {
    sanitizeGenreSelectionMock.mockReturnValue([]);
    updateSubscriberGenresMock.mockResolvedValue(false);
    const res = await POST(makeRequest({ token: "bogus-tok", genres: [] }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when the token is missing", async () => {
    const res = await POST(makeRequest({ genres: [] }));
    expect(res.status).toBe(400);
    expect(updateSubscriberGenresMock).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/newsletter/preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
