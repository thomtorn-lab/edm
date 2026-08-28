import type { EventRecord } from "@/lib/types";

interface StatusInfo {
  label: string;
  tone: "bad" | "neutral";
}

/**
 * Public event-lifecycle statuses only (event lifecycle/status handling,
 * 2026-08-28). `timeChanged` is still an internal data-quality flag (a
 * same-day time correction is not worth a prominent badge) and must never
 * surface here. `dateChanged`, however, now doubles as the public
 * "Rescheduled" signal: it's set only when an already-known, already-linked
 * event's date genuinely differs from what the source now reports (see
 * buildSyncPatch in lib/sync.ts) — that IS a confirmed replacement date from
 * the source's own authority, exactly what "rescheduled" means. It is a
 * one-way flag (never reset), which is fine here: once the event's start
 * date passes it drops out of the public "upcoming" listing entirely (see
 * EventExplorer), so this can never linger as stale clutter.
 *
 * cancelled takes priority over postponed/rescheduled (mutually exclusive —
 * showing both would be confusing/redundant), but NOT over soldOut, which
 * still renders alongside cancelled exactly as it already did before this
 * change.
 */
export function getEventStatuses(
  event: Pick<EventRecord, "cancelled" | "soldOut" | "postponed" | "dateChanged">,
): StatusInfo[] {
  const statuses: StatusInfo[] = [];
  if (event.cancelled) {
    statuses.push({ label: "Cancelled", tone: "bad" });
  } else if (event.postponed) {
    statuses.push({ label: "Postponed", tone: "bad" });
  } else if (event.dateChanged) {
    statuses.push({ label: "Rescheduled", tone: "neutral" });
  }
  if (event.soldOut) statuses.push({ label: "Sold out", tone: "neutral" });
  return statuses;
}

export default function StatusBadge({ label, tone }: StatusInfo) {
  return (
    <span
      className={
        "inline-flex items-center rounded-[3px] border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
        (tone === "bad"
          ? "border-status-bad/40 text-status-bad"
          : "border-border-strong text-text-secondary-strong")
      }
    >
      {label}
    </span>
  );
}
