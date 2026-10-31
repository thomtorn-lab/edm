import { describe, expect, it } from "vitest";

/** vitest.setup.ts: no inherited database credential or guard opt-in reaches a test (2026-10-25). */
describe("test process environment", () => {
  it("has no DATABASE_URL or ALLOW_HOSTED_DATABASE, whatever the shell, cloud environment or CI step exported", () => {
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.ALLOW_HOSTED_DATABASE).toBeUndefined();
  });
});
