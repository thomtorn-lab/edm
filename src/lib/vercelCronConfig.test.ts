import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Vercel Cron (vercel.json) is the only scheduler for Event Discovery and
// Artist Alerts; the GitHub workflows stay for manual runs only.
const root = path.resolve(__dirname, "../..");
const crons: { path: string; schedule: string }[] = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8")).crons;
const workflowsDir = path.join(root, ".github/workflows");
const syncWorkflows = readdirSync(workflowsDir).filter((f) => /^sync-.+\.yml$/.test(f));

describe("vercel.json crons", () => {
  it("schedules every manually-runnable source sync every 6 hours", () => {
    expect(syncWorkflows.length).toBeGreaterThan(0);
    for (const file of syncWorkflows) {
      const endpoint = readFileSync(path.join(workflowsDir, file), "utf8").match(/\/api\/sync\/[a-z0-9-]+/)?.[0];
      const cron = crons.find((c) => c.path === endpoint);
      expect(cron, `${file} -> ${endpoint}`).toBeDefined();
      expect(cron!.schedule).toMatch(/^\d{1,2} \*\/6 \* \* \*$/);
    }
    expect(crons.filter((c) => c.path.startsWith("/api/sync/"))).toHaveLength(syncWorkflows.length);
  });

  it("runs Artist Alerts every 30 minutes", () => {
    expect(crons.find((c) => c.path === "/api/artist-alerts/run")?.schedule).toBe("17,47 * * * *");
  });

  it("leaves no GitHub schedule on the moved workflows, but keeps manual dispatch", () => {
    for (const file of [...syncWorkflows, "artist-alerts.yml"]) {
      const yml = readFileSync(path.join(workflowsDir, file), "utf8");
      expect(yml, file).not.toMatch(/^\s*schedule:/m);
      expect(yml, file).toMatch(/^\s*workflow_dispatch:/m);
    }
  });
});
