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

export type SendNewsletterEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Deterministic, reused verbatim on every retry of the same
   * (subscriber, week) — see db/newsletter.ts's claim/reclaim design. This
   * is what makes a blind retry after an interrupted or ambiguous send
   * safe: Resend recognizes the repeated key (within its 24h window) and
   * returns the original result instead of sending again.
   */
  idempotencyKey: string;
  /** Embedded verbatim in the List-Unsubscribe header (RFC 8058 one-click) — Resend requires this for bulk/marketing sends, see /docs/dashboard/emails/add-unsubscribe-to-transactional-emails. */
  listUnsubscribeUrl: string;
};

export type SendNewsletterEmailResult =
  | { status: "sent"; resendEmailId: string }
  /**
   * Covers every non-success outcome uniformly — a Resend-reported error,
   * a 409 (another request with this idempotency key already in flight),
   * a network timeout, anything. None of these can be told apart from
   * "genuinely failed" here, and none of them need to be: the caller never
   * marks a row failed, only "not yet confirmed sent" — safe to retry
   * later with the same idempotencyKey regardless of which of these
   * actually happened (see newsletter delivery-safety design).
   */
  | { status: "ambiguous" };

/**
 * Newsletter-specific send (weekly digest MVP, 2026-10-05) — distinct from
 * sendEmail() above because the shape genuinely differs (dynamic `to`,
 * idempotency key, List-Unsubscribe headers, no fixed recipient/replyTo),
 * but reuses the exact same Resend account/domain/API key already
 * configured for Contact/Suggest-event — Resend Support confirmed sending
 * an opt-in, personalized-per-subscriber newsletter through this Emails
 * API (rather than Broadcasts) is an accepted use, conditional on
 * including List-Unsubscribe/List-Unsubscribe-Post, which this always
 * does.
 */
export async function sendNewsletterEmail(input: SendNewsletterEmailInput): Promise<SendNewsletterEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CONTACT_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Email is not configured: set RESEND_API_KEY, CONTACT_FROM_EMAIL.");
  }

  const resend = new Resend(apiKey);
  try {
    const { data, error } = await resend.emails.send(
      {
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        headers: {
          "List-Unsubscribe": `<${input.listUnsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (error || !data) {
      console.error("newsletter send: Resend reported an error", error?.message);
      return { status: "ambiguous" };
    }
    return { status: "sent", resendEmailId: data.id };
  } catch (err) {
    console.error("newsletter send: request failed (treated as ambiguous, safe to retry)", err instanceof Error ? err.message : err);
    return { status: "ambiguous" };
  }
}
