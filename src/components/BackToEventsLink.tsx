"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LIST_RETURN_STORAGE_KEY, readListReturn } from "@/lib/explorerFilters";

/**
 * "← All events" on the event-detail page (homepage search/navigation work,
 * 2026-10-13). Points at "/" — exactly as before — unless this visitor
 * opened THIS event from the homepage list in this tab, in which case it
 * returns to that list's own URL, filters and search included (recorded by
 * EventExplorer; see readListReturn in src/lib/explorerFilters.ts). A direct
 * visit, a shared link opened in a new tab, or a different event reached
 * some other way always gets "/". The server render (and crawlers) always
 * see "/"; the filtered target is only applied after mount.
 */
export default function BackToEventsLink({ eventPath, className }: { eventPath: string; className?: string }) {
  const [href, setHref] = useState("/");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(LIST_RETURN_STORAGE_KEY);
    } catch {
      // Storage unavailable — keep "/".
    }
    const listUrl = readListReturn(stored, eventPath);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (listUrl) setHref(listUrl);
  }, [eventPath]);

  return (
    <Link href={href} className={className}>
      ← All events
    </Link>
  );
}
