import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runSourceSync = vi.fn();
vi.mock("@/db/sync", () => ({ runSourceSync }));
vi.mock("@/lib/artistAlerts/trigger", () => ({ reconcileArtistsSoon: vi.fn() }));

const params = (source: string) => ({ params: Promise.resolve({ source }) });
const request = (method: "GET" | "POST", headers: Record<string, string>) => new NextRequest("https://x.test/api/sync/hvaderpaa", { method, headers });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.CRON_SECRET = "cron";
  process.env.SYNC_TRIGGER_TOKEN = "sync";
  runSourceSync.mockResolvedValue({ sourceId: "src-hvaderpaa", outcome: "ok", errors: [] });
});
afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.SYNC_TRIGGER_TOKEN;
});

describe("/api/sync/[source]", () => {
  it("GET (Vercel Cron) runs the sync with the bearer secret, and only with it", async () => {
    const { GET } = await import("./route");
    expect((await GET(request("GET", { authorization: "Bearer wrong" }), params("hvaderpaa"))).status).toBe(401);
    expect(runSourceSync).not.toHaveBeenCalled();
    const res = await GET(request("GET", { authorization: "Bearer cron" }), params("hvaderpaa"));
    expect(res.status).toBe(200);
    expect(runSourceSync).toHaveBeenCalledWith("src-hvaderpaa", "HvadErPå", expect.anything());
  });

  it("POST (manual workflow) still works with x-sync-token", async () => {
    const { POST } = await import("./route");
    expect((await POST(request("POST", { "x-sync-token": "sync" }), params("hvaderpaa"))).status).toBe(200);
  });

  it("a concurrent run is a 200 skip, not an error", async () => {
    runSourceSync.mockResolvedValue({ sourceId: "src-hvaderpaa", outcome: "skipped_concurrent", errors: [] });
    const { GET } = await import("./route");
    expect((await GET(request("GET", { authorization: "Bearer cron" }), params("hvaderpaa"))).status).toBe(200);
  });

  it("allows a long sync to finish", async () => {
    const { maxDuration } = await import("./route");
    expect(maxDuration).toBeGreaterThanOrEqual(300);
  });
});
