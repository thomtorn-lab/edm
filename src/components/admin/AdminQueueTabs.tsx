"use client";

import { useState } from "react";
import DiscoveryQueue from "./DiscoveryQueue";
import type { DiscoveryQueueItem, Venue } from "@/lib/types";
import type { AdminQueueCategory, AdminUnpublishedRow, PublishedQueueRow } from "@/lib/adminQueue";
import { ADMIN_QUEUE_CATEGORY_LABELS } from "@/lib/adminQueue";
import { formatFullDateLabel } from "@/lib/format";

type Tab = AdminQueueCategory | "published" | "admin_unpublished";

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
}

/**
 * Admin Discovery Queue cleanup/actionable views, 2026-09-06: the 7-tab
 * container Section 2 of the brief asks for. Every count and every row
 * comes straight from the server-computed groups/published/adminUnpublished
 * props — this component never re-derives which category a row belongs to
 * (that's classifyAdminQueueRow's job, see src/lib/adminQueue.ts), it only
 * decides which already-classified list to show.
 */
export default function AdminQueueTabs({ groups, published, adminUnpublished, venues }: Props) {
  const [tab, setTab] = useState<Tab>("needs_review");

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "needs_review", label: ADMIN_QUEUE_CATEGORY_LABELS.needs_review, count: groups.needs_review.length },
    { key: "venue_blocked", label: ADMIN_QUEUE_CATEGORY_LABELS.venue_blocked, count: groups.venue_blocked.length },
    { key: "insufficient", label: ADMIN_QUEUE_CATEGORY_LABELS.insufficient, count: groups.insufficient.length },
    { key: "rejected", label: ADMIN_QUEUE_CATEGORY_LABELS.rejected, count: groups.rejected.length },
    { key: "past_stale", label: ADMIN_QUEUE_CATEGORY_LABELS.past_stale, count: groups.past_stale.length },
    { key: "published", label: "Published", count: published.length },
    { key: "admin_unpublished", label: "Unpublished by admin", count: adminUnpublished.length },
  ];

  return (
    <div>
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
        {tab === "venue_blocked" && <DiscoveryQueue items={groups.venue_blocked} venues={venues} />}
        {tab === "insufficient" && <DiscoveryQueue items={groups.insufficient} venues={venues} />}
        {tab === "rejected" && <DiscoveryQueue items={groups.rejected} venues={venues} />}
        {tab === "past_stale" && <DiscoveryQueue items={groups.past_stale} venues={venues} />}
        {tab === "published" && <PublishedList rows={published} />}
        {tab === "admin_unpublished" && <UnpublishedByAdminList rows={adminUnpublished} />}
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
