import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAllEventsAdmin, getDiscoveryQueueForAdmin, getVenues } from "@/lib/queries";
import { runIngestionPipeline } from "@/lib/adapters/pipeline";
import { createEvent, insertDiscoveryItem } from "@/db/writes";
import { notifyDiscoveryQueueInsert } from "@/lib/discoveryNotification";
import { classifyAdminQueueRow, mapPendingDiscoveryQueueForDedup } from "@/lib/adminQueue";
import { findBestDuplicateMatch } from "@/lib/dedup";
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
    // Facebook decision (unified event create/edit model, 2026-09-08):
    // Facebook is no longer a distinct public link role (src/lib/links.ts) —
    // a pasted Facebook event URL is already carried as officialEventUrl
    // above, so setting facebookUrl here too would only ever duplicate it.
    facebookUrl: null,
    residentAdvisorUrl: parsed.hostname.includes("ra.co") ? parsed.toString() : null,
    imageUrl: image,
    priceFrom: null,
    genreHint: null,
    genreConfidenceHint: null,
  };

  const [venues, allEvents, discoveryRows] = await Promise.all([getVenues(), getAllEventsAdmin(), getDiscoveryQueueForAdmin()]);
  const existing = allEvents.map((e) => ({
    id: e.id,
    title: e.title,
    artists: e.artists,
    venueId: e.venueId,
    startDatetime: e.startDatetime,
    adminUnpublished: e.adminUnpublishReason != null,
  }));

  const result = runIngestionPipeline(raw, { venues, existingEvents: existing });

  // Duplicate-DQ-candidate check (unified event create/edit model,
  // 2026-09-08 — Karrusel 2027 gap): runIngestionPipeline's own dedup only
  // ever sees canonical `events` rows (via `existing` above) — a pending
  // discovery_queue candidate was structurally invisible to it. This is a
  // SEPARATE, second check against pending DQ rows, surfaced as its own
  // field (never conflated with result.duplicateOfEventId, which has real
  // merge semantics against a canonical event id — merging into a DQ row
  // isn't a supported operation). Warning only; never auto-merged.
  const duplicateDiscoveryQueueMatch = raw.startDatetime
    ? findBestDuplicateMatch(
        {
          title: raw.title,
          artists: result.normalizedArtists,
          venueId: result.resolvedVenueId,
          subVenue: result.resolvedSubVenue,
          startDatetime: raw.startDatetime,
          sourceId: raw.sourceId,
          officialEventUrl: raw.officialEventUrl,
          ticketUrl: raw.ticketUrl,
          residentAdvisorUrl: raw.residentAdvisorUrl,
        },
        mapPendingDiscoveryQueueForDedup(discoveryRows, venues),
      )
    : null;
  const duplicateDiscoveryQueueId = duplicateDiscoveryQueueMatch?.match.id ?? null;

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
        subVenue: result.resolvedSubVenue,
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
        soldOut: raw.soldOutHint ?? false,
        cancelled: raw.cancelledHint ?? false,
        published: true,
        confidence: result.genreConfidence,
        canonicalSourceId: null,
      },
      "admin-paste",
    );
    return NextResponse.json({ raw, result, persisted: { kind: "event", id: eventId }, duplicateDiscoveryQueueId });
  }

  const now = new Date();
  const queueId = `dq-${randomUUID().slice(0, 8)}`;
  const overallConfidence =
    result.decision === "auto_publish" ? "high" : result.decision === "review_queue" ? "medium" : "low";
  const inserted = await insertDiscoveryItem({
    id: queueId,
    probableTitle: raw.title || "(untitled)",
    probableStart: raw.startDatetime ? new Date(raw.startDatetime) : null,
    probableEnd: raw.endDatetime ? new Date(raw.endDatetime) : null,
    probableTicketUrl: raw.ticketUrl,
    // Unified event create/edit model (2026-09-08): Analyze's own extraction
    // already found this — previously discarded before ever reaching the
    // queue row, forcing the admin to retype a URL the system already had.
    probableOfficialEventUrl: raw.officialEventUrl,
    probableResidentAdvisorUrl: raw.residentAdvisorUrl,
    description: raw.description,
    probableFree: raw.priceFrom === 0,
    probableVenueName: raw.venueName,
    probableSubVenue: result.resolvedSubVenue,
    sourceName: "Admin: Add event from URL",
    sourceUrl: raw.sourceUrl,
    detectedLineup: result.normalizedArtists,
    predictedGenre: result.genre,
    genreConfidence: result.genreConfidence,
    suspectedDuplicateOfEventId: result.duplicateOfEventId,
    missingFields: result.missingFields,
    overallConfidence,
    lastSeenAt: now,
    venueResolvedDecision: result.venueResolvedCounterfactual?.decision ?? null,
    venueResolvedHoldReason: result.venueResolvedCounterfactual?.holdReason,
    holdReason: result.holdReason,
  });

  // Single item, not a batch — safe to await directly (never throws; see
  // notifyDiscoveryQueueInsert).
  await notifyDiscoveryQueueInsert(inserted);

  // Bucket handoff (unified event create/edit model, 2026-09-08 — Section
  // 10/5): classifyAdminQueueRow is the SAME single source of truth
  // admin/page.tsx uses for the 5 pending-row tabs — reused here rather than
  // re-deriving bucket logic, so this can never disagree with which tab the
  // row actually renders in. sourceId: null (this row has none — admin
  // "Add event from URL" is never a registered source) is what makes
  // classifyAdminQueueRow route it through its own admin-originated-row
  // handling: NEEDS_REVIEW regardless of missing date/venue/other fields,
  // never PAST_STALE merely because there's no source to compare freshness
  // against — see that function's own doc comment for the addendum this
  // fixes (an Analyze-created row previously landed in "Past / stale"
  // unconditionally, the least likely tab for an admin to check right after
  // using the tool that just created it). lastCompleteSyncAt here is
  // consequently unused for this row, but still passed for shape parity
  // with every other caller.
  const category = classifyAdminQueueRow(
    {
      overallConfidence: inserted.overallConfidence,
      holdReason: result.holdReason,
      venueResolvedDecision: result.venueResolvedCounterfactual?.decision ?? null,
      missingFields: inserted.missingFields,
      probableStart: raw.startDatetime,
      probableEnd: raw.endDatetime,
      lastSeenAt: now.toISOString(),
      sourceId: null,
    },
    { lastCompleteSyncAt: null, now },
  );

  return NextResponse.json({
    raw,
    result,
    persisted: { kind: "discovery", id: queueId },
    category,
    duplicateDiscoveryQueueId,
  });
}
