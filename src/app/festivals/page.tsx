import type { Metadata } from "next";
import { buildShareMetadata, shareTitle } from "@/lib/shareMetadata";
import { FESTIVALS } from "@/lib/data/festivals";
import FestivalExplorer from "@/components/FestivalExplorer";

const title = "Festivals";
const description = "A curated guide to the European electronic music festivals most worth knowing about, from Tomorrowland to Dekmantel.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/festivals" },
  ...buildShareMetadata({ title: shareTitle(title), description, path: "/festivals" }),
};

export default function FestivalsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-accent sm:text-4xl">
        Festivals
      </h1>
      <p className="mt-2 max-w-xl text-sm text-text-secondary">
        A curated guide to the European electronic music festivals worth knowing about — not a full listing, just the ones that matter.
      </p>
      <div className="mt-6">
        <FestivalExplorer festivals={FESTIVALS} />
      </div>
    </div>
  );
}
