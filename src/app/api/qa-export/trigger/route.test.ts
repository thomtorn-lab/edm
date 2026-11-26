import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const fetchMock = vi.fn();
const request = (headers: Record<string, string>) => new NextRequest("https://x.test/api/qa-export/trigger", { method: "GET", headers });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.CRON_SECRET = "cron";
  process.env.SYNC_TRIGGER_TOKEN = "sync";
  process.env.GITHUB_QA_DISPATCH_TOKEN = "gh-token";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CRON_SECRET;
  delete process.env.SYNC_TRIGGER_TOKEN;
  delete process.env.GITHUB_QA_DISPATCH_TOKEN;
});

describe("/api/qa-export/trigger", () => {
  it("accepts only Vercel Cron's CRON_SECRET bearer — never SYNC_TRIGGER_TOKEN", async () => {
    expect((await GET(request({}))).status).toBe(401);
    expect((await GET(request({ authorization: "Bearer wrong" }))).status).toBe(401);
    expect((await GET(request({ "x-sync-token": "sync" }))).status).toBe(401);
    expect((await GET(request({ authorization: "Bearer sync" }))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses with 500 when CRON_SECRET is not configured, without calling GitHub", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(request({ authorization: "Bearer " }))).status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dispatches the existing QA export workflow on the default branch with trigger=scheduled", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await GET(request({ authorization: "Bearer cron" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dispatched: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/thomtorn-lab/edm/actions/workflows/qa-export-readonly.yml/dispatches");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gh-token");
    expect(JSON.parse(String(init.body))).toEqual({ ref: "claude/copenhagen-edm-events-site-3lo273", inputs: { trigger: "scheduled" } });
  });

  it("returns 502 (so Vercel records a failure) when GitHub refuses or is unreachable, and never echoes the token", async () => {
    fetchMock.mockResolvedValue(new Response("Bad credentials", { status: 401 }));
    const refused = await GET(request({ authorization: "Bearer cron" }));
    expect(refused.status).toBe(502);
    expect(JSON.stringify(await refused.json())).not.toContain("gh-token");
    fetchMock.mockRejectedValue(new Error("network down"));
    expect((await GET(request({ authorization: "Bearer cron" }))).status).toBe(502);
  });

  it("returns 500 without calling GitHub when GITHUB_QA_DISPATCH_TOKEN is missing", async () => {
    delete process.env.GITHUB_QA_DISPATCH_TOKEN;
    expect((await GET(request({ authorization: "Bearer cron" }))).status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
