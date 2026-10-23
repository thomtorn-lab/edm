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
 * anchor — so this component has no heading of its own. No artist caption
 * under the player either (removed 2026-10-18): the YouTube player already
 * shows the video's own title/channel, and the extra line was visual noise.
 * `artistName` stays only as the iframe's accessible-title fallback.
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
    <div className="mt-3 aspect-video w-full overflow-hidden rounded border border-border-strong bg-black">
      <iframe
        className="h-full w-full"
        src={`https://www.youtube-nocookie.com/embed/${videoId}`}
        title={videoTitle ?? `${artistName} video preview`}
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}
