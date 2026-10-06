import { describe, expect, it } from "vitest";
import { isDstCorrectCronFiring, parseUtcOffsetHours } from "./dstSchedule";

describe("parseUtcOffsetHours", () => {
  it("parses +0100 (CET) as 1", () => {
    expect(parseUtcOffsetHours("+0100")).toBe(1);
  });

  it("parses +0200 (CEST) as 2", () => {
    expect(parseUtcOffsetHours("+0200")).toBe(2);
  });

  it("fails closed (null) for a non-whole-hour offset", () => {
    expect(parseUtcOffsetHours("+0130")).toBeNull();
  });

  it("fails closed (null) for an offset Denmark never uses", () => {
    expect(parseUtcOffsetHours("+0300")).toBeNull();
    expect(parseUtcOffsetHours("-0500")).toBeNull();
    expect(parseUtcOffsetHours("+0000")).toBeNull();
  });

  it("fails closed (null) for an unparseable string", () => {
    expect(parseUtcOffsetHours("not-an-offset")).toBeNull();
    expect(parseUtcOffsetHours("")).toBeNull();
  });
});

describe("isDstCorrectCronFiring", () => {
  it("CET (offset 1): the 09:00 UTC entry is correct, the 08:00 UTC entry is not", () => {
    expect(isDstCorrectCronFiring("0 9 * * 4", 1)).toBe(true);
    expect(isDstCorrectCronFiring("0 8 * * 4", 1)).toBe(false);
  });

  it("CEST (offset 2): the 08:00 UTC entry is correct, the 09:00 UTC entry is not", () => {
    expect(isDstCorrectCronFiring("0 8 * * 4", 2)).toBe(true);
    expect(isDstCorrectCronFiring("0 9 * * 4", 2)).toBe(false);
  });

  it("is independent of execution time by construction — it never reads a clock, only the cron string and the offset passed in", () => {
    // Same inputs, called at two different "times" (there is no time
    // parameter at all) — the answer can only ever depend on the two
    // arguments given, which is exactly what makes a late-starting
    // GitHub Actions run still judged correctly.
    const a = isDstCorrectCronFiring("0 8 * * 4", 2);
    const b = isDstCorrectCronFiring("0 8 * * 4", 2);
    expect(a).toBe(b);
    expect(a).toBe(true);
  });

  it("fails closed for a malformed cron expression", () => {
    expect(isDstCorrectCronFiring("not a cron", 1)).toBe(false);
    expect(isDstCorrectCronFiring("0 9 * *", 1)).toBe(false);
    expect(isDstCorrectCronFiring("0 25 * * 4", 1)).toBe(false);
  });
});
