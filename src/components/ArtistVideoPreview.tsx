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
 * Rendered inside the event page's "Get a taste" section (event-page action
 * layout, 2026-10-17), which owns the section heading and the `#video`
 * anchor — so this component has no heading of its own. The artist the
 * video is for is a discreet caption under the player instead: nothing on
 * the page says whose video it is otherwise (YouTube's own title only shows
 * inside the player), and a caption is the conventional, quiet place for it.
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
    <figure className="mt-3">
      <div className="aspect-video w-full overflow-hidden rounded border border-border-strong bg-black">
        <iframe
          className="h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${videoId}`}
          title={videoTitle ?? `${artistName} video preview`}
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      <figcaption className="mt-2 text-xs text-text-tertiary">{artistName}</figcaption>
    </figure>
  );
}
