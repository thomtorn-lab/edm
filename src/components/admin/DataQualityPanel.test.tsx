// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DataQualityPanel from "./DataQualityPanel";
import type { EventDataQualityReport } from "@/lib/dataQuality";
import type { EventWithVenue } from "@/lib/queries";

afterEach(cleanup);

function report(id: string, title: string, published: boolean, issues: EventDataQualityReport["issues"]): EventDataQualityReport<EventWithVenue> {
  return {
    event: {
      id,
      title,
      published,
      startDatetime: "2026-11-04T19:00:00.000Z",
      endDatetime: null,
      canonicalSourceId: "src-pumpehuset",
      venue: { id: "v-pumpehuset", name: "Pumpehuset" },
    } as unknown as EventWithVenue,
    issues,
  };
}

describe("DataQualityPanel", () => {
  it("lists each event with a link to its editor, its state and every issue", () => {
    render(
      <DataQualityPanel
        reports={[
          report("e-7208d716", "STVW pres. Punk Rave", false, [
            { key: "date_flip_flop", severity: "warning", message: "Start date changed 3 times in 7 days by src-pumpehuset." },
          ]),
          report("e-bollebas", "BØLLEBAS", true, [{ key: "end_not_after_start", severity: "error", message: "End time is not after the start." }]),
          report("e-reptile", "The Final Reptile Rave - HELL", true, [
            { key: "early_end_for_evening_start", severity: "possible_inconsistency", message: "Looks like a club night but ends at 23:30." },
          ]),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "STVW pres. Punk Rave" }).getAttribute("href")).toBe("#event-e-7208d716");
    expect(screen.getByText("Not published")).toBeTruthy();
    expect(screen.getAllByText("Published")).toHaveLength(2);
    expect(screen.getByText(/Check: Start date changed 3 times/)).toBeTruthy();
    expect(screen.getByText(/Error: End time is not after the start/)).toBeTruthy();
    expect(screen.getByText(/Possible inconsistency: Looks like a club night/)).toBeTruthy();
    expect(screen.getAllByText(/Pumpehuset · source: src-pumpehuset/)).toHaveLength(3);
  });

  it("says so when there is nothing to check", () => {
    render(<DataQualityPanel reports={[]} />);
    expect(screen.getByText(/No date or end-time problems/)).toBeTruthy();
  });
});
