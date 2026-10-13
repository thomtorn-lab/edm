import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./client";
import { eventSoundcloudLinks, soundcloudLinkBlocks } from "./schema";
import { planSoundcloudLinkChanges, type SoundcloudLinkPlan } from "@/lib/soundcloudLinks";
import type { SoundcloudLinkReport } from "@/lib/adapters/types";

/**
 * Postgres side of venue-provided artist SoundCloud links (2026-10-13). The
 * sync calls reconcileSourceSoundcloudLinks once per run, after its
 * candidate loop; the decisions themselves are planSoundcloudLinkChanges in
 * src/lib/soundcloudLinks.ts. One read per run, and writes only when
 * something changed. soundcloud_link_blocks is never read or written here,
 * so a block survives every sync.
 */
export async function reconcileSourceSoundcloudLinks(
  sourceId: string,
  observed: Map<string, SoundcloudLinkReport>,
): Promise<SoundcloudLinkPlan> {
  const empty: SoundcloudLinkPlan = { upserts: [], deletes: [], suppressedDeletes: 0 };
  if (observed.size === 0) return empty;

  const existing = await db
    .select({ eventId: eventSoundcloudLinks.eventId, artistName: eventSoundcloudLinks.artistName, url: eventSoundcloudLinks.url })
    .from(eventSoundcloudLinks)
    .where(and(eq(eventSoundcloudLinks.sourceId, sourceId), inArray(eventSoundcloudLinks.eventId, [...observed.keys()])));

  const plan = planSoundcloudLinkChanges(existing, observed);

  // No transaction, deliberately (reviewed 2026-10-13). The writes are one
  // multi-row upsert (atomic on its own) followed by one delete per event
  // (each atomic on its own), and every state a failure part-way can leave
  // is safe and self-healing:
  //   - upsert fails: nothing changed, no delete is attempted (the throw
  //     stops here); the next run plans the same writes again.
  //   - a delete fails after the upsert: new/updated links are live, and
  //     the not-yet-deleted rows are links the venue itself gave earlier and
  //     has since removed — never a link it didn't provide. They still only
  //     show for names in the event's current lineup and can be blocked. The
  //     next run sees exactly those rows left and plans only their delete.
  // Upsert runs first so a failure can only delay a removal, never drop a
  // valid link. A transaction would only shorten that stale window to zero,
  // at the cost of the first transaction in this codebase over the pooled
  // connection; see src/db/soundcloudLinks.test.ts for the failure cases.
  if (plan.upserts.length > 0) {
    const now = new Date();
    await db
      .insert(eventSoundcloudLinks)
      .values(plan.upserts.map((r) => ({ ...r, sourceId, updatedAt: now })))
      .onConflictDoUpdate({
        target: [eventSoundcloudLinks.eventId, eventSoundcloudLinks.sourceId, eventSoundcloudLinks.artistName],
        set: { url: sql`excluded.url`, updatedAt: now },
      });
  }
  const deletesByEvent = new Map<string, string[]>();
  for (const d of plan.deletes) {
    if (!deletesByEvent.has(d.eventId)) deletesByEvent.set(d.eventId, []);
    deletesByEvent.get(d.eventId)!.push(d.artistName);
  }
  for (const [eventId, artistNames] of deletesByEvent) {
    await db
      .delete(eventSoundcloudLinks)
      .where(
        and(
          eq(eventSoundcloudLinks.sourceId, sourceId),
          eq(eventSoundcloudLinks.eventId, eventId),
          inArray(eventSoundcloudLinks.artistName, artistNames),
        ),
      );
  }
  return plan;
}

/** Blocks a profile URL everywhere. Idempotent; an existing block keeps its original reason. */
export async function blockSoundcloudProfile(url: string, reason: string | null): Promise<void> {
  await db.insert(soundcloudLinkBlocks).values({ url, reason }).onConflictDoNothing();
}

export async function unblockSoundcloudProfile(url: string): Promise<void> {
  await db.delete(soundcloudLinkBlocks).where(eq(soundcloudLinkBlocks.url, url));
}

/** What the block workflow's plan mode prints: the block row (if any) and every stored link using this URL. */
export async function describeSoundcloudProfile(url: string) {
  const [block] = await db
    .select({ url: soundcloudLinkBlocks.url, reason: soundcloudLinkBlocks.reason, createdAt: soundcloudLinkBlocks.createdAt })
    .from(soundcloudLinkBlocks)
    .where(eq(soundcloudLinkBlocks.url, url));
  const links = await db
    .select({ eventId: eventSoundcloudLinks.eventId, sourceId: eventSoundcloudLinks.sourceId, artistName: eventSoundcloudLinks.artistName })
    .from(eventSoundcloudLinks)
    .where(eq(eventSoundcloudLinks.url, url));
  return { block: block ?? null, links };
}
