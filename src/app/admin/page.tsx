import type { Metadata } from "next";
import { getAllEventsAdmin, getDiscoveryQueueForAdmin, getRecentSyncIdentityChanges, getSources, getVenues } from "@/lib/queries";
import { buildDataQualityReport } from "@/lib/dataQuality";
import DataQualityPanel from "@/components/admin/DataQualityPanel";
import { describeSourceHealth, getSourceHealth } from "@/lib/sourceHealth";
import { formatRelativeTime } from "@/lib/format";
import { buildPublishedQueueRows, deriveAdminUnpublishedRows, groupAdminQueueRows } from "@/lib/adminQueue";
import { buildReviewPriorityList, groupReviewList, prioritizeNotInSource, splitPastStale } from "@/lib/reviewPriority";
import { buildSeriesIndex } from "@/lib/seriesMemory";
import AddEventFromUrl from "@/components/admin/AddEventFromUrl";
import AdminQueueTabs from "@/components/admin/AdminQueueTabs";
import EventManager from "@/components/admin/EventManager";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export const revalidate = 0;

const HEALTH_ICON: Record<string, string> = {
  ok: "✓",
  degraded: "⚠",
  stale: "⏱",
  inactive: "⏻",
  "discovery-only": "◌",
};

const HEALTH_COLOR: Record<string, string> = {
  ok: "text-accent-strong",
  degraded: "text-status-warn",
  stale: "text-status-warn",
  inactive: "text-text-tertiary",
  "discovery-only": "text-text-tertiary",
};

export default async function AdminPage() {
  const now = new Date();
  const [sources, discoveryQueueRows, venues, allEvents, recentIdentityChanges] = await Promise.all([
    getSources(),
    getDiscoveryQueueForAdmin(),
    getVenues(),
    getAllEventsAdmin(),
    getRecentSyncIdentityChanges(),
  ]);

  const pendingItems = discoveryQueueRows.filter((item) => item.status === "pending");
  const publishedItems = discoveryQueueRows.filter((item) => item.status === "published" || item.status === "merged");
  const sourceLastCompleteSync = new Map(sources.map((s) => [s.id, s.lastCompleteSyncAt]));
  const venuesById = new Map(venues.map((v) => [v.id, v]));
  const sourcesById = new Map(sources.map((s) => [s.id, s]));

  const dataQualityReports = buildDataQualityReport(allEvents, recentIdentityChanges, now);

  const adminQueueGroups = groupAdminQueueRows(pendingItems, sourceLastCompleteSync, now);
  const publishedRows = buildPublishedQueueRows(publishedItems, allEvents, venuesById);
  const adminUnpublishedRows = deriveAdminUnpublishedRows(allEvents, venuesById, sourcesById);
  // Series memory reads the events already loaded for "All events" — no extra query.
  const seriesIndex = buildSeriesIndex(allEvents, venues);
  const priorityContext = { venues, sourceTrust: new Map(sources.map((s) => [s.id, s.trustLevel])), now, seriesIndex };
  // One entry per event: the same night listed by two sources is grouped for display only.
  const priorityList = groupReviewList(buildReviewPriorityList(adminQueueGroups.insufficient, priorityContext), venues);
  const pastStaleSplit = splitPastStale(adminQueueGroups.past_stale, now);
  const notInSource = prioritizeNotInSource(pastStaleSplit.upcomingNotInSource, priorityContext);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-status-warn">
        Internal tool · not linked from the public site · no auth in this preview build
      </p>
      <h1 className="font-display mt-2 text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        Admin
      </h1>

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-text-primary">Add event from URL</h2>
        <p className="mt-1 text-xs text-text-secondary">
          Paste an official venue, promoter, RA or Facebook event URL. The system attempts best-effort
          extraction and always shows what it couldn&rsquo;t determine — nothing publishes automatically below high confidence.
        </p>
        <div className="mt-3">
          <AddEventFromUrl />
        </div>
      </section>

      <section id="discovery-queue" className="mt-12">
        <h2 className="text-sm font-semibold text-text-primary">Discovery queue</h2>
        <p className="mt-1 text-xs text-text-secondary">
          Needs review is the default: only candidates a human can actually act on right now — evidence
          gathered, not stale, not blocked by anything else. Everything else stays one tab away, never deleted
          (admin Discovery Queue cleanup, 2026-09-06).
        </p>
        <div className="mt-3">
          <AdminQueueTabs
            groups={adminQueueGroups}
            published={publishedRows}
            adminUnpublished={adminUnpublishedRows}
            venues={venues}
            priorityList={priorityList}
            pastStaleSplit={pastStaleSplit}
            notInSource={notInSource}
          />
        </div>
      </section>

      <section id="data-quality" className="mt-12">
        <h2 className="text-sm font-semibold text-text-primary">
          Data quality <span className="tabular-nums text-text-tertiary">{dataQualityReports.length}</span>
        </h2>
        <p className="mt-1 text-xs text-text-secondary">
          Upcoming events with an end time that cannot be right or may make them leave the site early, or whose date,
          venue or official URL a sync keeps changing. Nothing is changed automatically — open the event below to correct it.
        </p>
        <div className="mt-3">
          <DataQualityPanel reports={dataQualityReports} />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-semibold text-text-primary">All events</h2>
        <p className="mt-1 text-xs text-text-secondary">
          Edit, correct, hide or unhide any published event. Edited fields are protected from being
          overwritten by a later automated sync.
        </p>
        <div className="mt-3">
          <EventManager events={allEvents} venues={venues} />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-semibold text-text-primary">Source health</h2>
        <p className="mt-1 text-xs text-text-secondary">
          A broken source never fails silently and is never mistaken for a venue going quiet.
        </p>
        <ul className="mt-3">
          {sources.map((source) => {
            const health = getSourceHealth(source, now);
            return (
              <li key={source.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-border py-3 last:border-b-0">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    <span className={`mr-1.5 ${HEALTH_COLOR[health]}`}>{HEALTH_ICON[health]}</span>
                    {source.sourceName}
                  </p>
                  <p className="mt-0.5 text-xs text-text-tertiary">{source.integrationNote}</p>
                  {source.lastError && <p className="mt-0.5 text-xs text-status-warn">{source.lastError}</p>}
                  {health === "stale" && <p className="mt-0.5 text-xs text-status-warn">{describeSourceHealth(source, now)}</p>}
                </div>
                <div className="text-right text-xs text-text-secondary">
                  <p>{source.adapter ? `${source.eventsFound} events` : "discovery only"}</p>
                  <p className="text-text-tertiary">
                    {source.lastSuccessfulSync
                      ? `Updated ${formatRelativeTime(source.lastSuccessfulSync, now)}`
                      : "Never synced"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
