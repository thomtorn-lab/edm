// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getEventStatuses } from "./StatusBadge";

function flags(overrides: Partial<{ cancelled: boolean; soldOut: boolean; dateChanged: boolean; timeChanged: boolean }> = {}) {
  return { cancelled: false, soldOut: false, dateChanged: false, timeChanged: false, ...overrides };
}

describe("getEventStatuses — internal data-quality flags never surface publicly", () => {
  it("produces no status for a normal event", () => {
    expect(getEventStatuses(flags())).toEqual([]);
  });

  it("dateChanged alone produces no public status", () => {
    expect(getEventStatuses(flags({ dateChanged: true }))).toEqual([]);
  });

  it("timeChanged alone produces no public status", () => {
    expect(getEventStatuses(flags({ timeChanged: true }))).toEqual([]);
  });

  it("dateChanged + timeChanged together still produce no public status", () => {
    expect(getEventStatuses(flags({ dateChanged: true, timeChanged: true }))).toEqual([]);
  });

  it("cancelled still renders, unaffected by dateChanged/timeChanged", () => {
    expect(getEventStatuses(flags({ cancelled: true, dateChanged: true, timeChanged: true }))).toEqual([
      { label: "Cancelled", tone: "bad" },
    ]);
  });

  it("soldOut still renders, unaffected by dateChanged/timeChanged", () => {
    expect(getEventStatuses(flags({ soldOut: true, dateChanged: true, timeChanged: true }))).toEqual([
      { label: "Sold out", tone: "neutral" },
    ]);
  });

  it("cancelled + soldOut together render both, still no date/time-changed leakage", () => {
    expect(getEventStatuses(flags({ cancelled: true, soldOut: true, dateChanged: true, timeChanged: true }))).toEqual([
      { label: "Cancelled", tone: "bad" },
      { label: "Sold out", tone: "neutral" },
    ]);
  });
});
