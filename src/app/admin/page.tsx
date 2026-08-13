import type { Metadata } from "next";
import { getAllEventsAdmin, getDiscoveryQueue, getSources, getVenues } from "@/lib/queries";
import { getSourceHealth } from "@/lib/sourceHealth";
import { formatRelativeTime } from "@/lib/format";
import AddEventFromUrl from "@/components/admin/AddEventFromUrl";
import DiscoveryQueue from "@/components/admin/DiscoveryQueue";
import EventManager from "@/components/admin/EventManager";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export const revalidate = 0;

const HEALTH_ICON: Record<string, string> = {
  ok: "✓",
  degraded: "⚠",
  inactive: "⏻",
  "discovery-only": "◌",
};

const HEALTH_COLOR: Record<string, string> = {
  ok: "text-accent-strong",
  degraded: "text-status-warn",
  inactive: "text-text-tertiary",
  "discovery-only": "text-text-tertiary",
};

export default async function AdminPage() {
  const now = new Date();
  const [sources, discoveryQueue, venues, allEvents] = await Promise.all([
    getSources(),
    getDiscoveryQueue("pending"),
    getVenues(),
    getAllEventsAdmin(),
  ]);

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

      <section className="mt-12">
        <h2 className="text-sm font-semibold text-text-primary">Discovery queue</h2>
        <p className="mt-1 text-xs text-text-secondary">
          Medium/low-confidence imports awaiting a human decision (spec section 35).
        </p>
        <div className="mt-3">
          <DiscoveryQueue items={discoveryQueue} venues={venues} />
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
            const health = getSourceHealth(source);
            return (
              <li key={source.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-border py-3 last:border-b-0">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    <span className={`mr-1.5 ${HEALTH_COLOR[health]}`}>{HEALTH_ICON[health]}</span>
                    {source.sourceName}
                  </p>
                  <p className="mt-0.5 text-xs text-text-tertiary">{source.integrationNote}</p>
                  {source.lastError && <p className="mt-0.5 text-xs text-status-warn">{source.lastError}</p>}
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
