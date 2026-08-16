import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 text-xs text-text-tertiary sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Nattefrekvens — an independent index of electronic music events in Copenhagen &amp; Frederiksberg.</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-4">
          <Link href="/about" className="hover:text-text-secondary">About &amp; sources</Link>
          <Link href="/venues" className="hover:text-text-secondary">Venues</Link>
          <Link href="/festivals" className="hover:text-text-secondary">Festivals</Link>
          <Link href="/suggest-event" className="hover:text-text-secondary">Suggest an event</Link>
          <Link href="/contact" className="hover:text-text-secondary">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}
