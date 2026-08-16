import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "./ContactForm";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with Electronic CPH — corrections, tips, and general questions.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        Contact
      </h1>

      <p className="mt-4 max-w-xl text-sm leading-relaxed text-text-secondary">
        Wrong date, dead link, duplicate listing, or just a question — send a note below and a
        person reads it.
      </p>

      <p className="mt-4 max-w-xl text-sm leading-relaxed text-text-secondary">
        Know about a night that&rsquo;s missing entirely?{" "}
        <Link href="/suggest-event" className="underline hover:text-text-primary">
          Suggest an event
        </Link>{" "}
        instead.
      </p>

      <ContactForm />

      <p className="mt-10 text-xs text-text-tertiary">
        <Link href="/" className="underline hover:text-text-secondary">Back to the calendar</Link>
      </p>
    </div>
  );
}
