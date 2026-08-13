import { NextRequest, NextResponse } from "next/server";
import { VENUES } from "@/lib/data/venues";
import { getPublishedEventsWithVenue } from "@/lib/queries";
import { runIngestionPipeline } from "@/lib/adapters/pipeline";
import type { RawCandidateEvent } from "@/lib/adapters/types";

/**
 * Best-effort metadata extraction for the "Add event from URL" admin tool
 * (spec section 33). This only reads the public Open Graph / title tags of
 * a page an admin explicitly pastes in — it is not a crawler and is not
 * wired to run on a schedule against any source. Structured fields OG
 * cannot reliably provide (date, venue, lineup) are left blank rather than
 * guessed, so the quality gate correctly routes the result to review.
 */

function extractMeta(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const match = html.match(re);
  return match ? match[1].trim() : null;
}

function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : null;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url.trim() : "";

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Enter a valid URL." }, { status: 400 });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ error: "Only http/https URLs are supported." }, { status: 400 });
  }

  let html = "";
  try {
    const res = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; NattefrekvensAdminTool/1.0)" },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Source responded with ${res.status}.` }, { status: 502 });
    }
    html = await res.text();
  } catch {
    return NextResponse.json({ error: "Could not retrieve that URL." }, { status: 502 });
  }

  const title = extractMeta(html, "og:title") ?? extractTitleTag(html);
  const description = extractMeta(html, "og:description");
  const image = extractMeta(html, "og:image");

  const raw: RawCandidateEvent = {
    sourceId: "admin-paste",
    sourceUrl: parsed.toString(),
    title: title ?? "",
    description,
    artists: [],
    startDatetime: null,
    endDatetime: null,
    venueName: null,
    officialEventUrl: parsed.toString(),
    ticketUrl: null,
    facebookUrl: parsed.hostname.includes("facebook.com") ? parsed.toString() : null,
    residentAdvisorUrl: parsed.hostname.includes("ra.co") ? parsed.toString() : null,
    imageUrl: image,
    priceFrom: null,
    genreHint: null,
    genreConfidenceHint: null,
  };

  const existing = getPublishedEventsWithVenue().map((e) => ({
    id: e.id,
    title: e.title,
    artists: e.artists,
    venueId: e.venueId,
    startDatetime: e.startDatetime,
  }));

  const result = runIngestionPipeline(raw, { venues: VENUES, existingEvents: existing });

  return NextResponse.json({ raw, result });
}
