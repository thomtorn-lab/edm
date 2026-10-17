/**
 * Compact SoundCloud links section (one-event pilot, 2026-10-09; relabeled
 * to "AUDIO" on the overview and switched to the official wordmark here in
 * the UI-refinement round). Lists only verified lineup artists with their
 * own external SoundCloud profile — never an embed/player, never a
 * speculative match. `id="soundcloud"` + `scroll-mt-4` gives
 * `/events/<slug>#soundcloud` a stable target for the homepage's AUDIO badge
 * (see EventRow.tsx).
 *
 * Event-page action layout (2026-10-17): rendered inside the page's "Get a
 * taste" section, so its own heading is an h3 — "Listen on" followed by the
 * official wordmark standing in for the word "SoundCloud" (its alt text
 * completes the heading's accessible name, "Listen on SoundCloud", without
 * printing the brand name twice). Artists are one wrapping row rather than
 * a vertical list: compact, and with 44px-tall links on mobile (32px from
 * `sm`) so each stays an easy tap target. `className` carries the spacing,
 * which depends on whether a video sits above it.
 */
export default function SoundcloudLinks({
  artists,
  className = "",
}: {
  artists: { name: string; url: string }[];
  className?: string;
}) {
  return (
    <div id="soundcloud" className={`scroll-mt-4 ${className}`}>
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
        {/* The explicit space keeps the accessible name "Listen on SoundCloud"
            rather than "Listen onSoundCloud" (flex gap is not text). */}
        <span>Listen on</span>{" "}
        {/* Official SoundCloud wordmark PNG, sourced as-is from SoundCloud's
            own developers.soundcloud.com asset host (public/brand/) — never
            recreated or recolored by hand. Native 200×24; height fixes the
            mark at its minimum legible size while width:auto preserves the
            source file's own aspect ratio exactly. */}
        <img src="/brand/soundcloud-logo-white.png" alt="SoundCloud" width={200} height={24} className="h-3.5 w-auto" />
      </h3>
      <ul className="mt-1 flex flex-wrap gap-x-5 sm:mt-1.5 sm:gap-x-6">
        {artists.map((artist) => (
          <li key={artist.url}>
            <a
              href={artist.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-sm text-text-secondary-strong underline decoration-1 decoration-transparent underline-offset-4 transition-colors duration-150 hover:text-text-primary hover:decoration-current focus-visible:text-text-primary focus-visible:decoration-current sm:min-h-8"
            >
              {artist.name} ↗<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
