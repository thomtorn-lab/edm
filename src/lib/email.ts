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
  const recipient = to ?? process.env.CONTACT_RECIPIENT_EMAIL;
  const from = process.env.CONTACT_FROM_EMAIL;

  if (!apiKey || !recipient || !from) {
    throw new Error(
      "Email is not configured: set RESEND_API_KEY, CONTACT_RECIPIENT_EMAIL, and CONTACT_FROM_EMAIL."
    );
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
