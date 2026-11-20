import { NextRequest, NextResponse } from "next/server";
import { runDailyLinks } from "@/db/dailyLinks";
import { rejectUnauthorizedScheduledRequest } from "@/lib/scheduledRequestAuth";

/**
 * Daily SoundCloud/YouTube links for upcoming published events (2026-11-20).
 * GET is Vercel Cron's call (vercel.json, once a day); POST allows a manual
 * run with the same auth (rejectUnauthorizedScheduledRequest). The job stops
 * starting new lookups well before maxDuration and leaves the rest for the
 * next day (src/db/dailyLinks.ts). The response holds the report only:
 * counts, new links and errors — no secrets, no email addresses.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  const rejected = rejectUnauthorizedScheduledRequest(request);
  if (rejected) return rejected;
  try {
    return NextResponse.json(await runDailyLinks());
  } catch (err) {
    console.error(`[daily-links] run failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "Daily links run failed." }, { status: 500 });
  }
}
