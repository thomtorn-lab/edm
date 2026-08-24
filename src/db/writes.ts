import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { discoveryQueue, eventChangeLog, events, sourceEventLinks, venues } from "./schema";
import { venueRowToRecord } from "./mappers";
import { addOverriddenFields, stripOverriddenFields, type EditableEventField } from "../lib/override";
import { assessDuplicate } from "../lib/dedup";
import { planVenueCreation, type NewVenueInput } from "../lib/venueCreation";
import type { ConfidenceLevel, Venue } from "../lib/types";
import type { GenreSlug } from "../lib/taxonomy";

/**
 * All admin/sync write operations go through this module — API routes stay
 * thin, and this is the single place field-level override protection
 * (src/lib/override.ts) actually gets enforced against the database.
 */

function logId(): string {
  return `log-${randomUUID()}`;
}

async function writeChangeLog(
  eventId: string,
  changedBy: string,
  changeType: string,
  fieldsChanged: string[],
  note?: string,
) {
  await db.insert(eventChangeLog).values({
    id: logId(),
    eventId,
    changedBy,
    changeType,
    fieldsChanged,
    note: note ?? null,
  });
}

type EventInsert = typeof events.$inferInsert;
export type EventEditPatch = Partial<Pick<EventInsert, EditableEventField>>;

/**
 * Applies an admin-authored edit: the touched fields are written AND marked
 * as manually overridden, so a later sync (src/lib/sync.ts) can never
 * silently revert them.
 */
export async function applyAdminEventEdit(eventId: string, patch: EventEditPatch) {
  const [existing] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!existing) throw new Error(`Event ${eventId} not found`);

  const touchedFields = Object.keys(patch);
  const overriddenFields = addOverriddenFields(existing.overriddenFields, touchedFields);

  await db
    .update(events)
    .set({
      ...patch,
      overriddenFields,
      manualOverride: true,
      updatedAt: new Date(),
      lastChanged: new Date(),
    })
    .where(eq(events.id, eventId));

  await writeChangeLog(eventId, "admin", "update", touchedFields);
}

export async function setEventPublished(eventId: string, published: boolean) {
  await applyAdminEventEdit(eventId, { published });
  await writeChangeLog(eventId, "admin", published ? "publish" : "unpublish", ["published"]);
}

/**
 * Automated-sync unpublish for an event whose fresh classification is now
 * "hold" on genuine, complete-data negative-relevance evidence (data-quality
 * Workstream A follow-up — existing published events that now resolve to
 * HOLD; see src/lib/sync.ts::decidePublishedEventSyncAction for the decision
 * this authorizes). Deliberately NOT setEventPublished/applyAdminEventEdit:
 * this is a SYNC-driven action, not an admin edit —
 * it must never set manualOverride (that would silently block every future
 * field-level sync patch for this event, via applySourceSyncPatch's own
 * override-stripping) and must never be misattributed as "admin" in the
 * audit trail. Only ever touches `published` on this one row: never deletes
 * it, never touches source_event_links or any other record.
 */
export async function applySyncHoldUnpublish(eventId: string, sourceId: string, reason: string) {
  await db
    .update(events)
    .set({ published: false, updatedAt: new Date(), lastChanged: new Date(), lastSourceCheck: new Date() })
    .where(eq(events.id, eventId));
  await writeChangeLog(eventId, sourceId, "auto_unpublish", ["published"], reason);
}

/**
 * Reverses an unintended manualOverride side effect: clears manualOverride
 * and removes the given field names from overriddenFields, touching nothing
 * else on the row. For correcting a write that went through
 * applyAdminEventEdit/setEventPublished (which always sets manualOverride)
 * when the actual intent was a sync/system-driven correction, not a
 * deliberate editorial decision — e.g. a one-off lifecycle cleanup script
 * that reused setEventPublished for convenience and thereby mis-flagged a
 * stale row as admin-protected. Never touches any other event, never
 * touches provenance (source_event_links).
 */
export async function clearManualOverride(eventId: string, fieldsToUnprotect: string[]) {
  const [existing] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!existing) throw new Error(`Event ${eventId} not found`);

  const overriddenFields = existing.overriddenFields.filter((f) => !fieldsToUnprotect.includes(f));

  await db
    .update(events)
    .set({
      manualOverride: false,
      overriddenFields,
      updatedAt: new Date(),
      lastChanged: new Date(),
    })
    .where(eq(events.id, eventId));

  await writeChangeLog(
    eventId,
    "admin",
    "update",
    ["manualOverride", "overriddenFields"],
    "Corrected unintended manualOverride side effect from a prior write",
  );
}

/**
 * Applies an automated sync's proposed patch, but only to fields the admin
 * hasn't manually corrected — the enforcement point for manual-override
 * protection during real ingestion (task 5/6).
 */
export async function applySourceSyncPatch(
  eventId: string,
  sourceId: string,
  proposedPatch: Record<string, unknown>,
) {
  const [existing] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!existing) throw new Error(`Event ${eventId} not found`);

  const safePatch = stripOverriddenFields(proposedPatch, existing.overriddenFields);
  const skippedFields = Object.keys(proposedPatch).filter((k) => !(k in safePatch));

  if (Object.keys(safePatch).length > 0) {
    await db
      .update(events)
      .set({ ...safePatch, updatedAt: new Date(), lastChanged: new Date(), lastSourceCheck: new Date() })
      .where(eq(events.id, eventId));
  } else {
    await db.update(events).set({ lastSourceCheck: new Date() }).where(eq(events.id, eventId));
  }

  await writeChangeLog(
    eventId,
    sourceId,
    "sync",
    Object.keys(safePatch),
    skippedFields.length > 0 ? `skipped manually-overridden fields: ${skippedFields.join(", ")}` : undefined,
  );

  return { applied: Object.keys(safePatch), skipped: skippedFields };
}

interface NewEventInput {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  artists: string[];
  startDatetime: Date;
  endDatetime: Date | null;
  venueId: string;
  primaryGenre: GenreSlug;
  subgenres: GenreSlug[];
  genreConfidence: ConfidenceLevel;
  officialEventUrl: string | null;
  ticketUrl: string | null;
  facebookUrl: string | null;
  residentAdvisorUrl: string | null;
  imageUrl: string | null;
  priceFrom: number | null;
  currency: "DKK" | null;
  published: boolean;
  confidence: ConfidenceLevel;
  canonicalSourceId: string | null;
}

export async function createEvent(input: NewEventInput, createdBy: string) {
  const now = new Date();
  await db.insert(events).values({
    ...input,
    timezone: "Europe/Copenhagen",
    otherSourceUrls: [],
    soldOut: false,
    cancelled: false,
    dateChanged: false,
    timeChanged: false,
    manualOverride: false,
    overriddenFields: [],
    createdAt: now,
    updatedAt: now,
    lastSourceCheck: now,
    lastChanged: now,
  });
  if (input.canonicalSourceId && input.officialEventUrl) {
    await recordSourceLink(input.id, input.canonicalSourceId, input.officialEventUrl, "official");
  }
  await writeChangeLog(input.id, createdBy, "create", Object.keys(input));
}

export async function recordSourceLink(
  eventId: string,
  sourceId: string,
  sourceUrl: string,
  role: "official" | "ticket" | "facebook" | "resident-advisor" | "other",
) {
  await db
    .insert(sourceEventLinks)
    .values({ eventId, sourceId, sourceUrl, role })
    .onConflictDoNothing();
}

/**
 * Updates the sourceUrl on an EXISTING source_event_links row in place —
 * unlike recordSourceLink (insert-only, onConflictDoNothing), for the rare
 * case where a source's own URL shape for an already-linked event legitimately
 * changes (e.g. Culture Box's one-time room-consolidation transition, which
 * moves an event's canonical link from a per-room #fragment URL to the new
 * per-night base URL so future syncs keep matching it via this table).
 */
export async function updateSourceLinkUrl(
  eventId: string,
  sourceId: string,
  role: "official" | "ticket" | "facebook" | "resident-advisor" | "other",
  newSourceUrl: string,
) {
  await db
    .update(sourceEventLinks)
    .set({ sourceUrl: newSourceUrl })
    .where(and(eq(sourceEventLinks.eventId, eventId), eq(sourceEventLinks.sourceId, sourceId), eq(sourceEventLinks.role, role)));
}

/**
 * Corrects a venue's address in place. Venues are seeded once from
 * src/lib/data/venues.ts at bootstrap and never re-synced from that fixture
 * automatically, so a code-level address correction there does not by
 * itself reach an already-seeded Production/Preview database — this is the
 * one-time write that actually does.
 */
export async function updateVenueAddress(venueId: string, newAddress: string) {
  const [existing] = await db.select().from(venues).where(eq(venues.id, venueId)).limit(1);
  if (!existing) throw new Error(`Venue ${venueId} not found`);
  await db.update(venues).set({ address: newAddress, updatedAt: new Date() }).where(eq(venues.id, venueId));
}

/**
 * Human-gated venue creation (source onboarding follow-up: closing the
 * runtime venue-creation gap — see DiscoveryQueue.tsx's "Create new venue"
 * action). All the actual decision logic — duplicate prevention via the same
 * conservative resolveVenue() normalization, and the Byhaven/Black Box/Red
 * Box sub-venue guard — lives in the pure, unit-tested planVenueCreation();
 * this is only the DB-touching wrapper around it. Never adds the new venue
 * to CURATED_VENUE_SLUGS or /venues — that stays a separate, explicit
 * editorial decision, unaffected by this write.
 */
export class VenueNeedsConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VenueNeedsConfirmationError";
  }
}

export async function createVenue(
  input: NewVenueInput,
  options: { confirmed?: boolean } = {},
): Promise<{ created: boolean; venue: Venue }> {
  const existingRows = await db.select().from(venues);
  const existing = existingRows.map(venueRowToRecord);
  const plan = planVenueCreation(input, existing, options);

  if (plan.kind === "existing") return { created: false, venue: plan.venue };
  if (plan.kind === "needs-confirmation") throw new VenueNeedsConfirmationError(plan.reason);

  const now = new Date();
  try {
    await db.insert(venues).values({ ...plan.venue, createdAt: now, updatedAt: now });
  } catch (err) {
    // Postgres unique_violation (23505) on the slug/id — two different
    // source names that happened to normalize to the same slug. Never
    // silently overwrite; surface it as a clear, actionable error instead of
    // a raw driver exception.
    const cause = err instanceof Error ? err.cause : undefined;
    const code = (cause as { code?: string } | undefined)?.code ?? (err as { code?: string } | undefined)?.code;
    if (code === "23505") {
      throw new Error(`A venue with a conflicting identity already exists (slug "${plan.venue.slug}"). Use a more specific name.`);
    }
    throw err;
  }
  return { created: true, venue: plan.venue };
}

// ---- Discovery queue actions ----

export async function publishDiscoveryItem(queueId: string, resolvedVenueId: string) {
  const [item] = await db.select().from(discoveryQueue).where(eq(discoveryQueue.id, queueId)).limit(1);
  if (!item) throw new Error(`Discovery item ${queueId} not found`);
  if (item.status !== "pending") throw new Error(`Discovery item ${queueId} already ${item.status}`);
  if (!item.probableStart) throw new Error("Cannot publish without a resolved date/time");

  const eventId = `e-${randomUUID().slice(0, 8)}`;
  const slug = `${item.probableTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${eventId}`;

  await createEvent(
    {
      id: eventId,
      title: item.probableTitle,
      slug,
      description: null,
      artists: item.detectedLineup,
      startDatetime: item.probableStart,
      endDatetime: item.probableEnd,
      venueId: resolvedVenueId,
      primaryGenre: (item.predictedGenre as GenreSlug) ?? "electronic-other",
      subgenres: item.predictedGenre ? [item.predictedGenre as GenreSlug] : [],
      genreConfidence: item.genreConfidence as ConfidenceLevel,
      officialEventUrl: item.sourceUrl,
      ticketUrl: item.probableTicketUrl,
      facebookUrl: item.sourceUrl.includes("facebook.com") ? item.sourceUrl : null,
      residentAdvisorUrl: item.sourceUrl.includes("ra.co") ? item.sourceUrl : null,
      imageUrl: null,
      // Explicit FREE flag (never inferred from ticketUrl's absence) — same
      // canonical priceFrom=0 representation as EventManager's own Free
      // checkbox (src/lib/links.ts). Unset means "not marked free" (unknown
      // price), never a guessed default.
      priceFrom: item.probableFree ? 0 : null,
      currency: item.probableFree ? "DKK" : null,
      published: true,
      confidence: item.overallConfidence as ConfidenceLevel,
      // Provenance is persisted immediately here (via createEvent's own
      // recordSourceLink call, triggered whenever canonicalSourceId +
      // officialEventUrl are both set) rather than left for a later sync to
      // reconstruct via fuzzy matching.
      canonicalSourceId: item.sourceId,
    },
    "admin",
  );

  await db
    .update(discoveryQueue)
    .set({ status: "published", resolvedAt: new Date() })
    .where(eq(discoveryQueue.id, queueId));

  return eventId;
}

export async function ignoreDiscoveryItem(queueId: string) {
  await db
    .update(discoveryQueue)
    .set({ status: "ignored", resolvedAt: new Date() })
    .where(eq(discoveryQueue.id, queueId));
}

/** Merges a discovery item into an existing event, preserving provenance instead of discarding it. */
export async function mergeDiscoveryItem(queueId: string, targetEventId: string) {
  const [item] = await db.select().from(discoveryQueue).where(eq(discoveryQueue.id, queueId)).limit(1);
  if (!item) throw new Error(`Discovery item ${queueId} not found`);
  const [target] = await db.select().from(events).where(eq(events.id, targetEventId)).limit(1);
  if (!target) throw new Error(`Target event ${targetEventId} not found`);

  const otherSourceUrls = Array.from(new Set([...target.otherSourceUrls, item.sourceUrl]));
  await db
    .update(events)
    .set({ otherSourceUrls, updatedAt: new Date() })
    .where(eq(events.id, targetEventId));

  // Only record a source link when this discovery item actually came from a
  // registered source — recordSourceLink's sourceId is a NOT NULL FK into
  // `sources`, so a fabricated id here (as a previous version of this
  // function used) would throw on every merge of an admin-pasted item.
  if (item.sourceId) {
    await recordSourceLink(targetEventId, item.sourceId, item.sourceUrl, "other");
  }
  await writeChangeLog(targetEventId, "admin", "merge", ["otherSourceUrls"], `merged discovery item ${queueId}`);

  await db
    .update(discoveryQueue)
    .set({ status: "merged", resolvedAt: new Date(), suspectedDuplicateOfEventId: targetEventId })
    .where(eq(discoveryQueue.id, queueId));
}

export interface DiscoveryEditPatch {
  probableTitle?: string;
  probableStart?: Date | null;
  probableEnd?: Date | null;
  probableTicketUrl?: string | null;
  probableFree?: boolean;
  probableVenueName?: string | null;
  detectedLineup?: string[];
  predictedGenre?: GenreSlug | null;
}

/**
 * Lets an admin fill in fields a generic extraction couldn't determine (date,
 * venue, lineup) before publishing. Touched fields are recorded in
 * overriddenFields (mirrors applyAdminEventEdit for events) so a later sync's
 * refreshed classification (buildDiscoveryQueueClassificationPatch) can never
 * silently revert a hand-correction — most importantly, an admin-set
 * predictedGenre.
 */
export async function updateDiscoveryItem(id: string, patch: DiscoveryEditPatch) {
  const [existing] = await db.select().from(discoveryQueue).where(eq(discoveryQueue.id, id)).limit(1);
  if (!existing) throw new Error(`Discovery item ${id} not found`);
  if (existing.status !== "pending") throw new Error(`Discovery item ${id} already ${existing.status}`);

  const missingFields = existing.missingFields.filter((f) => {
    if (f.startsWith("date") && patch.probableStart) return false;
    if (f.startsWith("venue") && patch.probableVenueName) return false;
    if (f.startsWith("title") && patch.probableTitle) return false;
    return true;
  });

  const overriddenFields = addOverriddenFields(existing.overriddenFields, Object.keys(patch));

  await db
    .update(discoveryQueue)
    .set({ ...patch, missingFields, overriddenFields })
    .where(eq(discoveryQueue.id, id));
}

/**
 * Applies a later sync's refreshed genre classification
 * (buildDiscoveryQueueClassificationPatch) to an existing pending
 * discovery_queue row — never creates a row, never touches status or any
 * identity field. The status='pending' guard is belt-and-suspenders against
 * an admin resolving the item (publish/ignore/merge) between this sync's read
 * and this write; a no-op patch is skipped entirely rather than issuing an
 * empty UPDATE.
 */
export async function applyDiscoveryClassificationUpdate(
  queueId: string,
  patch: { predictedGenre?: GenreSlug; genreConfidence?: ConfidenceLevel; overallConfidence?: ConfidenceLevel },
) {
  if (Object.keys(patch).length === 0) return;
  await db
    .update(discoveryQueue)
    .set(patch)
    .where(and(eq(discoveryQueue.id, queueId), eq(discoveryQueue.status, "pending")));
}

/**
 * Resolves a pending discovery_queue row as "published" without creating a
 * new event — used when a later sync's auto_publish decision creates the
 * event directly (src/db/sync.ts), for a candidate that already had a
 * pending row from an earlier, lower-confidence sync. Mirrors exactly the
 * status transition publishDiscoveryItem makes for an admin-initiated
 * publish (status "published", resolvedAt set); only the discoveryQueue
 * side of that transition happens here, since the event itself is already
 * created by the caller. The status='pending' guard mirrors
 * applyDiscoveryClassificationUpdate's — never resolves a row an admin
 * already acted on (published/ignored/merged) between this sync's read and
 * this write.
 */
export async function resolveDiscoveryItemAsPublished(queueId: string) {
  await db
    .update(discoveryQueue)
    .set({ status: "published", resolvedAt: new Date() })
    .where(and(eq(discoveryQueue.id, queueId), eq(discoveryQueue.status, "pending")));
}

export async function insertDiscoveryItem(item: {
  id: string;
  probableTitle: string;
  probableStart: Date | null;
  probableEnd?: Date | null;
  probableTicketUrl?: string | null;
  probableFree?: boolean;
  probableVenueName: string | null;
  sourceName: string;
  sourceUrl: string;
  /** Registered source (e.g. "src-hangaren") this candidate came from, so
   *  publishing later can persist provenance immediately. Omit/null for
   *  candidates with no registered source (e.g. admin "Add event from URL"). */
  sourceId?: string | null;
  detectedLineup: string[];
  predictedGenre: GenreSlug | null;
  genreConfidence: ConfidenceLevel;
  suspectedDuplicateOfEventId: string | null;
  missingFields: string[];
  overallConfidence: ConfidenceLevel;
}) {
  await db.insert(discoveryQueue).values({ ...item, status: "pending" });
}

/** Finds the strongest duplicate among currently published events, for merge suggestions. */
export async function findDuplicateEventId(
  candidate: {
    title: string;
    artists: string[];
    venueId: string | null;
    startDatetime: string;
    sourceId?: string | null;
    officialEventUrl?: string | null;
    ticketUrl?: string | null;
    residentAdvisorUrl?: string | null;
  },
): Promise<string | null> {
  const rows = await db.select().from(events).where(eq(events.published, true));
  let best: { id: string; confidence: string } | null = null;
  for (const row of rows) {
    const assessment = assessDuplicate(candidate, {
      title: row.title,
      artists: row.artists,
      venueId: row.venueId,
      startDatetime: row.startDatetime.toISOString(),
      sourceId: row.canonicalSourceId,
      officialEventUrl: row.officialEventUrl,
      ticketUrl: row.ticketUrl,
      residentAdvisorUrl: row.residentAdvisorUrl,
    });
    if (assessment.confidence === "none") continue;
    if (!best || rank(assessment.confidence) > rank(best.confidence)) {
      best = { id: row.id, confidence: assessment.confidence };
    }
  }
  return best?.id ?? null;
}

function rank(c: string): number {
  return { high: 3, medium: 2, low: 1, none: 0 }[c] ?? 0;
}

export async function touchSourceSyncStats(
  sourceId: string,
  outcome: { success: boolean; eventsFound?: number; eventsUpdated?: number; error?: string | null },
) {
  const now = new Date();
  const { sources } = await import("./schema");
  if (outcome.success) {
    await db
      .update(sources)
      .set({
        lastSuccessfulSync: now,
        lastAttemptedSync: now,
        // Usually cleared on a clean success — but a partial-failure run
        // (fetch succeeded, some candidates failed to write) is still
        // "success" for stats purposes and must keep its error visible
        // rather than being wiped, so source health monitoring can see it.
        lastError: outcome.error ?? null,
        eventsFound: outcome.eventsFound ?? sql`events_found`,
        eventsUpdated: outcome.eventsUpdated ?? sql`events_updated`,
      })
      .where(eq(sources.id, sourceId));
  } else {
    await db
      .update(sources)
      .set({ lastAttemptedSync: now, lastError: outcome.error ?? "Unknown sync failure" })
      .where(eq(sources.id, sourceId));
  }
}
