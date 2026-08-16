import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { isValidEmail } from "@/lib/validation";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";

const MAX_NAME_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 5000;

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

  const { name, email, message, company } = body as Record<string, unknown>;

  // Honeypot: a hidden field real visitors never fill in. Bots that fill
  // it get a fake success so they don't learn to route around it.
  if (typeof company === "string" && company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  const trimmedMessage = typeof message === "string" ? message.trim() : "";

  if (
    !trimmedName ||
    trimmedName.length > MAX_NAME_LENGTH ||
    !isValidEmail(trimmedEmail) ||
    !trimmedMessage ||
    trimmedMessage.length > MAX_MESSAGE_LENGTH
  ) {
    return NextResponse.json(
      { error: "Please fill in your name, a valid email, and a message." },
      { status: 400 }
    );
  }

  if (isRateLimited(`contact:${getClientIp(request)}`)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  try {
    await sendEmail({
      subject: "[Electronic CPH] Contact",
      replyTo: trimmedEmail,
      text: `Name: ${trimmedName}\nEmail: ${trimmedEmail}\n\n${trimmedMessage}`,
    });
  } catch (err) {
    console.error("contact form: send failed", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Something went wrong sending your message. Please try again later." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
