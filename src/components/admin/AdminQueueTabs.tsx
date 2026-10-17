"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import DiscoveryQueue from "./DiscoveryQueue";
import type { DiscoveryQueueItem, Venue } from "@/lib/types";
import type { AdminQueueCategory, AdminUnpublishedRow, PublishedQueueRow } from "@/lib/adminQueue";
import { ADMIN_QUEUE_CATEGORY_LABELS } from "@/lib/adminQueue";
import { formatFullDateLabel } from "@/lib/format";
import { REVIEW_PRIORITY_DEFAULT_VISIBLE, type PastStaleSplit, type PrioritizedReviewRow, type ReviewPriority, type ReviewPriorityList } from "@/lib/reviewPriority";

type Tab = AdminQueueCategory | "likely_relevant" | "published" | "admin_unpublished";

const UNPUBLISH_REASON_LABELS: Record<string, string> = {
  cancelled: "Cancelled",
  irrelevant: "Not relevant",
  duplicate: "Duplicate",
  incorrect_data: "Incorrect data",
  other: "Other",
};

interface Props {
  groups: Record<AdminQueueCategory, DiscoveryQueueItem[]>;
  published: PublishedQueueRow[];
  adminUnpublished: AdminUnpublishedRow[];
  venues: Venue[];
  /** Ranked likely/possible-relevant rows from Insufficient evidence (see src/lib/reviewPriority.ts). */
  priorityList?: ReviewPriorityList;
  /** Display split of the Past / stale tab: expired vs still-upcoming rows the source no longer lists. */
  pastStaleSplit?: PastStaleSplit<DiscoveryQueueItem>;
}

/**
 * Admin Discovery Queue cleanup/actionable views, 2026-09-06: the 7-tab
 * container Section 2 of the brief asks for. Every count and every row
 * comes straight from the server-computed groups/published/adminUnpublished
 * props — this component never re-derives which category a row belongs to
 * (that's classifyAdminQueueRow's job, see src/lib/adminQueue.ts), it only
 * decides which already-classified list to show.
 */
const VALID_TABS: Tab[] = ["needs_review", "likely_relevant", "venue_blocked", "insufficient", "rejected", "past_stale", "published", "admin_unpublished"];

const EMPTY_PRIORITY_LIST: ReviewPriorityList = { likely: [], possible: [], urgentCount: 0 };

export default function AdminQueueTabs({ groups, published, adminUnpublished, venues, priorityList = EMPTY_PRIORITY_LIST, pastStaleSplit }: Props) {
  // Direct handoff (unified event create/edit model, 2026-09-08 — Section
  // 5/10): AddEventFromUrl and AdminQueueTabs are sibling client components
  // on the same server-rendered /admin page (see src/app/admin/page.tsx) —
  // Analyze's own "Saved to: {bucket}" link sets ?tab=<category>#dq-<id> and
  // this reads its INITIAL tab straight from that query param, so a freshly
  // analyzed candidate opens directly on the tab it actually landed in
  // instead of defaulting to "Needs review" and leaving the admin to search.
  // Read once on mount only (an admin's own later clicks inside this
  // component must not be fought back to the URL's original tab).
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab: Tab = requestedTab && (VALID_TABS as string[]).includes(requestedTab) ? (requestedTab as Tab) : "needs_review";
  const [tab, setTab] = useState<Tab>(initialTab);

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "needs_review", label: ADMIN_QUEUE_CATEGORY_LABELS.needs_review, count: groups.needs_review.length },
    { key: "likely_relevant", label: "Likely relevant", count: priorityList.likely.length + priorityList.possible.length },
    { key: "venue_blocked", label: ADMIN_QUEUE_CATEGORY_LABELS.venue_blocked, count: groups.venue_blocked.length },
    { key: "insufficient", label: ADMIN_QUEUE_CATEGORY_LABELS.insufficient, count: groups.insufficient.length },
    { key: "rejected", label: ADMIN_QUEUE_CATEGORY_LABELS.rejected, count: groups.rejected.length },
    { key: "past_stale", label: ADMIN_QUEUE_CATEGORY_LABELS.past_stale, count: groups.past_stale.length },
    { key: "published", label: "Published", count: published.length },
    { key: "admin_unpublished", label: "Unpublished by admin", count: adminUnpublished.length },
  ];

  return (
    <div>
      {priorityList.urgentCount > 0 && (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-warn px-3 py-2">
          <p className="text-xs font-semibold text-status-warn">
            {priorityList.urgentCount === 1
              ? "1 likely relevant event starts within 72 hours and has not been handled yet."
              : `${priorityList.urgentCount} likely relevant events start within 72 hours and have not been handled yet.`}
          </p>
          <button type="button" onClick={() => setTab("likely_relevant")} className="text-xs font-semibold text-accent-strong underline decoration-dotted underline-offset-2">
            Review them
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
              tab === t.key
                ? "border-accent bg-accent/10 text-accent-strong"
                : "border-border-strong text-text-secondary hover:border-accent-dim hover:text-text-primary"
            }`}
          >
            {t.label} <span className="ml-1 tabular-nums text-text-tertiary">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "needs_review" && <DiscoveryQueue items={groups.needs_review} venues={venues} />}
        {tab === "likely_relevant" && <LikelyRelevantList list={priorityList} venues={venues} />}
        {tab === "venue_blocked" && <DiscoveryQueue items={groups.venue_blocked} venues={venues} />}
        {tab === "insufficient" && <DiscoveryQueue items={groups.insufficient} venues={venues} />}
        {tab === "rejected" && <DiscoveryQueue items={groups.rejected} venues={venues} />}
        {tab === "past_stale" &&
          (pastStaleSplit ? <PastStaleList split={pastStaleSplit} venues={venues} /> : <DiscoveryQueue items={groups.past_stale} venues={venues} />)}
        {tab === "published" && <PublishedList rows={published} />}
        {tab === "admin_unpublished" && <UnpublishedByAdminList rows={adminUnpublished} />}
      </div>
    </div>
  );
}

const RELEVANCE_STATE_LABELS: Record<ReviewPriority["relevanceState"], string> = {
  missing_genre_info: "Genre information missing",
  uncertain_relevance: "Uncertain electronic relevance",
};

/** Why a row was prioritised and what to do with it — read-only, shown under the row's title. */
function PriorityExplanation({ priority }: { priority: ReviewPriority }) {
  const positives = priority.signals.filter((s) => s.points > 0);
  const negatives = priority.signals.filter((s) => s.points < 0);
  const notes = priority.signals.filter((s) => s.points === 0);
  return (
    <div className="mt-2 rounded-md border border-border px-3 py-2 text-xs" data-testid="priority-explanation">
      <p className="font-semibold text-text-primary">
        {RELEVANCE_STATE_LABELS[priority.relevanceState]} · score {priority.relevanceScore}
        {priority.startsWithin72h && <span className="ml-2 text-status-warn">Starts within 72 hours</span>}
      </p>
      {positives.length > 0 && <p className="mt-1 text-text-secondary">For: {positives.map((s) => s.label).join(" · ")}</p>}
      {negatives.length > 0 && <p className="mt-1 text-status-warn">Against: {negatives.map((s) => s.label).join(" · ")}</p>}
      {notes.length > 0 && <p className="mt-1 text-text-tertiary">{notes.map((s) => s.label).join(" · ")}</p>}
      <p className="mt-1 font-semibold text-accent-strong">Recommended: {priority.recommendedAction}</p>
    </div>
  );
}

function PrioritizedRows({ rows, venues, emptyMessage }: { rows: PrioritizedReviewRow[]; venues: Venue[]; emptyMessage: string }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, REVIEW_PRIORITY_DEFAULT_VISIBLE);
  const byId = new Map(rows.map((r) => [r.item.id, r.priority]));
  return (
    <div>
      <DiscoveryQueue
        items={visible.map((r) => r.item)}
        venues={venues}
        emptyMessage={emptyMessage}
        annotate={(item) => {
          const priority = byId.get(item.id);
          return priority ? <PriorityExplanation priority={priority} /> : null;
        }}
      />
      {rows.length > REVIEW_PRIORITY_DEFAULT_VISIBLE && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-xs font-semibold text-accent-strong underline decoration-dotted underline-offset-2"
        >
          {showAll ? `Show the top ${REVIEW_PRIORITY_DEFAULT_VISIBLE} only` : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/**
 * Insufficient-evidence rows ranked by how likely they are to be electronic
 * and how soon they start. They stay in Insufficient evidence too: this is a
 * prioritised view of the same rows, using the same publish/ignore actions.
 */
function LikelyRelevantList({ list, venues }: { list: ReviewPriorityList; venues: Venue[] }) {
  const [showPossible, setShowPossible] = useState(false);
  return (
    <div>
      <p className="mb-3 text-xs text-text-secondary">
        Pending rows from Insufficient evidence whose source text names no genre, but where the venue, wording, lineup or
        source category points at electronic music. Nothing here is published automatically.
      </p>
      <PrioritizedRows rows={list.likely} venues={venues} emptyMessage="No likely relevant rows right now." />
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowPossible((v) => !v)}
          aria-expanded={showPossible}
          className="text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary"
        >
          {showPossible ? "Hide" : "Show"} possibly relevant — source category only ({list.possible.length})
        </button>
        {showPossible && (
          <div className="mt-2">
            <p className="mb-2 text-xs text-text-tertiary">
              Only the source&rsquo;s own electronic category (e.g. KultuNaut&rsquo;s Elektronisk / Club-DJ listing) speaks for these.
              That category also contains concerts that are not electronic, so check the artist first.
            </p>
            <PrioritizedRows rows={list.possible} venues={venues} emptyMessage="No rows with only a source category signal." />
          </div>
        )}
      </div>
    </div>
  );
}

/** Past / stale, split for display: upcoming rows the source dropped may have moved or been renamed. */
function PastStaleList({ split, venues }: { split: PastStaleSplit<DiscoveryQueueItem>; venues: Venue[] }) {
  const [showExpired, setShowExpired] = useState(false);
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-primary">
        Upcoming, no longer listed by the source ({split.upcomingNotInSource.length})
      </h3>
      <p className="mt-1 mb-2 text-xs text-text-secondary">
        The source stopped listing these before they happened — check whether they moved, were renamed or were cancelled.
      </p>
      <DiscoveryQueue items={split.upcomingNotInSource} venues={venues} emptyMessage="None right now." />
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowExpired((v) => !v)}
          aria-expanded={showExpired}
          className="text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary"
        >
          {showExpired ? "Hide" : "Show"} expired ({split.expired.length})
        </button>
        {showExpired && (
          <div className="mt-2">
            <DiscoveryQueue items={split.expired} venues={venues} emptyMessage="None." />
          </div>
        )}
      </div>
    </div>
  );
}

function PublishedList({ rows }: { rows: PublishedQueueRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-text-secondary">No published Discovery Queue candidates yet.</p>;
  }
  return (
    <ul>
      {rows.map(({ item, canonicalEventId, canonicalTitle, canonicalVenueName }) => (
        <li key={item.id} className="border-b border-border py-3 last:border-b-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-text-primary">{canonicalTitle ?? item.probableTitle}</p>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
              {item.status === "merged" ? "Merged into existing event" : "Published"}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            {canonicalVenueName ?? item.probableVenueName ?? "Venue unresolved"} · source: {item.sourceName}
            {item.probableStart && ` · ${formatFullDateLabel(item.probableStart)}`}
          </p>
          {canonicalEventId && <p className="mt-1 text-[11px] text-text-tertiary">Event: {canonicalEventId}</p>}
        </li>
      ))}
    </ul>
  );
}

function UnpublishedByAdminList({ rows }: { rows: AdminUnpublishedRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-text-secondary">No events are currently unpublished by an admin.</p>;
  }
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.eventId} className="border-b border-border py-3 last:border-b-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-text-primary">{row.title}</p>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-status-warn">
              {UNPUBLISH_REASON_LABELS[row.reason] ?? row.reason}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            {row.venueName}
            {row.sourceName ? ` · source: ${row.sourceName}` : ""}
          </p>
          {row.note && <p className="mt-1 text-xs text-text-secondary">{row.note}</p>}
          {row.unpublishedAt && (
            <p className="mt-1 text-[11px] text-text-tertiary">Unpublished {formatFullDateLabel(row.unpublishedAt)}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
