"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import DiscoveryQueue from "./DiscoveryQueue";
import type { DiscoveryQueueItem, Venue } from "@/lib/types";
import type { AdminQueueCategory, AdminUnpublishedRow, PublishedQueueRow } from "@/lib/adminQueue";
import { ADMIN_QUEUE_CATEGORY_LABELS } from "@/lib/adminQueue";
import { formatFullDateLabel } from "@/lib/format";
import {
  REVIEW_PRIORITY_DEFAULT_VISIBLE,
  splitVisibleReviewRows,
  type NotInSourceReview,
  type PastStaleSplit,
  type PrioritizedReviewRow,
  type ReviewPriority,
  type GroupedReviewList,
  type ReviewGroup,
} from "@/lib/reviewPriority";

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
  priorityList?: GroupedReviewList;
  /** Display split of the Past / stale tab: expired vs still-upcoming rows the source no longer lists. */
  pastStaleSplit?: PastStaleSplit<DiscoveryQueueItem>;
  /** The upcoming-but-no-longer-listed rows, ranked with the same signals as Likely relevant. */
  notInSource?: NotInSourceReview;
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

const EMPTY_PRIORITY_LIST: GroupedReviewList = { likely: [], possible: [], urgentCount: 0, urgentLikelyCount: 0, urgentPossibleCount: 0 };

export default function AdminQueueTabs({
  groups,
  published,
  adminUnpublished,
  venues,
  priorityList = EMPTY_PRIORITY_LIST,
  pastStaleSplit,
  notInSource,
}: Props) {
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
      {priorityList.likely.length + priorityList.possible.length > 0 && (
        <div
          role={priorityList.urgentCount > 0 ? "alert" : "status"}
          className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 ${
            priorityList.urgentCount > 0 ? "border-status-warn" : "border-border-strong"
          }`}
        >
          <div className="text-xs">
            <p className="text-text-primary">
              Waiting for review: <strong>{priorityList.likely.length} likely relevant</strong> ·{" "}
              {priorityList.possible.length} possible (source category only)
            </p>
            {priorityList.urgentCount > 0 && (
              <p className="mt-0.5 font-semibold text-status-warn">{urgentSentence(priorityList)}</p>
            )}
          </div>
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
          (pastStaleSplit ? (
            <PastStaleList split={pastStaleSplit} notInSource={notInSource} venues={venues} />
          ) : (
            <DiscoveryQueue items={groups.past_stale} venues={venues} />
          ))}
        {tab === "published" && <PublishedList rows={published} />}
        {tab === "admin_unpublished" && <UnpublishedByAdminList rows={adminUnpublished} />}
      </div>
    </div>
  );
}

function urgentSentence(list: GroupedReviewList): string {
  const parts: string[] = [];
  if (list.urgentLikelyCount > 0) parts.push(`${list.urgentLikelyCount} likely relevant`);
  if (list.urgentPossibleCount > 0) parts.push(`${list.urgentPossibleCount} possible`);
  const verb = list.urgentCount === 1 ? "starts" : "start";
  return `${parts.join(" and ")} ${list.urgentCount === 1 ? "event" : "events"} ${verb} within 72 hours and ${list.urgentCount === 1 ? "has" : "have"} not been handled yet.`;
}

const RELEVANCE_STATE_LABELS: Record<ReviewPriority["relevanceState"], string> = {
  missing_genre_info: "Genre information missing",
  uncertain_relevance: "Uncertain electronic relevance",
};

const TIER_BADGES: Record<"likely" | "possible", { label: string; className: string }> = {
  likely: { label: "Likely relevant", className: "border-accent text-accent-strong" },
  possible: { label: "Possible · source category only", className: "border-dashed border-status-warn text-status-warn" },
};

/** Why a row was prioritised and what to do with it — read-only, shown under the row's title. */
function PriorityExplanation({ priority }: { priority: ReviewPriority }) {
  const series = priority.signals.filter((s) => s.key.startsWith("series_"));
  const others = priority.signals.filter((s) => !s.key.startsWith("series_"));
  const positives = others.filter((s) => s.points > 0);
  const negatives = others.filter((s) => s.points < 0);
  const notes = others.filter((s) => s.points === 0);
  const badge = priority.tier === "none" ? null : TIER_BADGES[priority.tier];
  return (
    <div
      className={`mt-2 rounded-md border px-3 py-2 text-xs ${priority.tier === "possible" ? "border-dashed border-status-warn" : "border-border"}`}
      data-testid="priority-explanation"
      data-tier={priority.tier}
    >
      <p className="font-semibold text-text-primary">
        {badge && (
          <span className={`mr-2 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${badge.className}`}>{badge.label}</span>
        )}
        {RELEVANCE_STATE_LABELS[priority.relevanceState]} · score {priority.relevanceScore}
        {priority.startsWithin72h && <span className="ml-2 text-status-warn">Starts within 72 hours</span>}
      </p>
      {positives.length > 0 && <p className="mt-1 text-text-secondary">For: {positives.map((s) => s.label).join(" · ")}</p>}
      {negatives.length > 0 && <p className="mt-1 text-status-warn">Against: {negatives.map((s) => s.label).join(" · ")}</p>}
      {notes.length > 0 && <p className="mt-1 text-text-tertiary">{notes.map((s) => s.label).join(" · ")}</p>}
      {series.map((s) => (
        <p
          key={s.key}
          className={`mt-1 ${s.points < 0 ? "text-status-warn" : s.points > 0 ? "text-text-secondary" : "text-text-tertiary"}`}
          data-testid="series-memory"
        >
          Series memory ({s.points > 0 ? `+${s.points}` : s.points}, ranking only — never publishes or sets a genre): {s.label}
        </p>
      ))}
      <p className="mt-1 font-semibold text-accent-strong">Recommended: {priority.recommendedAction}</p>
    </div>
  );
}

function PrioritizedQueue({ rows, venues, emptyMessage }: { rows: PrioritizedReviewRow[]; venues: Venue[]; emptyMessage: string }) {
  const byId = new Map(rows.map((r) => [r.item.id, r.priority]));
  return (
    <DiscoveryQueue
      items={rows.map((r) => r.item)}
      venues={venues}
      emptyMessage={emptyMessage}
      annotate={(item) => {
        const priority = byId.get(item.id);
        return priority ? <PriorityExplanation priority={priority} /> : null;
      }}
    />
  );
}

/** Display name of a row's source, e.g. "KultuNaut" — falls back to the source id. */
function sourceLabel(row: PrioritizedReviewRow): string {
  return row.item.sourceName || row.item.sourceId || "admin";
}

/**
 * The same event listed by more than one source, shown as one queue entry:
 * the best-ranked row with all its sources named, and every other source's
 * row one click away with its own actions. Nothing is merged.
 */
function GroupSources({ group, venues }: { group: ReviewGroup; venues: Venue[] }) {
  const [open, setOpen] = useState(false);
  const all = [group.primary, ...group.others];
  return (
    <div className="mt-2 rounded-md border border-border px-3 py-2 text-xs" data-testid="group-sources">
      <p className="text-text-secondary">
        Same event from {all.length} sources: <strong>{all.map(sourceLabel).join(" · ")}</strong>. Each listing keeps its own actions.
      </p>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-1 font-semibold text-accent-strong underline decoration-dotted underline-offset-2">
        {open ? "Hide" : "Show"} the other {group.others.length === 1 ? "listing" : `${group.others.length} listings`}
      </button>
      {open && (
        <div className="mt-2 border-l-2 border-border pl-3">
          <PrioritizedQueue rows={group.others} venues={venues} emptyMessage="" />
        </div>
      )}
    </div>
  );
}

function GroupedQueue({ groups, venues, emptyMessage }: { groups: ReviewGroup[]; venues: Venue[]; emptyMessage: string }) {
  const byId = new Map(groups.map((g) => [g.primary.item.id, g]));
  return (
    <DiscoveryQueue
      items={groups.map((g) => g.primary.item)}
      venues={venues}
      emptyMessage={emptyMessage}
      annotate={(item) => {
        const group = byId.get(item.id);
        if (!group) return null;
        return (
          <>
            <PriorityExplanation priority={group.primary.priority} />
            {group.others.length > 0 && <GroupSources group={group} venues={venues} />}
          </>
        );
      }}
    />
  );
}

const SECTION_HEADING = "text-xs font-semibold uppercase tracking-wide";

/**
 * Insufficient-evidence rows ranked by how likely they are to be electronic
 * and how soon they start. They stay in Insufficient evidence too: this is a
 * prioritised view of the same rows, using the same publish/ignore actions.
 * The default view shows up to 15 rows, likely ones first; free slots go to
 * the best possible rows, in their own clearly marked section.
 */
function LikelyRelevantList({ list, venues }: { list: GroupedReviewList; venues: Venue[] }) {
  const [showAllLikely, setShowAllLikely] = useState(false);
  const [showAllPossible, setShowAllPossible] = useState(false);
  const visible = splitVisibleReviewRows(list);
  const likelyRows = showAllLikely ? list.likely : visible.likelyShown;
  const possibleRows = showAllPossible ? list.possible : visible.possibleShown;
  return (
    <div>
      <p className="mb-3 text-xs text-text-secondary">
        Pending rows from Insufficient evidence whose source text names no genre, but where the venue, wording, lineup or
        source category points at electronic music. Nothing here is published automatically.
      </p>

      <section aria-label="Likely relevant">
        <h3 className={`${SECTION_HEADING} text-accent-strong`}>Likely relevant ({list.likely.length})</h3>
        <p className="mt-1 mb-2 text-xs text-text-tertiary">Backed by a genre, DJ/rave/club wording or a primarily electronic venue.</p>
        <GroupedQueue groups={likelyRows} venues={venues} emptyMessage="No likely relevant rows right now." />
        {visible.likelyHidden.length > 0 && (
          <button type="button" onClick={() => setShowAllLikely((v) => !v)} className="mt-2 text-xs font-semibold text-accent-strong underline decoration-dotted underline-offset-2">
            {showAllLikely ? `Show the top ${REVIEW_PRIORITY_DEFAULT_VISIBLE} only` : `Show all ${list.likely.length} likely relevant`}
          </button>
        )}
      </section>

      <section aria-label="Possible — source category only" className="mt-6 rounded-md border border-dashed border-status-warn px-3 py-3">
        <h3 className={`${SECTION_HEADING} text-status-warn`}>
          Possible — source category only ({possibleRows.length} of {list.possible.length} shown)
        </h3>
        <p className="mt-1 mb-2 text-xs text-text-tertiary">
          Lower certainty. Only the source&rsquo;s own electronic category (e.g. KultuNaut&rsquo;s Elektronisk / Club-DJ listing) speaks for
          these, and that category also contains concerts that are not electronic — check the artist first.
          {visible.possibleShown.length > 0 && !showAllPossible && " Shown here because there are fewer than 15 likely relevant rows."}
        </p>
        <GroupedQueue groups={possibleRows} venues={venues} emptyMessage="No possible rows shown — open the full list below." />
        {list.possible.length > possibleRows.length || showAllPossible ? (
          <button
            type="button"
            onClick={() => setShowAllPossible((v) => !v)}
            className="mt-2 text-xs font-semibold text-status-warn underline decoration-dotted underline-offset-2"
          >
            {showAllPossible ? "Show fewer possible rows" : `Show all ${list.possible.length} possible`}
          </button>
        ) : null}
      </section>
    </div>
  );
}

/**
 * Past / stale, split for display: upcoming rows the source stopped listing
 * may have moved, been renamed or been cancelled — or the source may simply
 * have dropped them. Relevant-looking ones are ranked first; the rest and the
 * expired rows are collapsed. Nothing is concluded automatically.
 */
function PastStaleList({ split, notInSource, venues }: { split: PastStaleSplit<DiscoveryQueueItem>; notInSource?: NotInSourceReview; venues: Venue[] }) {
  const [showOthers, setShowOthers] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const ranked = notInSource ? [...notInSource.prioritized.likely, ...notInSource.prioritized.possible] : [];
  const others = notInSource ? notInSource.others : split.upcomingNotInSource;
  return (
    <div>
      <h3 className={`${SECTION_HEADING} text-text-primary`}>Upcoming, no longer listed by the source ({split.upcomingNotInSource.length})</h3>
      <p className="mt-1 mb-2 text-xs text-text-secondary">
        The source stopped listing these before they happened. That can mean a move, a new name, a cancellation or just a source
        glitch — check the source before acting. Nothing here has been marked cancelled or moved.
      </p>
      {notInSource && (
        <>
          <h4 className={`${SECTION_HEADING} mt-3 text-accent-strong`}>Possibly electronic ({ranked.length})</h4>
          <PrioritizedQueue rows={ranked} venues={venues} emptyMessage="None of these look electronic." />
        </>
      )}
      <div className="mt-4">
        <button type="button" onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers} className={`${SECTION_HEADING} text-text-secondary hover:text-text-primary`}>
          {showOthers ? "Hide" : "Show"} {notInSource ? "the rest" : "all"} ({others.length})
        </button>
        {showOthers && (
          <div className="mt-2">
            <DiscoveryQueue items={others} venues={venues} emptyMessage="None." />
          </div>
        )}
      </div>
      <div className="mt-6">
        <button type="button" onClick={() => setShowExpired((v) => !v)} aria-expanded={showExpired} className={`${SECTION_HEADING} text-text-secondary hover:text-text-primary`}>
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
