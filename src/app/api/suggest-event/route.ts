import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { isValidEmail, isValidHttpUrl } from "@/lib/validation";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";

const MAX_FIELD_LENGTH = 200;
const MAX_NOTE_LENGTH = 2000;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { eventName, date, venue, eventUrl, contactEmail, note, company } = body as Record<string, unknown>;

  // Honeypot: a hidden field real visitors never fill in. Bots that fill
  // it get a fake success so they don't learn to route around it.
  if (typeof company === "string" && company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const trimmedEventName = typeof eventName === "string" ? eventName.trim() : "";
  const trimmedDate = typeof date === "string" ? date.trim() : "";
  const trimmedVenue = typeof venue === "string" ? venue.trim() : "";
  const trimmedEventUrl = typeof eventUrl === "string" ? eventUrl.trim() : "";
  const trimmedContactEmail = typeof contactEmail === "string" ? contactEmail.trim() : "";
  const trimmedNote = typeof note === "string" ? note.trim() : "";

  if (
    !trimmedEventName ||
    trimmedEventName.length > MAX_FIELD_LENGTH ||
    !trimmedDate ||
    trimmedDate.length > MAX_FIELD_LENGTH ||
    !trimmedVenue ||
    trimmedVenue.length > MAX_FIELD_LENGTH ||
    !isValidHttpUrl(trimmedEventUrl) ||
    !isValidEmail(trimmedContactEmail) ||
    trimmedNote.length > MAX_NOTE_LENGTH
  ) {
    return NextResponse.json(
      {
        error:
          "Please fill in the event name, date, venue, a valid event URL, and a valid contact email.",
      },
      { status: 400 }
    );
  }

  if (isRateLimited(`suggest-event:${getClientIp(request)}`)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  try {
    await sendEmail({
      subject: "[Electronic CPH] Event suggestion",
      replyTo: trimmedContactEmail,
      text: [
        `Event: ${trimmedEventName}`,
        `Date: ${trimmedDate}`,
        `Venue: ${trimmedVenue}`,
        `URL: ${trimmedEventUrl}`,
        `Contact email: ${trimmedContactEmail}`,
        "",
        "Note:",
        trimmedNote || "(none)",
      ].join("\n"),
    });
  } catch (err) {
    console.error("suggest-event form: send failed", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Something went wrong sending your suggestion. Please try again later." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
