// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AddToCalendar from "./AddToCalendar";
import { googleCalendarUrl, outlookCalendarUrl } from "@/lib/ics";

const EVENT = {
  title: "Warehouse Night",
  description: null,
  startDatetime: "2026-10-17T21:00:00.000Z",
  endDatetime: "2026-10-18T05:00:00.000Z",
  venue: { name: "Culture Box", address: "Kronprinsessegade 54A" },
  eventUrl: "https://www.electroniccph.com/events/warehouse-night",
};
const ICS = "/events/warehouse-night/calendar.ics";

afterEach(cleanup);

describe("AddToCalendar — listing-row defaults (unchanged)", () => {
  it("keeps the small row button, a label hidden below sm, and a right-anchored desktop menu", () => {
    render(<AddToCalendar event={EVENT} icsHref={ICS} />);
    const button = screen.getByRole("button", { name: "Add to calendar" });
    expect(button.className).toContain("min-h-[2.25rem]");
    expect(button.className).toContain("text-[11px]");
    const label = Array.from(button.querySelectorAll("span")).find((s) => s.textContent === "Add to calendar")!;
    expect(label.className).toBe("hidden sm:inline");
    fireEvent.click(button);
    const menu = screen.getByRole("menu", { name: "Add to calendar" });
    expect(menu.className).toContain("sm:end-0");
    expect(menu.className).not.toContain("sm:start-0");
  });

  it("compact still hides the label at every width", () => {
    render(<AddToCalendar event={EVENT} icsHref={ICS} compact />);
    const label = Array.from(screen.getByRole("button").querySelectorAll("span")).find((s) => s.textContent === "Add to calendar")!;
    expect(label.className).toBe("hidden");
  });
});

describe("AddToCalendar — event-page button variant (2026-10-17)", () => {
  const CLASSES = "inline-flex min-h-11 items-center px-4 text-xs uppercase";

  it("uses the given button classes, keeps the label visible on mobile, and anchors the desktop menu to the left", () => {
    render(<AddToCalendar event={EVENT} icsHref={ICS} labelAlwaysVisible menuAlign="start" buttonClassName={CLASSES} />);
    const button = screen.getByRole("button", { name: "Add to calendar" });
    expect(button.className).toBe(CLASSES);
    const label = Array.from(button.querySelectorAll("span")).find((s) => s.textContent === "Add to calendar")!;
    expect(label.getAttribute("class")).toBeNull();
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Add to calendar" });
    expect(menu.className).toContain("sm:start-0");
    expect(menu.className).not.toContain("sm:end-0");
    // Still the bottom sheet below sm.
    expect(menu.className).toContain("fixed inset-x-0 bottom-0");
  });

  it("offers the same three calendars with the same date/time/time-zone handling as before", () => {
    render(<AddToCalendar event={EVENT} icsHref={ICS} labelAlwaysVisible menuAlign="start" buttonClassName={CLASSES} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
    expect(screen.getByRole("menuitem", { name: /Google Calendar/i }).getAttribute("href")).toBe(googleCalendarUrl(EVENT));
    expect(screen.getByRole("menuitem", { name: /Outlook/i }).getAttribute("href")).toBe(outlookCalendarUrl(EVENT));
    expect(screen.getByRole("menuitem", { name: /Apple Calendar \/ ICS/i }).getAttribute("href")).toBe(ICS);
  });

  it("Escape closes the menu", () => {
    render(<AddToCalendar event={EVENT} icsHref={ICS} labelAlwaysVisible menuAlign="start" />);
    fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
