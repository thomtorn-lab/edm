import type { DataQualityIssue, EventDataQualityReport } from "@/lib/dataQuality";
import type { EventWithVenue } from "@/lib/queries";
import { formatFullDateLabel, formatTimeLabel } from "@/lib/format";

const SEVERITY_PREFIX: Record<DataQualityIssue["severity"], string> = {
  error: "Error: ",
  warning: "Check: ",
  possible_inconsistency: "Possible inconsistency: ",
};

/**
 * Admin data-quality warnings (see src/lib/dataQuality.ts). Read-only: each
 * row links to the event's own editor in "All events" below, where the admin
 * can correct it. Nothing is changed automatically.
 */
export default function DataQualityPanel({ reports }: { reports: EventDataQualityReport<EventWithVenue>[] }) {
  if (reports.length === 0) {
    return <p className="text-xs text-text-secondary">No date or end-time problems found on upcoming events.</p>;
  }
  return (
    <ul className="rounded-md border border-status-warn px-3">
      {reports.map(({ event, issues }) => (
        <li key={event.id} className="border-b border-border py-3 last:border-b-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <a href={`#event-${event.id}`} className="text-sm font-semibold text-text-primary underline decoration-dotted underline-offset-2">
              {event.title}
            </a>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{event.published ? "Published" : "Not published"}</span>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            {formatFullDateLabel(event.startDatetime)} · {formatTimeLabel(event.startDatetime)} · {event.venue.name}
            {event.canonicalSourceId ? ` · source: ${event.canonicalSourceId}` : ""}
          </p>
          <ul className="mt-1">
            {issues.map((issue) => (
              <li key={issue.key} className={`text-xs ${issue.severity === "error" ? "font-semibold text-status-warn" : "text-text-secondary"}`}>
                {SEVERITY_PREFIX[issue.severity]}
                {issue.message}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
