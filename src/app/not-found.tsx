import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
      <p className="font-display text-6xl font-extrabold text-accent">404</p>
      <h1 className="font-display mt-3 text-2xl font-extrabold uppercase tracking-tight text-text-primary">
        Page not found
      </h1>
      <p className="mt-2 text-sm text-text-secondary">
        This page doesn&rsquo;t exist, or the event it pointed to has been removed.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded border border-accent bg-accent/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20"
      >
        Back to the calendar
      </Link>
    </div>
  );
}
