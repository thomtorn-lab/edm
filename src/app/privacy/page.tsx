import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { isNewsletterEnabled } from "@/lib/newsletter/featureFlag";

/**
 * Privacy page (GDPR review, 2026-10-30). Describes only what the site does
 * today, verified in code: hosting on Vercel, Vercel Web Analytics (still
 * active), the session-storage "back to list" record, YouTube videos loaded
 * only after the visitor presses play (src/components/ArtistVideoPreview.tsx),
 * Contact/Suggest-an-event sent by email via Resend, and artist data built
 * from public listings.
 *
 * Outstanding before this text is complete — each needs the owner's
 * decision or confirmation, so the page deliberately says nothing about it
 * rather than guess:
 * - Controller identity: name (person or business/CVR) behind "Electronic CPH".
 * - Legal basis for Vercel Web Analytics: depends on the pending decision on
 *   keeping it (with consent) or removing it.
 * - Retention period for Contact/Suggest-an-event messages (Resend logs and
 *   the receiving inbox), and the inbox provider behind
 *   CONTACT_RECIPIENT_EMAIL.
 * - Retention of Vercel's own request/infrastructure logs.
 * - Transfer safeguards per provider (Vercel plan/DPA decision, Supabase
 *   project region, Resend, Google) — until confirmed the page only says
 *   transfers may happen and offers details on request.
 * - Whether Vercel's platform (firewall, bot protection) sets any cookie on
 *   the production domain — hence "Electronic CPH itself", not "no cookies".
 * - How long past events stay listed.
 */
export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How Electronic CPH handles personal data: hosting, cookieless analytics, YouTube videos loaded only when you press play, and the contact forms.",
  alternates: { canonical: "/privacy" },
};

const linkClass = "underline hover:text-text-primary";

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-10 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{children}</h2>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        Privacy
      </h1>

      <div className="mt-6 space-y-4 text-sm leading-relaxed text-text-secondary">
        <p>
          Electronic CPH is the data controller for the personal data described on this page. For any
          privacy question or to exercise any of the rights below, use{" "}
          <Link href="/contact" className={linkClass}>Contact</Link>.
        </p>
      </div>

      <SectionHeading>When you visit the site</SectionHeading>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-text-secondary">
        <p>
          To deliver pages and protect the site against abuse, our hosting provider, Vercel, processes your IP
          address, information about your browser and the address of the page you request. The legal basis is
          our legitimate interest in running a working and secure website (GDPR Art. 6(1)(f)).
        </p>
      </div>

      <SectionHeading>Analytics</SectionHeading>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-text-secondary">
        <p>
          We use Vercel Web Analytics to count page views and see which pages are popular. According to Vercel,
          it sets no cookies and counts visitors using a hash of request data that is reset every day, so
          visitors can&rsquo;t be followed from one day to the next or across other websites. Before anything
          is sent, we remove any query string from the page address. We only see aggregated numbers. We
          don&rsquo;t use advertising, tracking pixels or any other analytics.
        </p>
      </div>

      <SectionHeading>Cookies and browser storage</SectionHeading>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-text-secondary">
        <p>
          Electronic CPH itself doesn&rsquo;t set cookies. When you open an event from the event list, your
          browser remembers which list view you came from (in session storage, for up to two hours and only in
          that browser tab), so &ldquo;All events&rdquo; takes you back to it. This stays on your device, is
          never sent to us, and is gone when you close the tab.
        </p>
      </div>

      <SectionHeading>YouTube videos</SectionHeading>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-text-secondary">
        <p>
          Some event pages offer a YouTube video for one of the artists. Nothing is loaded from YouTube until
          you press the video&rsquo;s play button. When you do, the video is loaded from YouTube in its
          privacy-enhanced mode: Google receives your IP address and information about your browser, and may
          store information on your device. By pressing play you consent to this for that video (GDPR Art.
          6(1)(a)); we don&rsquo;t remember the choice, so each video asks again. What Google does with the
          data once the video is loaded is covered by{" "}
          <a href="https://policies.google.com/privacy" className={linkClass} rel="noopener noreferrer">
            Google&rsquo;s Privacy Policy
          </a>
          .
        </p>
      </div>

      <SectionHeading>Contact and event suggestions</SectionHeading>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-text-secondary">
        <p>
          If you use <Link href="/contact" className={linkClass}>Contact</Link> or{" "}
          <Link href="/suggest-event" className={linkClass}>Suggest an event</Link>, what you submit (your name,
          email address and message, or the event details, your email address and note) is sent by email via
          our email provider, Resend, to our inbox. It isn&rsquo;t stored in our website database and is used
          only to reply to you or review your suggestion. Your IP address is used briefly in server memory to
          block repeated automated submissions and isn&rsquo;t stored. The legal basis is our legitimate
          interest in answering enquiries and keeping the calendar accurate (GDPR Art. 6(1)(f)).
        </p>
      </div>

      <SectionHeading>Artists and event information</SectionHeading>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-text-secondary">
        <p>
          The calendar is built from publicly available listings from venues, promoters and ticketing services,
          which include the names of performing artists and DJs. We may add a public YouTube video found via
          Google&rsquo;s YouTube Data API or chosen by us, genre information from Discogs, and SoundCloud
          profile links that a venue has published in its own lineup. The legal basis is our legitimate
          interest in providing an accurate and useful event guide (GDPR Art. 6(1)(f)). If you&rsquo;re an
          artist and want a video or link removed or corrected, or want to object, use{" "}
          <Link href="/contact" className={linkClass}>Contact</Link> and we&rsquo;ll act on it.
        </p>
      </div>

      {isNewsletterEnabled() && (
        <>
          <SectionHeading>Newsletter</SectionHeading>
          <div className="mt-2 space-y-3 text-sm leading-relaxed text-text-secondary">
            <p>
              If you sign up for the weekly newsletter, we store your email address and, if you choose, your
              genre preferences in our application database. We do not deliberately collect or use your IP
              address or other identifiers for newsletter personalization or marketing purposes.
            </p>
            <p>
              The legal basis for this processing is your consent, given by confirming via the link we email
              you. You can withdraw your consent at any time using the unsubscribe link in every newsletter.
            </p>
            <p>
              Unsubscribing deletes your email address and genre preferences from our application database
              immediately.
            </p>
            <p>
              Our hosting, database and email-sending providers may process standard technical logs or
              backups as part of operating their services, subject to their own retention and
              data-processing terms.
            </p>
            <p>We do not use open or click tracking in newsletter emails.</p>
            <p>
              Sending is handled by Resend as our email processor. We keep a short record of each
              week&rsquo;s send for up to 30 days to troubleshoot delivery problems, then delete it
              automatically. An unconfirmed signup that is never confirmed is also deleted automatically
              after 30 days.
            </p>
          </div>
        </>
      )}

      <SectionHeading>Service providers and transfers</SectionHeading>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-text-secondary">
        <p>These providers process personal data for us:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Vercel — hosting and analytics</li>
          <li>Supabase — the database for event information</li>
          <li>Resend — sending Contact and Suggest-an-event messages to our inbox</li>
        </ul>
        <p>
          Google receives data only when you load a YouTube video, as described above. Vercel, Supabase and
          Resend are based outside the EU/EEA, and they and Google may process personal data outside the EU/EEA,
          including in the USA. Use <Link href="/contact" className={linkClass}>Contact</Link> to ask about the safeguards that
          apply to these transfers.
        </p>
      </div>

      <SectionHeading>Your rights</SectionHeading>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-text-secondary">
        <p>
          You have the right to access, correct or erase your personal data, to restrict its processing, to
          data portability, and to object to processing based on our legitimate interests. Where processing is
          based on consent, you can withdraw it at any time. Use{" "}
          <Link href="/contact" className={linkClass}>Contact</Link> for any of these requests; we reply within
          one month. You also have the right to lodge a complaint with the Danish Data Protection Agency
          (Datatilsynet).
        </p>
      </div>

      <SectionHeading>Changes</SectionHeading>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-text-secondary">
        <p>
          If we ever add tracking that requires your consent, this page is updated first, and we&rsquo;ll ask
          for your consent before it&rsquo;s activated.
        </p>
      </div>

      <p className="mt-10 text-xs text-text-tertiary">
        <Link href="/" className="underline hover:text-text-secondary">Back to the calendar</Link>
      </p>
    </div>
  );
}
