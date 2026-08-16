import type { Venue } from "./types";
import { effectiveEndInstant } from "./datetime";

/**
 * Calendar export (spec section 13). ICS covers Apple Calendar and Outlook
 * desktop import; Google/Outlook web also get direct deep-link URLs. All
 * three carry the same fields: title, start, end, venue, address, internal
 * event URL and a short description.
 */

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export interface CalendarEventInput {
  title: string;
  description: string | null;
  startDatetime: string;
  endDatetime: string | null;
  venue: Pick<Venue, "name" | "address">;
  eventUrl: string;
}

function calendarBounds(input: CalendarEventInput): { start: Date; end: Date } {
  const start = new Date(input.startDatetime);
  const end = input.endDatetime ? new Date(input.endDatetime) : effectiveEndInstant({ startDatetime: input.startDatetime, endDatetime: null });
  return { start, end };
}

export function buildIcsFile(input: CalendarEventInput): string {
  const { start, end } = calendarBounds(input);
  const uid = `${toIcsUtc(start)}-${encodeURIComponent(input.title).slice(0, 24)}@electroniccph.com`;
  const descriptionLines = [input.description, input.eventUrl].filter(Boolean).join("\\n\\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Copenhagen Electronic Music Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${icsEscape(input.title)}`,
    `LOCATION:${icsEscape(`${input.venue.name}, ${input.venue.address}`)}`,
    `DESCRIPTION:${icsEscape(descriptionLines)}`,
    `URL:${input.eventUrl}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

export function icsDataUrl(input: CalendarEventInput): string {
  const content = buildIcsFile(input);
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(content)}`;
}

function googleDateParam(date: Date): string {
  return toIcsUtc(date);
}

export function googleCalendarUrl(input: CalendarEventInput): string {
  const { start, end } = calendarBounds(input);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${googleDateParam(start)}/${googleDateParam(end)}`,
    details: [input.description, input.eventUrl].filter(Boolean).join("\n\n"),
    location: `${input.venue.name}, ${input.venue.address}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function outlookCalendarUrl(input: CalendarEventInput): string {
  const { start, end } = calendarBounds(input);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: input.title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: [input.description, input.eventUrl].filter(Boolean).join("\n\n"),
    location: `${input.venue.name}, ${input.venue.address}`,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}
