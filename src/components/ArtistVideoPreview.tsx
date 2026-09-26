/**
 * Compact YouTube Artist Preview embed (automated Rule A V1, 2026-09-25).
 * Only ever rendered by the event-detail page when a cached, accepted,
 * non-blocked match already exists (src/lib/queries.ts::
 * getArtistYoutubePreviewForLineup) — no placeholder/"no preview available"
 * state, and no YouTube resource is ever requested from the browser when
 * there's nothing to show. Uses youtube-nocookie.com (YouTube's
 * privacy-enhanced embed domain — no cookies set until the viewer actually
 * presses play) and never autoplays.
 *
 * `id="video"` on this section's own wrapper (never the iframe itself,
 * homepage VIDEO deep-link work, 2026-09-26) gives `/events/<slug>#video` a
 * stable target for the homepage's VIDEO badge (see EventRow.tsx) — plain
 * `scroll-mt-4` rather than JS scrolling, matching this codebase's existing
 * anchor convention (DiscoveryQueue.tsx/EventManager.tsx's own `id`+
 * `scroll-mt-4` rows). The event-detail page currently has no sticky
 * header, so no larger offset is needed; scroll-mt-4 is kept only for the
 * same small breathing-room the other anchors in this app already use.
 */
export default function ArtistVideoPreview({
  artistName,
  videoId,
  videoTitle,
}: {
  artistName: string;
  videoId: string;
  videoTitle: string | null;
}) {
  return (
    <div id="video" className="mt-6 scroll-mt-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{artistName} — video preview</h2>
      <div className="mt-2 aspect-video w-full overflow-hidden rounded border border-border-strong bg-black">
        <iframe
          className="h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${videoId}`}
          title={videoTitle ?? `${artistName} video preview`}
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
    </div>
  );
}
