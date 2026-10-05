import { randomBytes } from "node:crypto";

/**
 * Confirmation/management tokens (newsletter MVP, 2026-10-05) — the entire
 * auth model for a no-account, no-login subscriber (product requirement).
 * 32 random bytes, base64url-encoded (~43 chars, URL-safe, no padding) —
 * not guessable by brute force or enumeration, same order of entropy as a
 * session token. Two independent tokens per subscriber (confirm vs manage)
 * so a confirmation link that leaks (e.g. via an email-client preview
 * fetch) can't be used to later change preferences or unsubscribe someone
 * else.
 */
export function generateNewsletterToken(): string {
  return randomBytes(32).toString("base64url");
}
