import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Safety properties of .github/workflows/translation-integration-check.yml
 * (2026-10-25): it is a PAID run, so it must only start on a deliberate
 * trigger, never touch the database, and keep model and budget fixed.
 */
const yaml = readFileSync(path.join(process.cwd(), ".github/workflows/translation-integration-check.yml"), "utf8");
const lines = yaml.split("\n").filter((l) => !l.trim().startsWith("#"));
const body = lines.join("\n");

describe("translation-integration-check workflow", () => {
  it("starts only on the deliberate label or a manual dispatch — never on push or other PR activity", () => {
    expect(body).toMatch(/^on:\n {2}pull_request:\n {4}types: \[labeled\]\n {2}workflow_dispatch:\n\npermissions:/m);
    expect(body).not.toMatch(/^\s+(push|schedule|pull_request_target):/m);
    expect(body).toContain("github.event.label.name == 'run-translation-check'");
    expect(body).toContain("github.event.pull_request.head.repo.full_name == github.repository");
  });

  it("never gets database access", () => {
    expect(body).not.toMatch(/DATABASE_URL|\.env\.local|translateDescriptions\.ts/);
  });

  it("runs only the integration check, with the approved model and a fixed $0.10 budget (no inputs)", () => {
    expect(body).toContain("src/db/translationIntegrationCheck.ts");
    expect(body).toContain("--confirm-paid");
    expect(body).toContain("--model=claude-sonnet-5-5");
    expect(body).toContain("--max-cost-usd=0.10");
    expect(body).not.toMatch(/inputs\./);
  });

  it("passes the key only as an environment variable from the repository secret, and never echoes it", () => {
    expect(body.match(/ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/g)).toHaveLength(2);
    expect(body).not.toMatch(/echo[^\n]*\$\{?ANTHROPIC_API_KEY/);
  });
});
