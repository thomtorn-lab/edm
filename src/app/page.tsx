import type { Metadata } from "next";
import { getPublishedEventsWithVenue } from "@/lib/queries";
import EventExplorer from "@/components/EventExplorer";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Events are admin-editable now; always read the current DB state rather
// than serving a stale prerendered page after a publish/edit/hide.
export const revalidate = 0;

export default async function HomePage() {
  const events = await getPublishedEventsWithVenue();
  // Computed here (server request time, same as /venues/[slug]) rather than
  // left for the client to fill in post-hydration — see EventExplorer's
  // `serverNow` prop doc comment for why.
  const serverNow = new Date().toISOString();

  return (
    <div>
      <div className="mx-auto max-w-6xl px-4 pb-4 pt-6 sm:px-6 sm:pt-8">
        <h1 className="font-display text-2xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-[2rem]">
          Electronic music in Copenhagen
        </h1>
        <p className="mt-1.5 max-w-xl text-sm text-text-secondary">
          Techno, house, trance, drum &amp; bass and more — a continuously updated,
          curated guide to electronic music in Copenhagen.
        </p>
      </div>
      <EventExplorer events={events} serverNow={serverNow} />
    </div>
  );
}
