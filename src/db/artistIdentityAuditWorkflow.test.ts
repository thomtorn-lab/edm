import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The artist-identity-audit mode of inspect-source.yml must only ever see
 * the dedicated read-only reporting role. These checks read the workflow
 * text itself, step by step.
 */
const yaml = readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "inspect-source.yml"), "utf-8");

function step(name: string): string {
  const start = yaml.indexOf(`      - name: ${name}`);
  expect(start, `step "${name}" not found`).toBeGreaterThan(-1);
  const next = yaml.indexOf("\n      - name: ", start + 1);
  return yaml.slice(start, next === -1 ? undefined : next);
}

describe("inspect-source.yml — artist-identity-audit mode", () => {
  it("is a selectable mode", () => {
    expect(yaml).toMatch(/\n {10}- artist-identity-audit\n/);
  });

  it("never verifies, writes or receives DATABASE_URL", () => {
    expect(step("Verify DATABASE_URL secret is configured")).toContain("inputs.mode != 'artist-identity-audit'");
    expect(step("Write DATABASE_URL for the diagnostic script")).toContain("inputs.mode != 'artist-identity-audit'");
    expect(step("Run inspection")).toContain("if: ${{ inputs.mode != 'artist-identity-audit' }}");
    const audit = step("Run artist identity audit (dedicated read-only role)");
    expect(audit).not.toMatch(/secrets\.DATABASE_URL\b(?!_REPORT_RO)/);
    expect(audit).not.toContain(".env.local");
  });

  it("runs only the audit CLI, only with the dedicated read-only secret, and fails closed without it", () => {
    const audit = step("Run artist identity audit (dedicated read-only role)");
    expect(audit).toContain("if: ${{ inputs.mode == 'artist-identity-audit' }}");
    expect(audit).toContain("DATABASE_URL_REPORT_RO: ${{ secrets.DATABASE_URL_REPORT_RO }}");
    expect(audit).toMatch(/if \[ -z "\$\{DATABASE_URL_REPORT_RO:-\}" \]; then[\s\S]*exit 1/);
    expect(audit).toContain("node --import tsx src/db/artistIdentityAuditCli.ts --out=artist-identity-audit.json");
    expect(audit).not.toMatch(/YOUTUBE_API_KEY|BILLETTO_|RESEND|DISCOGS/);
    expect(audit.match(/\$\{\{/g)?.length).toBe(2); // the if: condition and the one secret
  });

  it("uploads the JSON report as a short-lived artifact", () => {
    const upload = step("Upload artist identity audit report");
    expect(upload).toContain("inputs.mode == 'artist-identity-audit'");
    expect(upload).toContain("path: artist-identity-audit.json");
    expect(upload).toContain("retention-days: 14");
  });
});
