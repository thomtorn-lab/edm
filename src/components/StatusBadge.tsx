import type { EventRecord } from "@/lib/types";

interface StatusInfo {
  label: string;
  tone: "bad" | "warn";
}

/** Only ever reflects fields backed by source data — never an invented urgency label (spec section 15). */
export function getEventStatuses(event: Pick<EventRecord, "cancelled" | "soldOut" | "dateChanged" | "timeChanged">): StatusInfo[] {
  const statuses: StatusInfo[] = [];
  if (event.cancelled) statuses.push({ label: "Cancelled", tone: "bad" });
  if (event.soldOut) statuses.push({ label: "Sold out", tone: "warn" });
  if (event.dateChanged) statuses.push({ label: "Date changed", tone: "warn" });
  if (event.timeChanged) statuses.push({ label: "Time changed", tone: "warn" });
  return statuses;
}

export default function StatusBadge({ label, tone }: StatusInfo) {
  return (
    <span
      className={
        "inline-flex items-center rounded-[3px] border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
        (tone === "bad"
          ? "border-status-bad/40 text-status-bad"
          : "border-status-warn/40 text-status-warn")
      }
    >
      {label}
    </span>
  );
}
