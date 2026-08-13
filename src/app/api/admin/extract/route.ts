import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getPublishedEventsWithVenue, getVenues } from "@/lib/queries";
import { runIngestionPipeline } from "@/lib/adapters/pipeline";
import { createEvent, insertDiscoveryItem } from "@/db/writes";
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

  const [venues, publishedEvents] = await Promise.all([getVenues(), getPublishedEventsWithVenue()]);
  const existing = publishedEvents.map((e) => ({
    id: e.id,
    title: e.title,
    artists: e.artists,
    venueId: e.venueId,
    startDatetime: e.startDatetime,
  }));

  const result = runIngestionPipeline(raw, { venues, existingEvents: existing });

  // Persist immediately, per the quality gate's decision — a page refresh
  // must not lose the analysis, and the review queue is where the admin
  // actually acts on it (spec section 33-35).
  if (result.decision === "auto_publish" && result.resolvedVenueId && raw.startDatetime) {
    const eventId = `e-${randomUUID().slice(0, 8)}`;
    const slug = `${(raw.title || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${eventId}`;
    await createEvent(
      {
        id: eventId,
        title: raw.title,
        slug,
        description: raw.description,
        artists: result.normalizedArtists,
        startDatetime: new Date(raw.startDatetime),
        endDatetime: raw.endDatetime ? new Date(raw.endDatetime) : null,
        venueId: result.resolvedVenueId,
        primaryGenre: result.genre ?? "electronic-other",
        subgenres: result.genre ? [result.genre] : [],
        genreConfidence: result.genreConfidence,
        officialEventUrl: raw.officialEventUrl,
        ticketUrl: raw.ticketUrl,
        facebookUrl: raw.facebookUrl,
        residentAdvisorUrl: raw.residentAdvisorUrl,
        imageUrl: raw.imageUrl,
        priceFrom: raw.priceFrom,
        currency: raw.priceFrom != null ? "DKK" : null,
        published: true,
        confidence: result.genreConfidence,
        canonicalSourceId: null,
      },
      "admin-paste",
    );
    return NextResponse.json({ raw, result, persisted: { kind: "event", id: eventId } });
  }

  const queueId = `dq-${randomUUID().slice(0, 8)}`;
  await insertDiscoveryItem({
    id: queueId,
    probableTitle: raw.title || "(untitled)",
    probableStart: raw.startDatetime ? new Date(raw.startDatetime) : null,
    probableVenueName: raw.venueName,
    sourceName: "Admin: Add event from URL",
    sourceUrl: raw.sourceUrl,
    detectedLineup: result.normalizedArtists,
    predictedGenre: result.genre,
    genreConfidence: result.genreConfidence,
    suspectedDuplicateOfEventId: result.duplicateOfEventId,
    missingFields: result.missingFields,
    overallConfidence: result.decision === "review_queue" ? "medium" : "low",
  });

  return NextResponse.json({ raw, result, persisted: { kind: "discovery", id: queueId } });
}
