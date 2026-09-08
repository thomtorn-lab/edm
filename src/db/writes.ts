import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { discoveryQueue, eventChangeLog, events, sourceEventLinks, venues } from "./schema";
import { venueRowToRecord } from "./mappers";
import { addOverriddenFields, stripOverriddenFields, type EditableEventField } from "../lib/override";
import { assessDuplicate } from "../lib/dedup";
import { planVenueCreation, type NewVenueInput } from "../lib/venueCreation";
import type { DiscoveryQueueNotificationItem } from "../lib/discoveryNotification";
import type { AdminUnpublishReason, ConfidenceLevel, Venue } from "../lib/types";
import type { GenreSlug } from "../lib/taxonomy";
import type { PublishDecision } from "../lib/classification";
import type { HoldReason } from "../lib/adapters/pipeline";

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
 *
 * This is the single write funnel every "published" edit reaches —
 * setEventPublished's own {published} patch, and the generic admin PATCH
 * route (EDITABLE_EVENT_FIELDS still lists "published", kept for
 * setEventPublished's own type-constrained call and two historical
 * one-off scripts that call it directly) both go through here. Admin
 * unpublish/cancellation safety, 2026-09-06: a plain {published: true}
 * edit reaching this function must never leave a STALE
 * adminUnpublishReason behind — that would silently re-expose an
 * admin-cancelled event on the public site (published=true) while every
 * other admin-unpublish-aware code path still reads it as unpublished,
 * a broken, self-contradictory state. Whenever this patch sets
 * published=true on a row that's still admin-unpublished, this clears the
 * override in the SAME write, exactly as adminRepublishEvent's own
 * dedicated "Publish Again" path does — so the invariant "published=true
 * implies adminUnpublishReason=null" holds regardless of which route
 * reaches this function.
 */
export async function applyAdminEventEdit(eventId: string, patch: EventEditPatch) {
  const [existing] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!existing) throw new Error(`Event ${eventId} not found`);

  const touchedFields = Object.keys(patch);
  const overriddenFields = addOverriddenFields(existing.overriddenFields, touchedFields);
  const clearsAdminUnpublish = patch.published === true && existing.adminUnpublishReason != null;

  await db
    .update(events)
    .set({
      ...patch,
      ...(clearsAdminUnpublish ? { adminUnpublishReason: null, adminUnpublishNote: null, adminUnpublishedAt: null } : {}),
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
 * Explicit, reason-tracked admin unpublish (admin unpublish/cancellation
 * safety, 2026-09-06) — the sanctioned path for the admin UI's UNPUBLISH
 * action, superseding the bare setEventPublished(id, false) the UI used
 * before this feature (setEventPublished itself is kept only for the
 * existing one-time Production correction scripts that already call it —
 * see tonserCleanup.ts/cultureBoxRoomConsolidation.ts — never delete a
 * function a historical script still depends on).
 *
 * Sets published=false AND stamps adminUnpublishReason/adminUnpublishedAt
 * — the persistent override every automated publish path (pipeline.ts's
 * computeDecision, publishDiscoveryItem below) now checks before ever
 * creating a new published row that might be the same real-world event.
 * Also sets manualOverride/overriddenFields exactly like any other admin
 * edit (src/lib/override.ts), so a routine field-level sync patch on this
 * event is protected too — belt-and-suspenders alongside the dedicated
 * adminUnpublishReason check, never a substitute for it (manualOverride
 * alone was never reason-specific — see the schema column's own comment).
 * Never deletes the event, never touches source_event_links or any other
 * record.
 */
export async function adminUnpublishEvent(eventId: string, reason: AdminUnpublishReason, note?: string | null) {
  const [existing] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!existing) throw new Error(`Event ${eventId} not found`);

  const overriddenFields = addOverriddenFields(existing.overriddenFields, ["published"]);
  const now = new Date();
  const trimmedNote = note?.trim();

  await db
    .update(events)
    .set({
      published: false,
      adminUnpublishReason: reason,
      adminUnpublishNote: trimmedNote ? trimmedNote : null,
      adminUnpublishedAt: now,
      manualOverride: true,
      overriddenFields,
      updatedAt: now,
      lastChanged: now,
    })
    .where(eq(events.id, eventId));

  await writeChangeLog(
    eventId,
    "admin",
    "admin_unpublish",
    ["published", "adminUnpublishReason"],
    trimmedNote ? `reason: ${reason}; note: ${trimmedNote}` : `reason: ${reason}`,
  );
}

/**
 * "Publish Again" — clears the admin-unpublish override and republishes.
 * Safe to call on an event that was never admin-unpublished (e.g. one
 * auto-unpublished by applySyncHoldUnpublish, or never unpublished at
 * all): adminUnpublishReason is simply left/set to null and published set
 * to true either way, matching the ordinary "Publish"/"Unhide" behavior
 * those events already had (no admin-override-specific requirement blocks
 * this path — see EventManager.tsx). Only ever removes "published" from
 * overriddenFields, keeping any other hand-corrected field's protection
 * intact; manualOverride is recomputed from whatever remains.
 */
export async function adminRepublishEvent(eventId: string) {
  const [existing] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!existing) throw new Error(`Event ${eventId} not found`);

  const overriddenFields = existing.overriddenFields.filter((f) => f !== "published");
  const now = new Date();

  await db
    .update(events)
    .set({
      published: true,
      adminUnpublishReason: null,
      adminUnpublishNote: null,
      adminUnpublishedAt: null,
      manualOverride: overriddenFields.length > 0,
      overriddenFields,
      updatedAt: now,
      lastChanged: now,
    })
    .where(eq(events.id, eventId));

  await writeChangeLog(eventId, "admin", "admin_republish", ["published", "adminUnpublishReason"]);
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
 * Automated-sync unpublish for a TRUSTED source's explicit cancellation
 * signal (source-driven cancellation safety, 2026-09-07 — see
 * src/lib/sync.ts::decideSourceCancellationSyncAction, the only decision
 * this write authorizes). Deliberately NOT applyAdminEventEdit/
 * adminUnpublishEvent: this is a sync-driven action, never an admin edit —
 * it must never set manualOverride/adminUnpublishReason, both of which are
 * reserved for an admin's own decision (see adminUnpublishReason's own
 * schema doc comment: "admin and source cancellation are different
 * concepts"). Stamps sourceCancelledAt/sourceCancelledBySourceId/
 * sourceCancellationEvidence — the provenance a later "same source
 * explicitly reverses" restore (applySourceCancellationRestore below) and
 * the admin UI both depend on. Only ever touches this one row: never
 * deletes it, never touches source_event_links or any other record.
 */
export async function applySourceCancellationUnpublish(eventId: string, sourceId: string, evidence: string | null) {
  const now = new Date();
  await db
    .update(events)
    .set({
      published: false,
      sourceCancelledAt: now,
      sourceCancelledBySourceId: sourceId,
      sourceCancellationEvidence: evidence,
      updatedAt: now,
      lastChanged: now,
      lastSourceCheck: now,
    })
    .where(eq(events.id, eventId));
  await writeChangeLog(
    eventId,
    sourceId,
    "auto_unpublish",
    ["published", "sourceCancelledAt", "sourceCancelledBySourceId"],
    evidence ? `Source-driven cancellation (trusted source): ${evidence}` : "Source-driven cancellation (trusted source)",
  );
}

/**
 * Automated-sync restore — the one reversal path
 * decideSourceCancellationSyncAction authorizes as "restore": the SAME
 * trusted source that caused sourceCancelledAt (never a different one) has
 * now explicitly reported cancelledHint:false for this exact event, and it
 * was never admin-unpublished in the meantime (that precondition is
 * decideSourceCancellationSyncAction's, enforced before this is ever
 * called). Clears all three source-cancellation fields together — never
 * left partially set — and republishes. Never sets manualOverride/
 * overriddenFields (a sync-driven action, not an admin edit, same
 * convention as applySyncHoldUnpublish/applySourceCancellationUnpublish).
 */
export async function applySourceCancellationRestore(eventId: string, sourceId: string) {
  const now = new Date();
  await db
    .update(events)
    .set({
      published: true,
      sourceCancelledAt: null,
      sourceCancelledBySourceId: null,
      sourceCancellationEvidence: null,
      updatedAt: now,
      lastChanged: now,
      lastSourceCheck: now,
    })
    .where(eq(events.id, eventId));
  await writeChangeLog(
    eventId,
    sourceId,
    "auto_publish",
    ["published", "sourceCancelledAt", "sourceCancelledBySourceId"],
    "Same trusted source that reported this event cancelled has now explicitly reversed that signal",
  );
}

/**
 * Explicit admin override of an ACTIVE trusted source cancellation (source-
 * driven cancellation safety, 2026-09-07, Section 5: "block republish while
 * trusted cancellation remains active OR require an explicit admin override
 * acknowledging the cancellation" — this implements the second option).
 * Distinct from adminRepublishEvent: that function reverses an admin's OWN
 * prior unpublish decision (adminUnpublishReason) and is safe to call
 * unconditionally; this one is for an event the SYSTEM unpublished due to a
 * source's cancellation signal, which the admin is choosing to override
 * because they judge the source's signal wrong/stale. Sets manualOverride/
 * overriddenFields (["published"]) so the very next sync — the source may
 * well still report cancelledHint:true — can never silently re-unpublish
 * this event out from under the admin's explicit decision (mirrors
 * decideSourceCancellationSyncAction's own manualOverride check). Clears
 * the source-cancellation tracking fields since they no longer describe the
 * event's current (admin-overridden) state.
 */
export async function adminOverrideSourceCancellation(eventId: string) {
  const [existing] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!existing) throw new Error(`Event ${eventId} not found`);

  const overriddenFields = addOverriddenFields(existing.overriddenFields, ["published"]);
  const now = new Date();

  await db
    .update(events)
    .set({
      published: true,
      sourceCancelledAt: null,
      sourceCancelledBySourceId: null,
      sourceCancellationEvidence: null,
      manualOverride: true,
      overriddenFields,
      updatedAt: now,
      lastChanged: now,
    })
    .where(eq(events.id, eventId));

  await writeChangeLog(
    eventId,
    "admin",
    "admin_override_source_cancellation",
    ["published", "sourceCancelledAt"],
    "Admin explicitly overrode an active trusted source cancellation",
  );
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
  /** Which room/stage of venueId this event is at (generalized sub-venue model, 2026-09-06). Null when not applicable/unknown. */
  subVenue: string | null;
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
  /**
   * Explicit sold-out/cancelled state at creation time (event
   * lifecycle/status handling, 2026-08-28) — callers pass the source's own
   * hint (raw.soldOutHint/cancelledHint) when creating from a sync
   * candidate, defaulting to false via `?? false` at the call site when the
   * source gives no signal. Almost always false for a brand-new event.
   */
  soldOut: boolean;
  cancelled: boolean;
  published: boolean;
  confidence: ConfidenceLevel;
  canonicalSourceId: string | null;
  /**
   * Provenance URL for source_event_links (admin + public link integrity,
   * 2026-09-08) — the source's OWN discovery-page URL, decoupled from
   * `officialEventUrl` above. Before this, `createEvent`'s provenance write
   * always reused `officialEventUrl` itself, which was safe only because
   * every caller happened to set officialEventUrl to the source's own URL
   * (publishDiscoveryItem's old unconditional `item.sourceUrl`). Now that
   * publishDiscoveryItem can set officialEventUrl to a DIFFERENT,
   * admin-entered URL, provenance must keep recording what the source
   * actually served, never a human's own edit — see Section 7 of the
   * KultuNaut link-integrity audit. Falls back to officialEventUrl when
   * omitted, preserving every other existing caller's behavior exactly.
   */
  provenanceUrl?: string | null;
  /**
   * Seeds the new event's own overriddenFields (admin + public link
   * integrity, 2026-09-08) — lets a caller (publishDiscoveryItem) carry
   * forward which fields an admin already hand-corrected at the Discovery
   * Queue stage (e.g. a manually-entered officialEventUrl/ticketUrl) so a
   * later sync can never silently overwrite them, exactly like every other
   * post-publish admin edit already protects via applyAdminEventEdit.
   * Defaults to [] (createEvent's prior, unconditional behavior) when
   * omitted.
   */
  overriddenFields?: string[];
}

export async function createEvent(input: NewEventInput, createdBy: string) {
  const now = new Date();
  const { provenanceUrl, overriddenFields, ...eventFields } = input;
  await db.insert(events).values({
    ...eventFields,
    timezone: "Europe/Copenhagen",
    otherSourceUrls: [],
    // postponed is never known at creation time — no source has evidence
    // for it, and a brand-new event can't already be "postponed" (that
    // requires a prior normal state); admin-only via applyAdminEventEdit.
    postponed: false,
    dateChanged: false,
    timeChanged: false,
    manualOverride: (overriddenFields?.length ?? 0) > 0,
    overriddenFields: overriddenFields ?? [],
    createdAt: now,
    updatedAt: now,
    lastSourceCheck: now,
    lastChanged: now,
  });
  const provenance = provenanceUrl ?? input.officialEventUrl;
  if (input.canonicalSourceId && provenance) {
    await recordSourceLink(input.id, input.canonicalSourceId, provenance, "official");
  }
  await writeChangeLog(input.id, createdBy, "create", Object.keys(eventFields));
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
 * Corrects a venue's postal code in place (venue coverage expansion
 * follow-up, 2026-08-29) — a narrow sibling to updateVenueAddress for the
 * case where an address correction changes the postal code too and the
 * two writes need to stay independently auditable. Never touches address,
 * name, or any other field.
 */
export async function updateVenuePostalCode(venueId: string, newPostalCode: string) {
  const [existing] = await db.select().from(venues).where(eq(venues.id, venueId)).limit(1);
  if (!existing) throw new Error(`Venue ${venueId} not found`);
  await db.update(venues).set({ postalCode: newPostalCode, updatedAt: new Date() }).where(eq(venues.id, venueId));
}

/**
 * Replaces a venue's full aliases array (VEGA venue model cleanup,
 * 2026-09-06) — a narrow sibling to updateVenueAddress/updateVenuePostalCode
 * for the same reason: venues.ts changes never reach an already-seeded
 * Production database on their own. Replaces the whole array rather than
 * add/remove-one, matching how the array is always specified in venues.ts.
 * Never touches name/address/identity fields.
 */
export async function updateVenueAliases(venueId: string, newAliases: string[]) {
  const [existing] = await db.select().from(venues).where(eq(venues.id, venueId)).limit(1);
  if (!existing) throw new Error(`Venue ${venueId} not found`);
  await db.update(venues).set({ aliases: newAliases, updatedAt: new Date() }).where(eq(venues.id, venueId));
}

/**
 * Replaces a venue's full rooms array (generalized sub-venue model,
 * 2026-09-06) — a narrow sibling to updateVenueAliases for the same reason:
 * venues.ts changes never reach an already-seeded Production database on
 * their own. Replaces the whole array rather than add/remove-one, matching
 * how the array is always specified in venues.ts. Never touches
 * name/address/identity/aliases fields.
 */
export async function updateVenueRooms(venueId: string, newRooms: { name: string; aliases?: string[] }[]) {
  const [existing] = await db.select().from(venues).where(eq(venues.id, venueId)).limit(1);
  if (!existing) throw new Error(`Venue ${venueId} not found`);
  await db.update(venues).set({ rooms: newRooms, updatedAt: new Date() }).where(eq(venues.id, venueId));
}

/**
 * Sets a venue's editorial copy fields (venue coverage expansion, 2026-08-29)
 * — used when a venue is promoted to curated `/venues` and needs the
 * factual description/shortDescription/venueProfile the guide's own
 * fallback chain (venue.shortDescription ?? venue.description,
 * venue.venueProfile ?? venue.description) expects, matching the tone of
 * every other curated entry. Never touches address/name/identity fields —
 * that stays updateVenueAddress's job.
 */
export async function updateVenueProfile(
  venueId: string,
  patch: { description?: string; shortDescription?: string | null; venueProfile?: string | null },
) {
  const [existing] = await db.select().from(venues).where(eq(venues.id, venueId)).limit(1);
  if (!existing) throw new Error(`Venue ${venueId} not found`);
  await db.update(venues).set({ ...patch, updatedAt: new Date() }).where(eq(venues.id, venueId));
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

  // Admin unpublish safety (2026-09-06): publishing this item would create
  // a BRAND NEW event row — if it's a suspected duplicate of an event an
  // admin already deliberately took down, that new row would make the
  // same real-world event publicly visible again, defeating the whole
  // point of the override (see adminUnpublishEvent's own doc comment).
  // Refuses outright rather than silently publishing; the admin's actual
  // options are to Merge this item into the existing event, or to use
  // "Publish Again" on that event if they've genuinely changed their mind.
  if (item.suspectedDuplicateOfEventId) {
    const [suspectedDuplicate] = await db.select().from(events).where(eq(events.id, item.suspectedDuplicateOfEventId)).limit(1);
    if (suspectedDuplicate?.adminUnpublishReason) {
      throw new Error(
        `Cannot publish: this looks like a duplicate of an admin-unpublished event ("${suspectedDuplicate.title}", reason: ${suspectedDuplicate.adminUnpublishReason}). Merge this item into it instead, or use "Publish Again" on that event if it should come back.`,
      );
    }
  }

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
      // Carried straight from the Discovery Queue row (generalized sub-venue
      // model, 2026-09-06) — same pattern as every other probable* -> event
      // field here.
      subVenue: item.probableSubVenue,
      primaryGenre: (item.predictedGenre as GenreSlug) ?? "electronic-other",
      // Must stay in lockstep with primaryGenre's own fallback — see the
      // matching comment in db/sync.ts's auto-publish branch.
      subgenres: item.predictedGenre ? [item.predictedGenre as GenreSlug] : ["electronic-other"],
      genreConfidence: item.genreConfidence as ConfidenceLevel,
      // Admin + public link integrity (2026-09-08): an admin-entered
      // probableOfficialEventUrl (added at the DQ review stage — see
      // src/db/schema.ts's column comment) is a deliberate editorial
      // decision and always wins; falling back to this row's own sourceUrl
      // (the discovery page itself) preserves every existing publish's
      // exact prior behavior when the admin never touched this field.
      officialEventUrl: item.probableOfficialEventUrl ?? item.sourceUrl,
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
      // Discovery Queue candidates carry no sold-out/cancelled signal (that
      // schema predates and is out of scope for event lifecycle/status
      // handling, 2026-08-28) — always false at publish time; an admin can
      // set either afterward via the normal edit form if needed.
      soldOut: false,
      cancelled: false,
      published: true,
      confidence: item.overallConfidence as ConfidenceLevel,
      // Provenance is persisted immediately here (via createEvent's own
      // recordSourceLink call, triggered whenever canonicalSourceId +
      // officialEventUrl are both set) rather than left for a later sync to
      // reconstruct via fuzzy matching. Deliberately item.sourceUrl (the
      // source's own page), NOT the officialEventUrl field above — those two
      // can now differ (see provenanceUrl's own doc comment on NewEventInput).
      canonicalSourceId: item.sourceId,
      provenanceUrl: item.sourceUrl,
      // DQ-stage manual edits (officialEventUrl/ticketUrl) must stay
      // protected from a later sync the same way any post-publish admin
      // edit already is (src/lib/override.ts) — otherwise the very field an
      // admin just deliberately set at review time could be silently
      // reverted by the next sync run. Only these two fields map onto a DQ
      // row's own overriddenFields (probableTicketUrl/probableOfficialEventUrl
      // are the only DQ fields with a direct canonical-event equivalent this
      // audit is scoped to).
      overriddenFields: [
        ...(item.overriddenFields?.includes("probableOfficialEventUrl") ? ["officialEventUrl"] : []),
        ...(item.overriddenFields?.includes("probableTicketUrl") ? ["ticketUrl"] : []),
      ],
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
  /** Admin-entered Official Event URL — see src/db/schema.ts's probableOfficialEventUrl column comment. */
  probableOfficialEventUrl?: string | null;
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
 * identity field. Also carries the same function's narrow, one-directional
 * venue-resolution/duplicate-suspicion self-healing (stale discovery-queue
 * audit, 2026-08-25): missingFields can only ever shrink (never gains a new
 * entry) and suspectedDuplicateOfEventId can only ever move from null to a
 * real id (never overwritten or cleared) — see buildDiscoveryQueueClassificationPatch's
 * own doc comment for the full safety reasoning. The status='pending' guard
 * is belt-and-suspenders against an admin resolving the item (publish/ignore/
 * merge) between this sync's read and this write; a no-op patch is skipped
 * entirely rather than issuing an empty UPDATE.
 */
export async function applyDiscoveryClassificationUpdate(
  queueId: string,
  patch: {
    /** May be explicitly null (generalized discovery-queue genre self-heal,
     *  2026-09-06) to clear a stale predictedGenre once a fresh
     *  classification authoritatively finds none — see
     *  src/lib/sync.ts::buildDiscoveryQueueClassificationPatch. Omitting the
     *  key entirely (undefined) still means "don't touch it", exactly as
     *  before; only an explicit `null` clears the column. */
    predictedGenre?: GenreSlug | null;
    genreConfidence?: ConfidenceLevel;
    overallConfidence?: ConfidenceLevel;
    missingFields?: string[];
    suspectedDuplicateOfEventId?: string;
    /**
     * Which room the raw venue text resolved to (generalized sub-venue
     * model, 2026-09-06) — may be explicitly null to clear a stale room once
     * a fresh, successful venue resolution says there isn't one. Omitting
     * the key entirely still means "don't touch it" — see
     * src/lib/sync.ts::buildDiscoveryQueueClassificationPatch's own guard
     * (only ever included when this run's venue resolution actually
     * succeeded, so a transient resolution miss never erases a
     * previously-known room).
     */
    probableSubVenue?: string | null;
    /** Source-freshness bump (unknown-venue visibility work package,
     *  2026-08-31) — see discoveryQueue.lastSeenAt's own doc comment.
     *  Always passed by src/db/sync.ts whenever this row's own candidate was
     *  matched again in this sync's fetch, independent of whether anything
     *  else in the patch changed. */
    lastSeenAt?: Date;
    /**
     * Venue-block visibility precision fix (follow-up to 2026-08-31's
     * freshness work) — see discoveryQueue.venueResolvedDecision's own doc
     * comment. Recomputed alongside genre on every sync so it can move in
     * either direction (unlike missingFields' one-directional self-heal),
     * including back to null once venue resolution stops being applicable.
     */
    venueResolvedDecision?: PublishDecision | null;
    venueResolvedHoldReason?: HoldReason;
    /** See discoveryQueue.holdReason's own doc comment. */
    holdReason?: HoldReason;
    /**
     * KultuNaut link-role integrity self-heal (2026-09-08) — may be
     * explicitly null to clear a stale same-host ticket URL a pre-fix
     * adapter run wrote; omitting the key entirely still means "don't
     * touch it". See src/lib/sync.ts::buildDiscoveryQueueClassificationPatch's
     * own doc comment for the exact bug this reverses.
     */
    probableTicketUrl?: string | null;
  },
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
  /** Which room the raw venue text resolved to (generalized sub-venue model, 2026-09-06). Null when not applicable/unknown. */
  probableSubVenue?: string | null;
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
  /** First-sighting timestamp (unknown-venue visibility work package,
   *  2026-08-31) — see discoveryQueue.lastSeenAt's own doc comment. Always
   *  "now" when src/db/sync.ts inserts a fresh sync candidate. Omitted (left
   *  NULL) by the admin "Add event from URL" tool — a manually-added item
   *  was never observed via a source sync, so it correctly never appears in
   *  source-freshness/venue-block reporting regardless (that reporting is
   *  scoped to rows with a real sourceId, which this kind of row also
   *  never has). */
  lastSeenAt?: Date;
  /** See discoveryQueue.venueResolvedDecision's own doc comment. */
  venueResolvedDecision?: PublishDecision | null;
  venueResolvedHoldReason?: HoldReason;
  /** See discoveryQueue.holdReason's own doc comment. */
  holdReason?: HoldReason;
}): Promise<DiscoveryQueueNotificationItem> {
  await db.insert(discoveryQueue).values({ ...item, status: "pending" });

  // Deliberately does NOT send the notification itself: a per-candidate
  // sync loop must not serialize DB writes behind an external HTTP round-
  // trip (see notifyDiscoveryQueueInsertBatch in lib/discoveryNotification —
  // callers batch this echoed item and notify after all DB writes finish).
  // Echoing back exactly what was inserted, rather than making each caller
  // reconstruct the notification shape, keeps the two from drifting apart.
  return {
    id: item.id,
    probableTitle: item.probableTitle,
    probableStart: item.probableStart,
    probableVenueName: item.probableVenueName,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    predictedGenre: item.predictedGenre,
    genreConfidence: item.genreConfidence,
    overallConfidence: item.overallConfidence,
    missingFields: item.missingFields,
  };
}

/** Finds the strongest duplicate among currently published events, for merge suggestions. */
export async function findDuplicateEventId(
  candidate: {
    title: string;
    artists: string[];
    venueId: string | null;
    subVenue?: string | null;
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
      subVenue: row.subVenue,
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
  outcome: {
    success: boolean;
    eventsFound?: number;
    eventsUpdated?: number;
    error?: string | null;
    /**
     * Whether this sync's fetch is known to have gathered its FULL
     * candidate set (unknown-venue visibility work package, 2026-08-31) —
     * see SourceAdapter.lastFetchWasComplete and sources.lastCompleteSyncAt's
     * own doc comments. Defaults to true (every adapter without partial-
     * fetch semantics is complete by construction whenever it succeeds at
     * all) — only ever passed false by src/db/sync.ts when the adapter
     * itself reports a partial result.
     */
    complete?: boolean;
    /**
     * The exact timestamp already stamped onto every discovery_queue row's
     * lastSeenAt during this same sync (src/db/sync.ts's `seenAt`, captured
     * once before the candidate loop runs). Bug fixed 2026-08-31: this used
     * to default to `now` computed HERE, after the entire per-candidate
     * write loop had finished — on a real Production sync that loop takes
     * tens of seconds, so lastCompleteSyncAt ended up strictly LATER than
     * the lastSeenAt just written for every candidate touched in that same
     * sync, and isDiscoveryRowCurrent (lastSeenAt >= lastCompleteSyncAt)
     * marked every one of them stale immediately — confirmed live via the
     * venue-blocks diagnostic returning an empty ACTIVE list right after a
     * real sync. Passing the same instant used for lastSeenAt guarantees
     * every row this sync touched satisfies `>=` (equality), while rows
     * NOT touched (still holding an older or null lastSeenAt) correctly
     * stay behind it. Falls back to `now` only for a failed/partial-only
     * call path that never reaches the lastSeenAt-writing loop at all.
     */
    completeSyncAt?: Date;
  },
) {
  const now = new Date();
  const { sources } = await import("./schema");
  if (outcome.success) {
    await db
      .update(sources)
      .set({
        lastSuccessfulSync: now,
        lastAttemptedSync: now,
        ...(outcome.complete ?? true ? { lastCompleteSyncAt: outcome.completeSyncAt ?? now } : {}),
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
