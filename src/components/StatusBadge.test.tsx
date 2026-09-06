// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getEventStatuses } from "./StatusBadge";

function flags(
  overrides: Partial<{ cancelled: boolean; soldOut: boolean; postponed: boolean; dateChanged: boolean; timeChanged: boolean }> = {},
) {
  return { cancelled: false, soldOut: false, postponed: false, dateChanged: false, timeChanged: false, ...overrides };
}

describe("getEventStatuses", () => {
  it("produces no status for a normal event", () => {
    expect(getEventStatuses(flags())).toEqual([]);
  });

  it("timeChanged alone produces no public status — an internal, same-day-correction flag only", () => {
    expect(getEventStatuses(flags({ timeChanged: true }))).toEqual([]);
  });

  it("cancelled produces no public badge (admin unpublish/cancellation safety, 2026-09-06) — a cancelled event is taken down entirely via admin unpublish, never shown live with a badge", () => {
    expect(getEventStatuses(flags({ cancelled: true }))).toEqual([]);
  });

  it("soldOut renders", () => {
    expect(getEventStatuses(flags({ soldOut: true }))).toEqual([{ label: "Sold out", tone: "neutral" }]);
  });

  it("cancelled + soldOut: only Sold out renders, cancelled contributes no badge", () => {
    expect(getEventStatuses(flags({ cancelled: true, soldOut: true }))).toEqual([
      { label: "Sold out", tone: "neutral" },
    ]);
  });

  describe("dateChanged -> public 'Rescheduled' (event lifecycle/status handling, 2026-08-28)", () => {
    it("dateChanged alone now renders 'Rescheduled' — a confirmed date change from the source", () => {
      expect(getEventStatuses(flags({ dateChanged: true }))).toEqual([{ label: "Rescheduled", tone: "neutral" }]);
    });

    it("dateChanged + timeChanged together still render only Rescheduled — timeChanged itself never leaks through as its own status", () => {
      expect(getEventStatuses(flags({ dateChanged: true, timeChanged: true }))).toEqual([
        { label: "Rescheduled", tone: "neutral" },
      ]);
    });

    it("rescheduled + soldOut together render both", () => {
      expect(getEventStatuses(flags({ dateChanged: true, soldOut: true }))).toEqual([
        { label: "Rescheduled", tone: "neutral" },
        { label: "Sold out", tone: "neutral" },
      ]);
    });

    it("cancelled no longer suppresses Rescheduled — cancelled contributes no public badge at all now", () => {
      expect(getEventStatuses(flags({ cancelled: true, dateChanged: true }))).toEqual([
        { label: "Rescheduled", tone: "neutral" },
      ]);
    });
  });

  describe("postponed (event lifecycle/status handling, 2026-08-28)", () => {
    it("postponed alone renders 'Postponed'", () => {
      expect(getEventStatuses(flags({ postponed: true }))).toEqual([{ label: "Postponed", tone: "bad" }]);
    });

    it("postponed + soldOut together render both", () => {
      expect(getEventStatuses(flags({ postponed: true, soldOut: true }))).toEqual([
        { label: "Postponed", tone: "bad" },
        { label: "Sold out", tone: "neutral" },
      ]);
    });

    it("cancelled no longer suppresses Postponed — cancelled contributes no public badge at all now", () => {
      expect(getEventStatuses(flags({ cancelled: true, postponed: true }))).toEqual([
        { label: "Postponed", tone: "bad" },
      ]);
    });

    it("postponed takes priority over dateChanged/Rescheduled when both happen to be set", () => {
      expect(getEventStatuses(flags({ postponed: true, dateChanged: true }))).toEqual([
        { label: "Postponed", tone: "bad" },
      ]);
    });
  });
});
