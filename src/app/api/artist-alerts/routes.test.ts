import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestArtistAlerts = vi.fn();
const runArtistAlerts = vi.fn();
const unsubscribeArtistAlerts = vi.fn();
const sendEmail = vi.fn();
vi.mock("@/db/artistAlerts", () => ({ requestArtistAlerts, runArtistAlerts, unsubscribeArtistAlerts, confirmArtistAlerts: vi.fn(), updateFollowsByManageToken: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail, sendListEmail: vi.fn() }));

const ARTIST = "art_0123456789abcdef";
const post = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

beforeEach(() => {
  vi.resetAllMocks();
  requestArtistAlerts.mockResolvedValue({ confirmToken: "t".repeat(43), artistNames: ["Kasper Bjørke"] });
});
afterEach(() => {
  delete process.env.ARTIST_ALERTS_MODE;
  delete process.env.ARTIST_ALERTS_TEST_ALLOWLIST;
  delete process.env.SYNC_TRIGGER_TOKEN;
});

describe("POST /api/artist-alerts/subscribe", () => {
  const route = () => import("./subscribe/route");

  it("does not exist while the feature is off or observing", async () => {
    for (const mode of [undefined, "observe"]) {
      if (mode) process.env.ARTIST_ALERTS_MODE = mode;
      const res = await (await route()).POST(post("https://x.test/api/artist-alerts/subscribe", { email: "a@example.test", artistIds: [ARTIST] }));
      expect(res.status).toBe(404);
    }
    expect(requestArtistAlerts).not.toHaveBeenCalled();
  });

  it("live: stores the request and sends the confirmation, with a generic answer", async () => {
    process.env.ARTIST_ALERTS_MODE = "live";
    const res = await (await route()).POST(post("https://x.test/api/artist-alerts/subscribe", { email: "a@example.test", artistIds: [ARTIST, "not-an-id"] }));
    expect(await res.json()).toEqual({ ok: true });
    expect(requestArtistAlerts).toHaveBeenCalledWith({ email: "a@example.test", artistIds: [ARTIST], requests: [] });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "a@example.test", subject: "Confirm your Electronic CPH artist alerts" }));
  });

  it("test mode: other addresses get the same answer and nothing is stored or sent", async () => {
    process.env.ARTIST_ALERTS_MODE = "test";
    process.env.ARTIST_ALERTS_TEST_ALLOWLIST = "me@example.test";
    const res = await (await route()).POST(post("https://x.test/api/artist-alerts/subscribe", { email: "other@example.test", artistIds: [ARTIST] }));
    expect(await res.json()).toEqual({ ok: true });
    expect(requestArtistAlerts).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("honeypot and invalid input", async () => {
    process.env.ARTIST_ALERTS_MODE = "live";
    const { POST } = await route();
    expect(await (await POST(post("https://x.test/s", { email: "a@example.test", artistIds: [ARTIST], company: "spam" }))).json()).toEqual({ ok: true });
    expect((await POST(post("https://x.test/s", { email: "nope", artistIds: [ARTIST] }))).status).toBe(400);
    expect((await POST(post("https://x.test/s", { email: "a@example.test", artistIds: [] }))).status).toBe(400);
    expect(requestArtistAlerts).not.toHaveBeenCalled();
  });
});

describe("POST /api/artist-alerts/run", () => {
  it("requires the sync token and returns counts only", async () => {
    process.env.SYNC_TRIGGER_TOKEN = "secret";
    process.env.ARTIST_ALERTS_MODE = "observe";
    runArtistAlerts.mockResolvedValue({ mode: "observe", reconcile: { events: 3 } });
    const { POST } = await import("./run/route");
    expect((await POST(post("https://x.test/run", undefined, { "x-sync-token": "wrong" }))).status).toBe(401);
    const res = await POST(post("https://x.test/run", undefined, { "x-sync-token": "secret" }));
    expect(await res.json()).toEqual({ mode: "observe", reconcile: { events: 3 } });
    expect(runArtistAlerts).toHaveBeenCalledWith("observe", expect.any(Function));
  });
});

describe("POST /api/artist-alerts/unsubscribe", () => {
  it("unsubscribes a well-formed token in any mode and ignores anything else", async () => {
    const { POST } = await import("./unsubscribe/route");
    await POST(post(`https://x.test/u?token=${"a".repeat(43)}`));
    await POST(post("https://x.test/u?token=short"));
    expect(unsubscribeArtistAlerts).toHaveBeenCalledTimes(1);
  });
});
