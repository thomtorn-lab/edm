/**
 * Compact SoundCloud links section (one-event pilot, 2026-10-09). Lists only
 * verified lineup artists with their own external SoundCloud profile —
 * never an embed/player, never a speculative match. `id="soundcloud"` +
 * `scroll-mt-4` mirrors ArtistVideoPreview's own anchor convention exactly,
 * giving `/events/<slug>#soundcloud` a stable target for the homepage's
 * SOUNDCLOUD badge (see EventRow.tsx).
 */
export default function SoundcloudLinks({ artists }: { artists: { name: string; url: string }[] }) {
  return (
    <div id="soundcloud" className="mt-6 scroll-mt-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">SoundCloud</h2>
      <ul className="mt-2 flex flex-col gap-1.5">
        {artists.map((artist) => (
          <li key={artist.url}>
            <a
              href={artist.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-text-secondary-strong underline decoration-1 decoration-transparent underline-offset-4 transition-colors duration-150 hover:text-text-primary hover:decoration-current focus-visible:text-text-primary focus-visible:decoration-current"
            >
              {artist.name} on SoundCloud ↗<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
