/**
 * Single configuration point for the site's public contact address, used by
 * both /contact and /suggest-event. Set NEXT_PUBLIC_CONTACT_EMAIL in the
 * environment before deploying — see .env.example. Falls back to the
 * RFC 2606 documentation placeholder so a missing env var is obviously a
 * placeholder rather than a real-looking but wrong address.
 */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contact@example.com";

export function mailtoHref(opts: { subject?: string; body?: string } = {}): string {
  const parts: string[] = [];
  if (opts.subject) parts.push(`subject=${encodeURIComponent(opts.subject)}`);
  if (opts.body) parts.push(`body=${encodeURIComponent(opts.body)}`);
  return `mailto:${CONTACT_EMAIL}${parts.length ? `?${parts.join("&")}` : ""}`;
}
