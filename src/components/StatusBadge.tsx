import type { EventRecord } from "@/lib/types";

interface StatusInfo {
  label: string;
  tone: "bad" | "neutral";
}

/**
 * Public event-lifecycle statuses only. `dateChanged`/`timeChanged` are
 * internal data-quality/change-detection flags (set by sync's date diffing,
 * never reset) — they record that a stored value changed, not that a
 * reschedule was confirmed, so they must never surface here. Only take
 * `cancelled`/`soldOut` as input so a future field addition can't leak in
 * by accident.
 */
export function getEventStatuses(event: Pick<EventRecord, "cancelled" | "soldOut">): StatusInfo[] {
  const statuses: StatusInfo[] = [];
  if (event.cancelled) statuses.push({ label: "Cancelled", tone: "bad" });
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
