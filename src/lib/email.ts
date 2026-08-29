import { Resend } from "resend";

/**
 * Server-only. Never import this from a Client Component — RESEND_API_KEY
 * and CONTACT_RECIPIENT_EMAIL must not reach the browser bundle. Both
 * /api/contact and /api/suggest-event call this from a Route Handler,
 * which runs exclusively on the server.
 */
export type SendEmailInput = {
  subject: string;
  text: string;
  /** Defaults to CONTACT_RECIPIENT_EMAIL when omitted (the /contact and
   *  /suggest-event forms rely on this default). Pass explicitly to send
   *  elsewhere, e.g. the Discovery Queue notification recipient. */
  to?: string;
  replyTo?: string;
};

export async function sendEmail({ subject, text, to, replyTo }: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  // An explicit `to` (e.g. the Discovery Queue notification's own dedicated
  // recipient) never requires CONTACT_RECIPIENT_EMAIL — only the default,
  // no-`to`-given contact-form path does.
  const recipient = to ?? process.env.CONTACT_RECIPIENT_EMAIL;
  const from = process.env.CONTACT_FROM_EMAIL;

  if (!apiKey || !recipient || !from) {
    // Names only the variable(s) actually missing (post-launch QA
    // follow-up, 2026-08-29): the prior message always listed all three
    // regardless of which one was the real blocker, which made a genuine
    // Production misconfiguration (RESEND_API_KEY/CONTACT_FROM_EMAIL unset
    // there, surfacing as this same generic string for every discovery
    // notification attempt) indistinguishable from a CONTACT_RECIPIENT_EMAIL
    // problem that an explicit `to` caller was never actually subject to.
    const missing: string[] = [];
    if (!apiKey) missing.push("RESEND_API_KEY");
    if (!recipient) missing.push(to === undefined ? "CONTACT_RECIPIENT_EMAIL (or pass `to` explicitly)" : "CONTACT_RECIPIENT_EMAIL");
    if (!from) missing.push("CONTACT_FROM_EMAIL");
    throw new Error(`Email is not configured: set ${missing.join(", ")}.`);
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: recipient,
    subject,
    text,
    ...(replyTo ? { replyTo } : {}),
  });

  if (error) {
    throw new Error(`Resend rejected the message: ${error.message}`);
  }
}
