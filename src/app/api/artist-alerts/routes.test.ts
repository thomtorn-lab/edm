import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestArtistAlerts = vi.fn();
const requestManageLink = vi.fn();
const confirmArtistAlerts = vi.fn();
const updateFollowsByManageToken = vi.fn();
const runArtistAlerts = vi.fn();
const unsubscribeArtistAlerts = vi.fn();
const sendEmail = vi.fn();
vi.mock("@/db/artistAlerts", () => ({ requestArtistAlerts, requestManageLink, runArtistAlerts, unsubscribeArtistAlerts, confirmArtistAlerts, updateFollowsByManageToken }));
vi.mock("@/lib/email", () => ({ sendEmail, sendListEmail: vi.fn() }));

const ARTIST = "art_0123456789abcdef";
const post = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

beforeEach(() => {
  vi.resetAllMocks();
  requestArtistAlerts.mockResolvedValue({ outcome: "confirm", confirmToken: "t".repeat(43), artistNames: ["Kasper Bjørke"] });
  sendEmail.mockResolvedValue(undefined);
});
afterEach(() => {
  delete process.env.ARTIST_ALERTS_MODE;
  delete process.env.ARTIST_ALERTS_TEST_ALLOWLIST;
  delete process.env.SYNC_TRIGGER_TOKEN;
  delete process.env.CRON_SECRET;
  delete process.env.CONTACT_RECIPIENT_EMAIL;
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
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@example.test", subject: "Confirm your Electronic CPH artist alerts", replyTo: "hello@electroniccph.com" }),
    );
    expect(sendEmail.mock.calls[0][0].text).not.toContain("/artists/manage"); // first signup: no manage link
  });

  it("an already confirmed address gets its manage link instead of a new confirmation, with the same answer", async () => {
    process.env.ARTIST_ALERTS_MODE = "live";
    requestArtistAlerts.mockResolvedValue({ outcome: "manage", manageToken: "m".repeat(43), picks: { artistIds: [ARTIST], requests: [{ name: "Kölsch", profileUrl: null }] } });
    const res = await (await route()).POST(post("https://x.test/api/artist-alerts/subscribe", { email: "a@example.test", artistIds: [ARTIST] }));
    expect(await res.json()).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.subject).toBe("Your Electronic CPH artist alerts");
    expect(sent.html).toContain(">Manage your artist alerts</a>"); // HTML part is sent too
    // The picks travel in the link (nothing stored), to be added on the manage page.
    expect(sent.text).toContain(`/artists/manage?token=${"m".repeat(43)}&add=${ARTIST}&req=`);
    expect(sent.replyTo).toBe("hello@electroniccph.com");
  });

  it("says so when no email is sent because of a limit, instead of claiming success", async () => {
    process.env.ARTIST_ALERTS_MODE = "live";
    const { POST } = await route();
    const { ADDRESS_LIMIT_MESSAGE, BUSY_MESSAGE } = await import("@/lib/artistAlerts/messages");
    requestArtistAlerts.mockResolvedValue({ outcome: "limited" });
    let res = await POST(post("https://x.test/api/artist-alerts/subscribe", { email: "a@example.test", artistIds: [ARTIST] }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: ADDRESS_LIMIT_MESSAGE });
    requestArtistAlerts.mockResolvedValue({ outcome: "busy" });
    res = await POST(post("https://x.test/api/artist-alerts/subscribe", { email: "a@example.test", artistIds: [ARTIST] }));
    expect(await res.json()).toEqual({ error: BUSY_MESSAGE });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("test mode: an address outside the allowlist is told the test is closed; nothing is stored or sent", async () => {
    process.env.ARTIST_ALERTS_MODE = "test";
    process.env.ARTIST_ALERTS_TEST_ALLOWLIST = "me@example.test";
    const { POST } = await route();
    const { CLOSED_TEST_MESSAGE } = await import("@/lib/artistAlerts/messages");
    const res = await POST(post("https://x.test/api/artist-alerts/subscribe", { email: "other@example.test", artistIds: [ARTIST] }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: CLOSED_TEST_MESSAGE });
    expect(requestArtistAlerts).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    // The allowlisted address works (case-insensitive).
    expect((await POST(post("https://x.test/api/artist-alerts/subscribe", { email: "Me@Example.test", artistIds: [ARTIST] }))).status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("reports a failed send instead of claiming success", async () => {
    process.env.ARTIST_ALERTS_MODE = "live";
    sendEmail.mockRejectedValue(new Error("Resend error"));
    const res = await (await route()).POST(post("https://x.test/api/artist-alerts/subscribe", { email: "a@example.test", artistIds: [ARTIST] }, { "x-forwarded-for": "192.0.2.50" }));
    expect(res.status).toBe(502);
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

describe("POST /api/artist-alerts/manage-link", () => {
  const route = () => import("./manage-link/route");

  it("emails a confirmed subscriber their manage link; every address gets the same answer", async () => {
    process.env.ARTIST_ALERTS_MODE = "live";
    const { POST } = await route();
    const { MANAGE_LINK_SENT_MESSAGE } = await import("@/lib/artistAlerts/messages");
    requestManageLink.mockResolvedValue({ manageToken: "m".repeat(43) });
    const known = await POST(post("https://x.test/m", { email: "a@example.test" }));
    expect(await known.json()).toEqual({ ok: true, message: MANAGE_LINK_SENT_MESSAGE });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "a@example.test", subject: "Your Electronic CPH artist alerts", replyTo: "hello@electroniccph.com" }));
    expect(sendEmail.mock.calls[0][0].text).toContain(`/artists/manage?token=${"m".repeat(43)}`);

    requestManageLink.mockResolvedValue(null);
    const unknown = await POST(post("https://x.test/m", { email: "b@example.test" }));
    expect(await unknown.json()).toEqual({ ok: true, message: MANAGE_LINK_SENT_MESSAGE });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("is off outside test/live, validates the address, and keeps the test allowlist", async () => {
    const { POST } = await route();
    expect((await POST(post("https://x.test/m", { email: "a@example.test" }))).status).toBe(404);
    process.env.ARTIST_ALERTS_MODE = "test";
    process.env.ARTIST_ALERTS_TEST_ALLOWLIST = "me@example.test";
    expect((await POST(post("https://x.test/m", { email: "nope" }))).status).toBe(400);
    expect((await POST(post("https://x.test/m", { email: "other@example.test" }))).status).toBe(403);
    expect(requestManageLink).not.toHaveBeenCalled();
  });
});

describe("artist request admin notice", () => {
  it("confirming a signup with a new request emails the site inbox once; manage changes email no subscriber", async () => {
    process.env.ARTIST_ALERTS_MODE = "live";
    confirmArtistAlerts.mockResolvedValue({ manageToken: "m".repeat(43), newRequests: [{ artistId: "art_x", displayName: "Kölsch", profileUrl: "https://soundcloud.com/kolsch" }] });
    const form = new FormData();
    form.set("token", "t".repeat(43));
    const confirm = await (await import("./confirm/route")).POST(new NextRequest("https://x.test/c", { method: "POST", body: form }));
    expect(confirm.status).toBe(303);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBeUndefined(); // the site's own inbox (CONTACT_RECIPIENT_EMAIL)
    expect(sendEmail.mock.calls[0][0].text).toContain("Kölsch (https://soundcloud.com/kolsch)");

    updateFollowsByManageToken.mockResolvedValue({ ok: true, newRequests: [] });
    const manage = await (await import("./manage/route")).POST(post("https://x.test/m", { token: "m".repeat(43), add: [ARTIST] }));
    expect(await manage.json()).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(1); // adding an artist sends nothing
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

  it("GET is Vercel Cron's call: accepts only Authorization: Bearer CRON_SECRET", async () => {
    process.env.CRON_SECRET = "cron-secret";
    process.env.ARTIST_ALERTS_MODE = "observe";
    runArtistAlerts.mockResolvedValue({ mode: "observe" });
    const { GET } = await import("./run/route");
    const get = (headers: Record<string, string>) => new NextRequest("https://x.test/run", { method: "GET", headers });
    expect((await GET(get({}))).status).toBe(401);
    expect((await GET(get({ authorization: "Bearer wrong" }))).status).toBe(401);
    expect(runArtistAlerts).not.toHaveBeenCalled();
    const res = await GET(get({ authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(200);
    expect(runArtistAlerts).toHaveBeenCalledTimes(1);
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
