"use client";

import { useState } from "react";
import type { DiscoveryQueueItem } from "@/lib/types";
import { getGenre } from "@/lib/taxonomy";

export default function DiscoveryQueue({ items: initialItems }: { items: DiscoveryQueueItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [lastAction, setLastAction] = useState<string | null>(null);

  function resolve(id: string, action: "Publish" | "Edit" | "Ignore" | "Merge") {
    const item = items.find((i) => i.id === id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setLastAction(`${action}d "${item?.probableTitle}" (preview build — not wired to a live database).`);
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        {lastAction ?? "Queue is empty — nothing needs manual review right now."}
      </p>
    );
  }

  return (
    <div>
      <ul>
        {items.map((item) => (
          <li key={item.id} className="border-b border-border py-4 last:border-b-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-text-primary">{item.probableTitle}</p>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                {item.overallConfidence} confidence
              </span>
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              {item.probableVenueName ?? "Venue unresolved"} · source: {item.sourceName}
            </p>
            {item.detectedLineup.length > 0 && (
              <p className="mt-1 text-xs text-text-tertiary">Lineup: {item.detectedLineup.join(", ")}</p>
            )}
            <p className="mt-1 text-xs text-text-tertiary">
              Genre: {item.predictedGenre ? `${getGenre(item.predictedGenre).label} (${item.genreConfidence})` : "unresolved"}
              {item.suspectedDuplicateOfEventId && ` · possible duplicate of ${item.suspectedDuplicateOfEventId}`}
            </p>
            {item.missingFields.length > 0 && (
              <p className="mt-1 text-xs text-status-warn">Missing: {item.missingFields.join(", ")}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {(["Publish", "Edit", "Ignore", "Merge"] as const).map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => resolve(item.id, action)}
                  className="rounded border border-border-strong px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary"
                >
                  {action}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {lastAction && <p className="mt-3 text-xs text-text-tertiary">{lastAction}</p>}
    </div>
  );
}
