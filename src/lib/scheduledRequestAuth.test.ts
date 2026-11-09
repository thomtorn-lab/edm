import { afterEach, describe, expect, it } from "vitest";
import { rejectUnauthorizedScheduledRequest } from "./scheduledRequestAuth";

const req = (headers: Record<string, string>) => new Request("https://x.test/api/sync/hangaren", { headers });

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.SYNC_TRIGGER_TOKEN;
});

describe("rejectUnauthorizedScheduledRequest", () => {
  it("accepts Vercel Cron's bearer secret and the manual workflows' sync token", () => {
    process.env.CRON_SECRET = "cron";
    process.env.SYNC_TRIGGER_TOKEN = "sync";
    expect(rejectUnauthorizedScheduledRequest(req({ authorization: "Bearer cron" }))).toBeNull();
    expect(rejectUnauthorizedScheduledRequest(req({ "x-sync-token": "sync" }))).toBeNull();
  });

  it("rejects wrong, missing or swapped credentials with 401", () => {
    process.env.CRON_SECRET = "cron";
    process.env.SYNC_TRIGGER_TOKEN = "sync";
    const cases: Record<string, string>[] = [{}, { authorization: "Bearer wrong" }, { authorization: "cron" }, { "x-sync-token": "cron" }, { authorization: "Bearer sync" }];
    for (const headers of cases) {
      expect(rejectUnauthorizedScheduledRequest(req(headers))?.status).toBe(401);
    }
  });

  it("never accepts a bearer header when CRON_SECRET is unset", () => {
    process.env.SYNC_TRIGGER_TOKEN = "sync";
    expect(rejectUnauthorizedScheduledRequest(req({ authorization: "Bearer undefined" }))?.status).toBe(401);
    expect(rejectUnauthorizedScheduledRequest(req({ authorization: "Bearer " }))?.status).toBe(401);
  });

  it("returns 500 when neither secret is configured", () => {
    expect(rejectUnauthorizedScheduledRequest(req({ authorization: "Bearer x" }))?.status).toBe(500);
  });
});
