/**
 * Instant feedback for navigations to the homepage (2026-11-15).
 *
 * The homepage is rendered per request (revalidate = 0: it reads the
 * current DB state and builds the full upcoming-event list), so a click on
 * "Events" / "Electronic CPH" in the header used to leave the previous page
 * on screen with no visible reaction until the whole server response
 * arrived — making it look as if the click hadn't registered. With this
 * loading boundary, Next.js prefetches this lightweight shell for "/" and
 * swaps it in immediately on click, then streams in the real page.
 *
 * Lives in the (home) route group so it only applies to the homepage, not
 * to every other route under the root layout. Mirrors the page heading so
 * the swap to real content doesn't jump.
 */
export default function HomeLoading() {
  return (
    <div aria-busy="true">
      <div className="mx-auto max-w-6xl px-4 pb-4 pt-6 sm:px-6 sm:pt-8">
        <h1 className="font-display text-2xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-[2rem]">
          Electronic music in Copenhagen
        </h1>
        <p className="mt-1.5 max-w-xl text-sm text-text-secondary">
          Techno, house, trance, drum &amp; bass and more — a continuously updated,
          curated guide to electronic music in Copenhagen.
        </p>
      </div>
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-6xl gap-2 px-4 py-3 sm:px-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-24 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
          ))}
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 sm:px-6" role="status">
        <span className="sr-only">Loading events…</span>
        <div className="mt-6 h-4 w-32 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
        <ul className="mt-4 divide-y divide-border">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i} className="flex gap-4 py-4">
              <div className="h-12 w-12 shrink-0 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-surface-1 motion-reduce:animate-none" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
