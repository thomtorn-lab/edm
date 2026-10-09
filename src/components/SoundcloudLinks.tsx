/**
 * Compact SoundCloud links section (one-event pilot, 2026-10-09; relabeled
 * to "AUDIO" on the overview and switched to the official wordmark here in
 * the UI-refinement round). Lists only verified lineup artists with their
 * own external SoundCloud profile — never an embed/player, never a
 * speculative match. `id="soundcloud"` + `scroll-mt-4` mirrors
 * ArtistVideoPreview's own anchor convention exactly (unchanged across both
 * rounds), giving `/events/<slug>#soundcloud` a stable target for the
 * homepage's AUDIO badge (see EventRow.tsx).
 */
export default function SoundcloudLinks({ artists }: { artists: { name: string; url: string }[] }) {
  return (
    <div id="soundcloud" className="mt-6 scroll-mt-4">
      {/* Official SoundCloud wordmark PNG, sourced as-is from SoundCloud's
          own developers.soundcloud.com asset host (public/brand/) — never
          recreated or recolored by hand. Native 200×24; height fixes the
          mark at its minimum legible size while width:auto preserves the
          source file's own aspect ratio exactly. */}
      <img
        src="/brand/soundcloud-logo-white.png"
        alt="SoundCloud"
        width={200}
        height={24}
        className="h-3.5 w-auto"
      />
      <ul className="mt-2 flex flex-col gap-1.5">
        {artists.map((artist) => (
          <li key={artist.url}>
            <a
              href={artist.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-text-secondary-strong underline decoration-1 decoration-transparent underline-offset-4 transition-colors duration-150 hover:text-text-primary hover:decoration-current focus-visible:text-text-primary focus-visible:decoration-current"
            >
              {artist.name} ↗<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
